-- The Library: the user's own notes, stacked in categories they name.
--
-- Unlike capture notes (003), which Kandoo writes up from something the user
-- said, library notes are written (or, on Elite, read off a photographed
-- document by Mr. Kandoo and confirmed) on purpose, and filed under a
-- category such as "Kandoo Project". A category holds notes; the Library
-- holds categories.
--
-- Run once in the Supabase SQL editor. Safe to run again.

-- 1. Categories. One name per user, ignoring case ("Kandoo project" and
--    "Kandoo Project" are the same shelf).
create table if not exists library_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists library_categories_user_name_idx
  on library_categories (user_id, lower(name));

-- 2. Notes. Deleting a category deletes its notes.
create table if not exists library_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references library_categories(id) on delete cascade,
  title       text check (title is null or char_length(title) <= 200),
  body        text not null check (char_length(body) between 1 and 20000),
  -- 'manual': typed by the user. 'document': read off a photographed page.
  source      text not null default 'manual' check (source in ('manual', 'document')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists library_notes_category_idx
  on library_notes (category_id, updated_at desc);
create index if not exists library_notes_user_idx
  on library_notes (user_id, updated_at desc);

-- 3. Row-level security: a user reads only their own. The backend writes
--    through the service role (which bypasses RLS but not grants).
alter table library_categories enable row level security;
alter table library_notes enable row level security;

drop policy if exists library_categories_select on library_categories;
create policy library_categories_select on library_categories
  for select using (user_id = auth.uid());

drop policy if exists library_notes_select on library_notes;
create policy library_notes_select on library_notes
  for select using (user_id = auth.uid());

grant select, insert, update, delete on library_categories to service_role;
grant select, insert, update, delete on library_notes to service_role;
