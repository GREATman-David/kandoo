-- Repeating reminders ("Repeat on M W F").
--
-- `repeat_days` holds the weekdays a reminder repeats on, 0 = Sunday … 6 =
-- Saturday, at the time of day of `due_at`. NULL (the default) means it does not
-- repeat, so every existing reminder is unchanged. The DEVICE schedules one
-- weekly local notification per day (AGENTS §3.2); the server only stores it.
--
-- Run once in the Supabase SQL editor BEFORE deploying the backend that reads
-- this column. `if not exists` makes a second run a harmless no-op.

alter table reminders add column if not exists repeat_days smallint[];

alter table reminders drop constraint if exists reminders_repeat_days_valid;
alter table reminders add constraint reminders_repeat_days_valid
  check (repeat_days is null or repeat_days <@ array[0,1,2,3,4,5,6]::smallint[]);
