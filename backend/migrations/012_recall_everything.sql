-- Recall reaches EVERYTHING the user has kept: memories, reminders, the notes
-- Kandoo wrote up from captures, and the user's Library notes.
--
-- Before this, match_context searched memories and reminders only, so a fact
-- that lived in a capture's note or a Library page ("what did my Kandoo
-- Project notes say about pricing?") could never be recalled. A paying user
-- must never hit that wall.
--
-- Run once in the Supabase SQL editor, after 011_library.sql. Safe to run
-- again. Until it runs, recall keeps working exactly as before.

-- 1. Embeddings for the two new sources, in the same 1536-dim space.
alter table public.captures
  add column if not exists note_embedding vector(1536);

alter table public.library_notes
  add column if not exists embedding vector(1536);

-- 2. match_context gains two sources and a `category` column (a Library
--    note's shelf). The return type changes, so the old function is dropped
--    first; recallService treats a missing RPC as "use the fallback", so the
--    moment between the two statements is harmless.
drop function if exists public.match_context(uuid, vector, text, int);

create function public.match_context(
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
    select
      m.id,
      'memory'::text                              as source,
      m.content                                   as content,
      m.person                                    as person,
      m.location                                  as location,
      null::text                                  as category,
      null::timestamptz                           as due_at,
      m.created_at                                as created_at,
      (
        0.75 * case
                 when p_query_embedding is not null and m.embedding is not null
                 then 1 - (m.embedding <=> p_query_embedding)
                 else 0
               end
        + 0.25 * ts_rank(
                   to_tsvector('english', coalesce(m.content, '')),
                   (select tsq from q)
                 )
      )::real                                     as score
    from public.memories m
    where m.user_id = p_user_id

    union all

    select
      r.id,
      'reminder'::text,
      r.task,
      r.person,
      r.place_hint,
      null::text,
      r.due_at,
      r.created_at,
      (
        0.75 * case
                 when p_query_embedding is not null and r.embedding is not null
                 then 1 - (r.embedding <=> p_query_embedding)
                 else 0
               end
        + 0.25 * ts_rank(
                   to_tsvector('english', coalesce(r.task, '')),
                   (select tsq from q)
                 )
      )::real
    from public.reminders r
    where r.user_id = p_user_id

    union all

    -- A capture's written note: "Title: body". Long notes are cut for the
    -- answer model; the full text still counts for the word match.
    select
      c.id,
      'note'::text,
      left(coalesce(c.note->>'title', '') || ': ' || coalesce(c.note->>'body', ''), 1500),
      null::text,
      null::text,
      null::text,
      null::timestamptz,
      c.created_at,
      (
        0.75 * case
                 when p_query_embedding is not null and c.note_embedding is not null
                 then 1 - (c.note_embedding <=> p_query_embedding)
                 else 0
               end
        + 0.25 * ts_rank(
                   to_tsvector('english',
                     coalesce(c.note->>'title', '') || ' ' || coalesce(c.note->>'body', '')),
                   (select tsq from q)
                 )
      )::real
    from public.captures c
    where c.user_id = p_user_id
      and c.note is not null

    union all

    -- A Library note, with the category it is filed in.
    select
      n.id,
      'library'::text,
      left(coalesce(n.title || ': ', '') || n.body, 1500),
      null::text,
      null::text,
      lc.name,
      null::timestamptz,
      n.created_at,
      (
        0.75 * case
                 when p_query_embedding is not null and n.embedding is not null
                 then 1 - (n.embedding <=> p_query_embedding)
                 else 0
               end
        + 0.25 * ts_rank(
                   to_tsvector('english', coalesce(n.title, '') || ' ' || n.body || ' ' || lc.name),
                   (select tsq from q)
                 )
      )::real
    from public.library_notes n
    join public.library_categories lc on lc.id = n.category_id
    where n.user_id = p_user_id
  )
  select id, source, content, person, location, category, due_at, created_at, score
  from scored
  where score > 0
  order by score desc
  limit p_match_count;
$$;

grant execute on function public.match_context(uuid, vector, text, int)
  to service_role, authenticated;
