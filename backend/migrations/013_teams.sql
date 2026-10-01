-- Teams (Elite): a shared space for FILES, not chat. An admin creates a team
-- and shares a join link; members share notes, research write-ups, photos and
-- documents, see who sent what, and the admin can send tasks that each member
-- accepts into their own reminders (nothing lands on anyone's day unreviewed —
-- AGENTS §3.3). Team files are recallable by every member.
--
-- Run once in the Supabase SQL editor, after 012. Safe to run again.

-- 1. Private storage for shared documents (PDF, Word, slides, sheets, text,
--    images). The backend writes with the service role and hands members
--    short-lived signed URLs; nothing here is public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-files', 'team-files', false, 15728640,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Teams and who is in them.
create table if not exists teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  purpose     text check (purpose is null or char_length(purpose) <= 300),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  -- The join code behind the invite link; regenerating it retires old links.
  invite_code text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists team_members (
  team_id      uuid not null references teams(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'admin', 'member')),
  display_name text not null check (char_length(display_name) between 1 and 60),
  joined_at    timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists team_members_user_idx on team_members (user_id);

-- 3. What members share. Text items (notes, research) keep their body; files
--    keep a storage path. text_content is what recall and Mr. Kandoo read.
create table if not exists team_files (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references teams(id) on delete cascade,
  sender_id    uuid not null references auth.users(id) on delete cascade,
  sender_name  text not null,
  kind         text not null check (kind in ('note', 'research', 'document', 'photo')),
  title        text not null check (char_length(title) between 1 and 200),
  message      text check (message is null or char_length(message) <= 500),
  body         text check (body is null or char_length(body) <= 20000),
  storage_path text unique,
  file_name    text,
  mime_type    text,
  size_bytes   integer,
  text_content text,
  embedding    vector(1536),
  created_at   timestamptz not null default now()
);
create index if not exists team_files_team_idx on team_files (team_id, created_at desc);

