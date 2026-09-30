# Kandoo — handoff (30 Sep 2026, night)

Read `AGENTS.md` first, then this. Submission (Shipaton Next Gen) closes **30 Sep 2026** —
the demo video + public repo are the deliverables.

## Where things stand

**Local commits NOT pushed** (the user decides when). Everything after
`b8bab02 Polish: Free/Pro/Elite pills…` is local:

```
7f5cbdb Research with Mr. Kandoo (Elite): real sources, written up with references
87ec7fe Recall reaches everything: capture notes and the Library, not just memories
73707e4 Onboarding: the plans card scrolls, so Elite is never cut off
d745492 Mr. Kandoo reads a page into the Library (Elite)
8323f72 Library: categories of your own notes, inside Memory
d04d1e9 Camera: Open Settings when permission is permanently denied; paywall says Mr. Kandoo
b268de6 Add HANDOFF.md …
85f32e7 Keep RECORD_AUDIO: the image-picker plugin removed it app-wide
6ef065c Show Kandoo: photos as captures, a private photo library, watermarked sharing
```

`Kandoo-final.apk` on the Desktop is the OLD pushed build — none of the above.

Migrations **010, 011 and 012 have all been run** in Supabase. 012 was edited after it
was first written (it now also allows library note `source = 'research'`); it is safe
to run again — do so if saving a research note fails.

## What was added tonight

- **Library** (all plans): Memory screen has a `Memories | Library` switch. Categories
  (`library_categories`) hold notes (`library_notes`), shown two to a row in the note
  colours. Routes in `backend/src/routes/library.ts`; UI in `src/components/library/`.
- **read_document** (Elite, Mr. Kandoo only): camera → `POST /library/read` → an
  editable card → filed on yes. The photo is never stored.
- **Research** (Elite, Mr. Kandoo only): `research_topic` → `POST /library/research`;
  `write_research_note` → `POST /library/research/write` (format: points / structured /
  summary / report) → card → filed on yes, with numbered citations and a References
  list. Sources are Wikipedia + OpenAlex papers (`modules/research/sources.ts`); the
  model writes ONLY from them and references are built by code
  (`modules/research/citations.ts`). Gemini search grounding and OpenAI web search
  both need billing this account doesn't have — that is why.
- **Recall reaches everything** (012): `match_context` ranks memories, reminders,
  capture notes and Library notes together. Notes embed on write; older ones backfill
  on the owner's next ask (`modules/memories/noteEmbeddings.ts`, guarded to one pass
  per user per 10 min). The user's account is fully embedded.
- **Onboarding** plans card scrolls (Elite was cut off on short screens); Elite is a
  bullet list now — add a line per new Elite feature (`src/components/Onboarding.tsx`).
- ElevenLabs agent renamed **Mr. Kandoo**; 39 tools. New client tools:
  `read_document`, `list_library`, `read_library_category`, `research_topic`,
  `write_research_note`, `write_library_note`. Prompt has `# Library` and
  `# Research (Elite)` sections. Send `body` and `prompt` in SEPARATE `agents_update` calls.

## Verified

- Emulator (debug build, local backend): Library create category → note → search →
  counts; onboarding scroll (forced overflow); camera "Open Settings" typechecks only.
- Server, live: `readDocument` on the flyer (3 s); research end to end (~6 s + ~2 s,
  two peer-reviewed papers with DOIs, honest about gaps); recall ranks the Library
  note #1 with its category after 012.
- 50 backend tests, 35 app tests; both typecheck.
- NOT yet: any Mr. Kandoo voice flow — the emulator account is Free and the agent is
  Elite-gated. Needs an Elite account (RevenueCat Test Store) on the device.

## Remaining steps (in order)

1. Secret scan, then push (Render auto-deploys the backend from master):
   ```
   git log -p origin/master..HEAD | grep -iE "sk-[a-zA-Z0-9]|AQ\.|service_role|SUPABASE_SERVICE|eyJ"
   git push origin master
   ```
   Then `https://kandoo-toow.onrender.com/library/research` must answer 401 (not 404).
2. Full phone build (~80 min, all 4 ABIs; release always talks to Render):
   ```
   cd android && ./gradlew assembleRelease -x lint -x test --no-parallel
   ```
   Copy `android/app/build/outputs/apk/release/app-release.apk` to the Desktop as
   `Kandoo-final.apk`.
3. On the phone, as Elite: "research how to price a subscription app for my Kandoo
   Project" → "write it up in points" → yes → open the note → tap a link.
   "Read this page into my Kandoo Project" with a real page. Ask Home "when am I filming?".
4. Film.

## Gotchas learned

- Gemini free tier: plain calls work, `googleSearch` grounding is 429 on all 5 keys.
  Key 1 hit its per-day quota tonight; `withKeyFailover` moved to key 2.
- Driving the dev build over adb: a long `adb shell input text` can lose field focus
  and stray letters hit RN dev shortcuts (r = reload, perf monitor). Tap the field,
  type short chunks. The perf monitor overlay is on in the emulator's dev menu.
- Shell edits: backticks and `\n` inside `node -e "…"` or sed get mangled. Use the
  editor, or a script file with a quoted heredoc; convert CRLF files carefully.
- `expo-image-picker` with `microphonePermission: false` REMOVES RECORD_AUDIO app-wide.
- `expo prebuild` wipes `android/local.properties` — restore
  `sdk.dir=C:/Users/DONEX/AppData/Local/Android/Sdk`.
- Release builds ignore `EXPO_PUBLIC_API_URL` and always hit Render.
- Git Bash mangles device paths: prefix adb with `MSYS_NO_PATHCONV=1`.
- Onboarding only shows signed-out; to see it on a signed-in device, force it
  temporarily in `src/app/index.tsx` and revert.

## Known small gaps

- Research sources are encyclopedic/scholarly; for today's news or product how-tos
  they are thin (the write-up says so rather than guessing).
- A flyer naming "Church Premises, Obuasi" makes a new place instead of matching one.
- Remove or keep this file before the repo goes public — it has no secrets.
