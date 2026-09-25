-- Remove the retired server-push path.
--
-- Time reminders fire as LOCAL notifications scheduled on the device (Block E,
-- AGENTS §3.2): the device owns triggers, they work with the server offline, and
-- there is no server-side scheduler. The remote-push path — a `push_tokens` table,
-- the backend `notificationService`, `expo-server-sdk`, and the mobile token
-- registrar — was never used in that model and has been deleted. Dropping the
-- table here removes the last piece.
--
-- Run once in the Supabase SQL editor. `if exists` makes it a safe no-op if the
-- table was never created in this environment.

drop table if exists push_tokens;
