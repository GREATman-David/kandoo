-- Show Kandoo: photos as captures, and a private photo library.
--
-- A photo the user shows Kandoo is kept (Pro) and linked to what came out of
-- it: the people and places it mentions, and the drawn place the user was
-- standing in. The files live in a PRIVATE storage bucket, one folder per
-- user; the backend writes them with the service role and hands the app
-- short-lived signed URLs. Nothing in the bucket is public.
--
-- Run once in the Supabase SQL editor. Safe to run again.

-- 1. The private bucket. JPEG only (the app re-encodes every photo, which also
--    strips its EXIF location), 5 MB ceiling.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. One row per kept photo.
create table if not exists photos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- The capture it was shown in; null for a photo added straight to a
  -- person or place. A deleted capture keeps its photo in the library.
  capture_id   uuid references captures(id) on delete set null,
  storage_path text not null unique,
  width        integer,
  height       integer,
  -- One line on what the photo is ("Flyer for the Foundation outreach").
  description  text,
  created_at   timestamptz not null default now()
);

create index if not exists photos_user_created_idx on photos (user_id, created_at desc);
create index if not exists photos_capture_idx on photos (capture_id);

-- 3. Which people and places a photo belongs to (the "albums").
create table if not exists photo_entities (
  photo_id  uuid references photos(id) on delete cascade,
  entity_id uuid references entities(id) on delete cascade,
  primary key (photo_id, entity_id)
);

create index if not exists photo_entities_entity_idx on photo_entities (entity_id);

-- 4. Row-level security: a user reads only their own. The backend writes
--    through the service role (which bypasses RLS but not grants).
alter table photos enable row level security;
alter table photo_entities enable row level security;

drop policy if exists photos_select on photos;
create policy photos_select on photos
  for select using (user_id = auth.uid());

drop policy if exists photo_entities_select on photo_entities;
create policy photo_entities_select on photo_entities
  for select using (
    exists (select 1 from photos p where p.id = photo_entities.photo_id and p.user_id = auth.uid())
  );

grant select, insert, update, delete on photos to service_role;
grant select, insert, update, delete on photo_entities to service_role;