-- 4. Tasks an admin sends, and where each member is with them.
create table if not exists team_tasks (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  sender_id   uuid not null references auth.users(id) on delete cascade,
  sender_name text not null,
  task        text not null check (char_length(task) between 1 and 300),
  due_at      timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists team_tasks_team_idx on team_tasks (team_id, created_at desc);

create table if not exists team_task_status (
  task_id     uuid not null references team_tasks(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'sent' check (status in ('sent', 'accepted', 'declined', 'done')),
  reminder_id uuid references reminders(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index if not exists team_task_status_user_idx on team_task_status (user_id, status);

-- 5. Row-level security: members read their own teams' rows. The backend
--    writes through the service role and checks membership itself.
alter table teams enable row level security;
alter table team_members enable row level security;
alter table team_files enable row level security;
alter table team_tasks enable row level security;
alter table team_task_status enable row level security;

-- A policy on team_members can't query team_members (Postgres reports
-- infinite recursion), so membership is checked by a security-definer
-- function that reads the table without RLS.
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id and m.user_id = auth.uid()
  );
$fn$;
revoke all on function public.is_team_member(uuid) from public;
grant execute on function public.is_team_member(uuid) to authenticated, service_role;

drop policy if exists teams_member_select on teams;
create policy teams_member_select on teams for select using (public.is_team_member(teams.id));
drop policy if exists team_members_member_select on team_members;
create policy team_members_member_select on team_members for select using (public.is_team_member(team_members.team_id));
drop policy if exists team_files_member_select on team_files;
create policy team_files_member_select on team_files for select using (public.is_team_member(team_files.team_id));
drop policy if exists team_tasks_member_select on team_tasks;
create policy team_tasks_member_select on team_tasks for select using (public.is_team_member(team_tasks.team_id));
drop policy if exists team_task_status_own_select on team_task_status;
create policy team_task_status_own_select on team_task_status for select using (user_id = auth.uid());

grant select, insert, update, delete on teams, team_members, team_files, team_tasks, team_task_status to service_role;

-- 6. Recall reaches the files of every team the user belongs to: same
--    columns as 012 (no drop needed); a team file reports its team in
--    `category` and its sender in `person`.
create or replace function public.match_context(
  p_user_id uuid,
  p_query_embedding vector(1536),
  p_query_text text,
  p_match_count int
)
returns table (
  id uuid,
  source text,
  content text,
  person text,
  location text,
  category text,
  due_at timestamptz,
  created_at timestamptz,
  score real
)
language sql
stable
as $$
  with q as (
    select plainto_tsquery('english', coalesce(p_query_text, '')) as tsq
  ),
  scored as (
    -- The first branch names the columns for the whole union.
    select m.id as id, 'memory'::text as source, m.content as content, m.person as person,
      m.location as location, null::text as category,
      null::timestamptz as due_at, m.created_at as created_at,
      (0.75 * case when p_query_embedding is not null and m.embedding is not null
                   then 1 - (m.embedding <=> p_query_embedding) else 0 end
       + 0.25 * ts_rank(to_tsvector('english', coalesce(m.content, '')), (select tsq from q)))::real as score
    from public.memories m
    where m.user_id = p_user_id

    union all

    select r.id, 'reminder'::text, r.task, r.person, r.place_hint, null::text,
      r.due_at, r.created_at,
      (0.75 * case when p_query_embedding is not null and r.embedding is not null
                   then 1 - (r.embedding <=> p_query_embedding) else 0 end
       + 0.25 * ts_rank(to_tsvector('english', coalesce(r.task, '')), (select tsq from q)))::real
    from public.reminders r
    where r.user_id = p_user_id

    union all

    select c.id, 'note'::text,
      left(coalesce(c.note->>'title', '') || ': ' || coalesce(c.note->>'body', ''), 1500),
      null::text, null::text, null::text, null::timestamptz, c.created_at,
      (0.75 * case when p_query_embedding is not null and c.note_embedding is not null
                   then 1 - (c.note_embedding <=> p_query_embedding) else 0 end
       + 0.25 * ts_rank(to_tsvector('english',
                  coalesce(c.note->>'title', '') || ' ' || coalesce(c.note->>'body', '')),
                (select tsq from q)))::real
    from public.captures c
    where c.user_id = p_user_id and c.note is not null

    union all

    select n.id, 'library'::text,
      left(coalesce(n.title || ': ', '') || n.body, 1500),
      null::text, null::text, lc.name, null::timestamptz, n.created_at,
      (0.75 * case when p_query_embedding is not null and n.embedding is not null
                   then 1 - (n.embedding <=> p_query_embedding) else 0 end
       + 0.25 * ts_rank(to_tsvector('english', coalesce(n.title, '') || ' ' || n.body || ' ' || lc.name),
                (select tsq from q)))::real
    from public.library_notes n
    join public.library_categories lc on lc.id = n.category_id
    where n.user_id = p_user_id

    union all

    select f.id, 'team'::text,
      left(f.title || ': ' || coalesce(f.text_content, coalesce(f.message, '')), 1500),
      f.sender_name, null::text, t.name, null::timestamptz, f.created_at,
      (0.75 * case when p_query_embedding is not null and f.embedding is not null
                   then 1 - (f.embedding <=> p_query_embedding) else 0 end
       + 0.25 * ts_rank(to_tsvector('english', f.title || ' ' || coalesce(f.text_content, '')),
                (select tsq from q)))::real
    from public.team_files f
    join public.team_members tm on tm.team_id = f.team_id and tm.user_id = p_user_id
    join public.teams t on t.id = f.team_id
  )
  select id, source, content, person, location, category, due_at, created_at, score
  from scored
  where score > 0
  order by score desc
  limit p_match_count;
$$;

grant execute on function public.match_context(uuid, vector, text, int)
  to service_role, authenticated;
