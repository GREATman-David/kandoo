-- Recall over BOTH memories and reminders.
--
-- Run this once in the Supabase SQL editor. It:
--   1. adds an embedding column to reminders,
--   2. creates match_context, which unions memories + reminders with one
--      hybrid score and a `source` tag,
--   3. drops the old memories-only match_memories.
--
-- Scoring mirrors the documented split: 75% pgvector cosine similarity, 25%
-- Postgres full-text ts_rank. When the query embedding is null (embedding
-- failed) it degrades to lexical-only, exactly as recallService expects.

-- 1. Reminders get their own embedding, same 1536-dim space as memories.
alter table public.reminders
  add column if not exists embedding vector(1536);

-- 2. The unified recall RPC.
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
      'reminder'::text                            as source,
      r.task                                      as content,
      r.person                                    as person,
      r.place_hint                                as location,
      r.due_at                                    as due_at,
      r.created_at                                as created_at,
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
      )::real                                     as score
    from public.reminders r
    where r.user_id = p_user_id
  )
  select id, source, content, person, location, due_at, created_at, score
  from scored
  where score > 0
  order by score desc
  limit p_match_count;
$$;

grant execute on function public.match_context(uuid, vector, text, int)
  to service_role, authenticated;

-- 3. match_memories is superseded; nothing calls it after this migration.
drop function if exists public.match_memories(uuid, vector, text, int);
