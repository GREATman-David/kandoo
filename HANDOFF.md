# Kandoo — handoff (30 Sep 2026, evening)

Read `AGENTS.md` first, then this. Submission (Shipaton Next Gen) closes **30 Sep 2026** —
the demo video + public repo are the deliverables.

## Where things stand

**Local commits NOT pushed yet** (the user asked not to push until Show Kandoo is done):

```
85f32e7 Keep RECORD_AUDIO: the image-picker plugin removed it app-wide
6ef065c Show Kandoo: photos as captures, a private photo library, watermarked sharing
```

Everything before those is on `origin/master` (last pushed: "Polish: Free/Pro/Elite pills,
Mr. Kandoo, satellite for Agent maps…"). `Kandoo-final.apk` on the Desktop is that older
pushed build — it does NOT have Show Kandoo.

## Show Kandoo (the new feature) — what it is

Photo → the same capture loop as speech (CAPTURE → EXTRACT → LINK → SURFACE).

- **Server** (`backend/`):
  - `POST /interpret/photo` (`src/routes/photos.ts`): Gemini reads the JPEG with
    `photoExtractionPrompt` (`modules/ai/prompts.ts`) → same actions contract +
    `description`. Recall is never produced from a photo (`withoutRecall`).
    Reminders come back `pending` for the review card.
  - Photo kept only for Pro/Elite (`getUserTier`); Free gets `photoNeedsPro: true`.
  - `modules/photos/photoService.ts`: private bucket `photos/<userId>/<uuid>.jpg`,
    signed URLs (1 h), `photo_entities` links to people/places + the drawn place the
    phone is in. Every query filters `user_id`.
  - `GET /photos?entityId|q|limit`, `POST /photos` (add to person/place, Pro),
    `POST /photos/:id/links`, `DELETE /photos/:id`.
  - Recall results carry `photos`; `GET /captures` adds `photoUrl` for photo captures.
  - JSON body limit is 8 MB only for `/interpret/photo` and `/photos` (`server.ts`).
  - Migration `backend/migrations/010_photos.sql` — **already run** in Supabase.
    The `photos` bucket was created via the storage API (private, JPEG, 5 MB).
- **App**:
  - `src/services/photos.ts`: pick (camera/gallery) + re-encode ≤1600px JPEG
    (strips EXIF GPS) + `currentPlaceIds()`.
  - Home (`src/app/index.tsx`, `features/Home/useHome.ts` → `showPhoto`): camera
    button in the input, "Reading your photo", photo on the understood card,
    "Photo kept with … · Open · Share" or Pro nudge, Recently thumbnails, recall
    "From your photos".
  - `PhotoViewer.tsx`: photo card with watermark (mark + "Kandoo" beneath), Share
    via react-native-view-shot + expo-sharing (shares exactly the card).
  - `PhotoStrip.tsx` on `PersonDetail` and `PlaceDetail` (album + "Add photo").
  - `PlaceHomeCards.tsx`: "At <place>" card shows the place's last photo.
  - Mr. Kandoo: `find_photos` client tool (`services/agent/agentTools.ts`,
    `agentShown.ts`, photos row in `KandooAgent.tsx` timeline).
- **ElevenLabs agent** `agent_1601m3r68w2gfnq8azxfe9hjts88` — ALREADY LIVE:
  `find_photos` tool (`tool_4001m3st39xpf4mtqnkdfbr8qycc`) attached (33 tools),
  prompt has a `# Photos` section, turn_timeout 20, "digits stay digits" rule.
  If you edit via MCP: send `body` and `prompt` in SEPARATE `agents_update` calls.

## Verified on the emulator (debug build, local backend)

Flyer from gallery → "I understood" (Pastor Kwame Mensah chip, reminder Sat Oct 3
10:00) → Remember → photo kept with person + place → photo card → shared JPEG has
the watermark → person page Photos album → Recently thumbnail. Server: signed URL
200, other users see 0, delete works, recall memory → its photo. 38 backend tests,
35 app tests pass; both typecheck.

## Remaining steps (in order)

1. **Finish the debug rebuild** (was running: `debug6.log`), install, open
   Mr. Kandoo, TYPE "show me the outreach flyer" → photos appear in the timeline.
   (The previous build lacked RECORD_AUDIO — fixed in 85f32e7; needs the rebuild.)
   On first open Android asks for the mic — allow it.
2. Optional checks: Add photo on a place page; Free-tier nudge.
3. `npx tsc --noEmit` (root + backend), `npm test` (root + backend).
4. Secret scan, then push (Render auto-deploys the backend from master):
   ```
   git log -p origin/master..HEAD | grep -iE "sk-[a-zA-Z0-9]|AQ\.|service_role|SUPABASE_SERVICE|eyJ"
   git push origin master
   ```
   Then confirm `https://kandoo-toow.onrender.com/interpret/photo` answers 401 (not 404).
5. **Full phone build** (~80 min, all 4 ABIs; release always talks to Render):
   ```
   cd android && ./gradlew assembleRelease -x lint -x test --no-parallel
   ```
   Copy `android/app/build/outputs/apk/release/app-release.apk` to the Desktop as
   `Kandoo-final.apk`. Test on the phone: camera capture, voice, Mr. Kandoo.
6. Film the demo. Suggested Show Kandoo beat: photograph a real flyer → chips →
   Remember → open the person → share the watermarked card → ask Mr. Kandoo for it.

## Gotchas learned today

- `expo-image-picker` with `microphonePermission: false` REMOVES RECORD_AUDIO
  app-wide. Never set it.
- `expo prebuild` wipes `android/local.properties` — restore
  `sdk.dir=C:/Users/DONEX/AppData/Local/Android/Sdk`.
- Release builds ignore `EXPO_PUBLIC_API_URL` and always hit Render, so new routes
  must be pushed before a release APK can use them. Test unpushed server code with a
  debug build + `adb reverse tcp:3000 tcp:3000` + `adb reverse tcp:8081 tcp:8081`.
- Git Bash mangles device paths (`/sdcard/...`): prefix adb commands with
  `MSYS_NO_PATHCONV=1`.
- Python edit scripts: write them to a file first; heredocs with `'\n'` inside TS
  strings get turned into real newlines.
- A head-only Supabase count (`{ head: true }`) hides "table missing" errors — use
  `select('*').limit(1)` to check a table exists.
- Emulator: data was cleared for the onboarding walkthrough; the user signed in
  again. No app passcode is set now. Test flyer is in the gallery
  (`/sdcard/Pictures/outreach-flyer.jpg`).
- Metro wedges: `curl http://127.0.0.1:8081/status` must say `packager-status:running`;
  otherwise kill it and `npx expo start --clear` in its own window.

## Known small gaps (not blocking)

- A flyer naming "Church Premises, Obuasi" creates a new place rather than matching
  an existing "church premises" — can be merged from the place page.
- Photo capture takes ~30 s end to end on the free Gemini tier (reading itself ~5 s).
- Android "Open Settings" button when a permission is permanently denied (the message
  says so, but there's no button).
- Remove `HANDOFF.md` (or keep it) before the repo goes public — it has no secrets.
