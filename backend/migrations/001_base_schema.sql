-- The base schema: the tables Kandoo started with, before migrations 002–013.
-- Reconstructed from the live database (Supabase's REST schema) so a fresh
-- project can be stood up from this repository alone.
--
-- Run first, in the Supabase SQL editor, then 002 … 013 in order. Safe to run
-- again. Later migrations add their own columns (embeddings, notes, places,
-- repeat days) with `add column if not exists`.

create extension if not exists vector;
create extension if not exists pg_trgm;

-- 1. Captures: the raw utterance, verbatim, never overwritten. Extraction can
--    always be re-run over these when the prompt improves.
create table if not exists captures (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  text            text not null,
  created_at      timestamptz not null default now(),
  client_time     timestamptz,
  timezone        text,
  source          text default 'text',
  transcript_conf real
);
create index if not exists captures_user_created_idx on captures (user_id, created_at desc);

-- 2. Memories: one atomic, standalone fact each.
create table if not exists memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  content     text not null,
  person      text,
  location    text,
  topics      text[],
  capture_id  uuid references captures(id) on delete cascade,
  embedding   vector(1536),
  occurred_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists memories_user_created_idx on memories (user_id, created_at desc);

-- 3. Entities: people, places and topics, deduped per user by a normalised name.
create table if not exists entities (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('person', 'place', 'topic')),
  name       text not null,
  normalized text generated always as (lower(name)) stored,
  lat        double precision,
  lng        double precision,
  radius_m   integer default 120,
  created_at timestamptz not null default now(),
  unique (user_id, kind, normalized)
);

-- 4. Reminders: proposed as 'pending'; nothing is scheduled until the user
--    confirms (AGENTS §3.3). The device owns the trigger.
create table if not exists reminders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  task          text not null,
  person        text,
  reminder_time timestamptz not null, -- legacy; made nullable in 009, superseded by due_at
  due_at        timestamptz,
  place_hint    text,
  place_id      uuid references entities(id) on delete set null,
  insistent     boolean not null default false,
  status        text not null default 'pending'
                check (status in ('pending', 'confirmed', 'fired', 'dismissed', 'cancelled')),
  capture_id    uuid references captures(id) on delete cascade,
  created_at    timestamptz not null default now()
);
create index if not exists reminders_user_status_idx on reminders (user_id, status);

-- 5. Which entities a memory mentions.
create table if not exists memory_entities (
  memory_id uuid not null references memories(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  primary key (memory_id, entity_id)
);

-- 6. Row-level security: each user sees only their own rows. The backend uses
--    the service role (which bypasses RLS) and filters by user_id itself.
alter table captures enable row level security;
alter table memories enable row level security;
alter table entities enable row level security;
alter table reminders enable row level security;
alter table memory_entities enable row level security;

drop policy if exists captures_own on captures;
create policy captures_own on captures for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists memories_own on memories;
create policy memories_own on memories for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists entities_own on entities;
create policy entities_own on entities for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists reminders_own on reminders;
create policy reminders_own on reminders for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists memory_entities_own on memory_entities;
create policy memory_entities_own on memory_entities for all using (
  exists (select 1 from memories m where m.id = memory_entities.memory_id and m.user_id = auth.uid())
);

-- The service role bypasses RLS but not table grants: without these an
-- UPDATE or DELETE fails with 42501 (AGENTS appendix).
grant select, insert, update, delete on captures, memories, entities, reminders, memory_entities to service_role;
