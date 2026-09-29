-- Places: an area the user draws on the map, attached to a place entity.
--
-- A place is still an `entities` row of kind 'place' — the same row a spoken
-- placeHint ("school") already resolves to — so memories and reminders that
-- named the place before it was drawn attach the moment it is drawn.
--
--   lat / lng / radius_m  (already on entities) — the smallest circle that
--       encloses the area. Android can only monitor circles, so this is what
--       the DEVICE registers as a geofence (AGENTS §3.2 — the server never
--       watches anyone's location).
--   area  — the shape the user traced, as [[lat, lng], ...]. NULL means the
--       area is the circle itself. The device checks it on arrival, so an
--       irregular shape is honoured exactly.
--
-- Reminders gain two columns, both optional, so every existing row is unchanged:
--   not_before     — "when I get to school TOMORROW": an arrival before this
--                    instant does not fire the reminder.
--   place_trigger  — 'arrive' (default) or 'leave' ("when I leave work").
--
-- Visit history is deliberately NOT stored here. When the user was somewhere
-- is kept on the phone only (AGENTS §3.5).
--
-- Run once in the Supabase SQL editor BEFORE deploying the backend that reads
-- these columns. `if not exists` makes a second run a harmless no-op.

alter table entities add column if not exists area jsonb;

alter table entities drop constraint if exists entities_area_is_array;
alter table entities add constraint entities_area_is_array
  check (area is null or jsonb_typeof(area) = 'array');

alter table reminders add column if not exists not_before timestamptz;
alter table reminders add column if not exists place_trigger text not null default 'arrive';

alter table reminders drop constraint if exists reminders_place_trigger_valid;
alter table reminders add constraint reminders_place_trigger_valid
  check (place_trigger in ('arrive', 'leave'));

-- The backend writes these through the service role; make sure it may.
grant select, insert, update, delete on entities to service_role;
grant select, insert, update, delete on reminders to service_role;
