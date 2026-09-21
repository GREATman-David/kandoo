-- Capture notes.
--
-- A substantial capture (a recap, several facts, more than a couple of
-- sentences) gets a cleaned-up written note, produced in the same extraction
-- call. It is stored ON the capture — the capture already holds the verbatim
-- words, and the note is the organised form of exactly those words.
--
-- Run this once in the Supabase SQL editor. Until it is applied, /interpret
-- still works: attachNote fails softly and the capture keeps its raw text.

alter table captures
  add column if not exists note jsonb;

-- Shape: { "title": text, "body": text }. Nullable — short single-action
-- captures have no note.
