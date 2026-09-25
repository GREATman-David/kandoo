-- reminder_entities — the join table that lets reminders link to people the
-- same way memories already do through memory_entities.
--
-- Until now reminders stored `person` as a single text column. That made
-- "What you promised" match on a string, multi-person reminders impossible, and
-- a People merge silently leave reminders behind. This join table fixes all
-- three. The `person` text column stays for now (backfill reads it) and is
-- removed in a later, deliberate step.
--
-- Run this once in the Supabase SQL editor, then run the backfill script:
--   npm run backfill:person-links   (in backend/) — links both memories and
--   reminders from the legacy person text column.

create table if not exists reminder_entities (
  reminder_id uuid references reminders(id) on delete cascade,
  entity_id   uuid references entities(id) on delete cascade,
  primary key (reminder_id, entity_id)
);

alter table reminder_entities enable row level security;

-- A user may read the links for their own reminders. The backend writes through
-- the service-role key (which bypasses RLS); the client only ever reads.
drop policy if exists reminder_entities_select on reminder_entities;
create policy reminder_entities_select on reminder_entities
  for select using (
    exists (
      select 1 from reminders r
      where r.id = reminder_entities.reminder_id
        and r.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on reminder_entities to service_role;

-- The service-role was missing grants on the entity tables, so entity linking
-- (createMemory / createReminder) has been failing silently — People would be
-- empty. Grant them here so linking, backfill, merge and delete all work.
grant select, insert, update, delete on entities to service_role;
grant select, insert, update, delete on memory_entities to service_role;
