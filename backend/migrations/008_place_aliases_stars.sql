-- Places, second pass: aliases and stars.
--
--   alias_of — "school" and "UG Campus" are the same place. After the user
--       says so once, the spoken name "school" is kept as an alias row that
--       points at the drawn place, so every future "when I get to school"
--       resolves to the place that is actually watched. Without this, each new
--       wording created a new, undrawn place and the reminder could never fire.
--   starred  — the user's own important places: watched first, surfaced
--       sooner, and listed on top.
--
-- Both default to "nothing", so every existing row is unchanged. Run once in
-- the Supabase SQL editor BEFORE deploying the backend that reads them.

alter table entities add column if not exists alias_of uuid references entities(id) on delete cascade;
alter table entities add column if not exists starred boolean not null default false;

alter table entities drop constraint if exists entities_alias_not_self;
alter table entities add constraint entities_alias_not_self
  check (alias_of is null or alias_of <> id);

create index if not exists entities_alias_of_idx on entities (alias_of) where alias_of is not null;
