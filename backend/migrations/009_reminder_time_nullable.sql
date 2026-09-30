-- A place reminder has no time. `reminder_time` — a legacy mirror of `due_at`
-- from the server scheduler that was removed (AGENTS §3.2) — was NOT NULL, so
-- every place reminder failed to save ("null value in column reminder_time").
-- Nothing reads the column any more; it only has to accept NULL like due_at.
--
-- Run once in the Supabase SQL editor. Safe to run again.

alter table reminders alter column reminder_time drop not null;
