# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

---

# AGENTS.md — Kandoo

Standing project context. Read this before touching anything.

---

## 1. What Kandoo is

A context-aware personal memory and action assistant.

**Product statement:** Tell Kandoo once. It remembers when it matters.

**The thesis, in one line:** most assistants wait to be asked. Kandoo remembers
where and when a memory becomes useful, and brings it to you there.

Motto: **Yes You Kan.**

The whole product is ONE loop, not five features:

```
CAPTURE  →  EXTRACT  →  LINK  →  SURFACE
```

The user speaks without structure. A model turns speech into structured actions.
Actions are anchored to who / where / when. The app hands them back at the
moment they are useful.

Every use case is that loop with a different **trigger type**:

| Trigger | Example |
|---|---|
| time | "remind me at 4pm" |
| place | walks into the doctor's office → surfaces what was discussed there |
| person | a call with Jed → offers prior notes |
| manual | widget / in-app recall |

Reminders and alarms are not separate features. An alarm is a time trigger with
`insistent: true`.

Kandoo must not feel like a chatbot, a notes app, a calendar or a task manager.
It should feel like a quiet, premium assistant working in the background.

---

## 2. Deadline context — read before proposing any refactor

Entry for the **RevenueCat Shipaton 2026, Next Gen Award** (student category).
Submission closes **30 September 2026**.

Next Gen requires a **demo video** plus a **public open-source repo with a
LICENSE**. It does NOT require an app store release or a paid developer account.

Consequences that govern every decision:

- **The demo video is the deliverable.** Judges never use the app. If a change
  does not appear in the video or the repo, it has near-zero value this month.
- **The repo will be public.** No secrets, no leaked error internals, no user
  content in production logs.
- **Android only.** iOS is cut. Do not add iOS-specific work.
- **Prefer the smallest correct change.** There is no time for large refactors.

---

## 3. Architecture principles — do not violate these

### 3.1 The AI is the understanding layer, never the actor

```
USER → AI INTERPRETS → BUSINESS LOGIC DECIDES → DATABASE PERSISTS → USER
```

The AI never touches the database and never executes application actions. It
returns structured JSON, validated by Zod, and deterministic services act on it.
**Kandoo is not "an LLM with database access."**

### 3.2 The server is stateless; the device owns triggers

```
SERVER owns:  interpretation, persistence, retrieval, answer generation
DEVICE owns:  trigger registry, geofences, local notification scheduling
```

Time, location and presence are **device facts**. A server cannot know the user
walked into a building without streaming their location continuously — a battery
and privacy disaster. Never move trigger execution to the server.

Time reminders fire as **local notifications** and must work with the server
offline or stopped. The old `setInterval` server scheduler was deleted for this
reason; do not reintroduce it.

### 3.3 Nothing commits without user review

Extraction produces **proposed** actions. Reminders are created with
`status: 'pending'`. Nothing is scheduled until the user confirms. An assistant
that silently commits its own guesses to your day is one you stop trusting the
first time it is wrong. This boundary is the product.

### 3.4 Time comes from the device, never the server

Every request carries `clientTime` (ISO with offset) and `timezone` (IANA). The
extraction model resolves relative times ("tomorrow morning") into absolute ISO
instants. `timeNormalizer.ts` is a fallback only — do not extend it.

### 3.5 Location is bounded, never ambient

Never track the user. Only monitor **places that have memories anchored to
them**, capped and evicted by recency. Bounded monitoring is both better
engineering and a better answer when a judge asks about privacy.

### 3.6 Two models, two jobs

Extraction runs on every capture: small, fast, cheap, temperature 0. The
conversational/answer model runs only when the user asks something. Do not merge
them — that is how the unit economics die.

### 3.7 Never swallow errors silently

A `catch {}` that logs nothing, or a write whose error is never checked, turns a
real bug into an unfindable one. Two incidents so far came from exactly this:
a bare `catch {}` in ReviewSheet hid a failing confirm, and an unchecked
`update()` in `backfillEmbeddings` made a failed write look like success and
burned a day's embedding quota in a retry loop. Best-effort operations may
continue on failure, but they must **report** it to their caller.

---

## 4. Stack and configuration

**Mobile:** React Native · Expo · TypeScript · Expo Router · react-native-svg ·
react-native-reanimated · expo-haptics
**Backend:** Node · TypeScript · Express 5 (note: `req.params.id` is
`string | string[]` — wrap in `String()`)
**DB:** Supabase Postgres + pgvector + pg_trgm
**Auth:** Supabase Auth — the backend validates the bearer token and derives the
user id. It NEVER trusts a client-supplied user id.
**AI:** provider abstraction (`AIProvider`) with Gemini, OpenAI and Mock
implementations. Shared prompts live in `modules/ai/prompts.ts` — one copy, so a
tweak cannot silently apply to only one provider.
**Monetization:** RevenueCat (not yet implemented)

### AI provider — current

- `AI_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.6-flash`
- Google AI Studio now issues **`AQ.`-prefix Authentication Keys**, not `AIza`.
  An `AQ.` key is correct. Do not validate for `AIza`.
- `gemini-2.5-flash` is retired. Do not use it.
- **`thinkingBudget: 0` on both generation calls.** Gemini 3.x spends output
  budget on reasoning tokens and truncates visible output without it. Extraction
  needs a 2000-token ceiling; truncated JSON becomes a Zod failure.
- Embeddings: `gemini-embedding-001` at `outputDimensionality: 1536`, matching
  the `vector(1536)` column. `RETRIEVAL_DOCUMENT` when embedding memories,
  `RETRIEVAL_QUERY` when embedding a recall query.
- Backoff on 429 honours Google's stated `retryDelay` (often 30s), not a fixed
  ladder. A **per-day** quota is surfaced immediately instead of retried.
- Free tier: ~100 embeds/min, 1000/day, resetting midnight Pacific.

**NEVER switch embedding provider without re-embedding every memory.** Vectors
from different providers are not comparable; recall degrades in a way that looks
random rather than broken.

### Keys

- Mobile: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `EXPO_PUBLIC_API_URL`
- Backend: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`,
  `GEMINI_MODEL`, `AI_PROVIDER`

Never put a provider key in the root `.env` — everything there is
`EXPO_PUBLIC_`, which Metro inlines into the app bundle. The mobile app talks
only to the backend, never to an AI provider.

The service-role key **bypasses RLS**, so every backend query MUST filter
`.eq('user_id', userId)`. That filter is the only thing separating users from
each other's memories.

`EXPO_PUBLIC_` vars are inlined at bundle time. After changing one, restart Metro
with `--clear` or the old value persists in a cached bundle.

### Android / MuMu

- MuMu is not a Google AVD. `expo run:android --device` does not accept a raw adb
  serial.
- `adb connect 127.0.0.1:7555` →
  `cd android && ./gradlew assembleDebug -x lint -x test -PreactNativeArchitectures=x86_64 --no-parallel` →
  `adb -s 127.0.0.1:7555 install -r android/app/build/outputs/apk/debug/app-debug.apk`
- `adb -s 127.0.0.1:7555 reverse tcp:8081 tcp:8081` (Metro) resets whenever
  MuMu restarts. The backend needs no reverse: the app reaches it at `10.0.2.2`.
- `10.0.2.2` reaches the host from MuMu — verified with a TCP round-trip.
- Debug builds are **x86_64 only** (97MB, `--no-parallel` avoids Defender/Gradle
  file-lock races). This will NOT run on a physical phone — a real-device build
  needs all 4 ABIs and takes considerably longer. Budget for that before filming.
- Package is `app.kandoo.mobile`.

---

## 5. Data model

| Table | Purpose |
|---|---|
| `captures` | raw utterance, verbatim, never overwritten. `client_time`, `timezone`, `source` |
| `memories` | atomic facts. `content`, `embedding vector(1536)`, `topics[]`, `capture_id` |
| `reminders` | `task`, `due_at`, `place_hint`, `place_id`, `insistent`, `status` |
| `entities` | people / places / topics, deduped per user via a generated `normalized` column |
| `memory_entities` | join table |
| `push_tokens` | legacy; retired with the server-push path |

`reminders.status` ∈ `pending | confirmed | fired | dismissed | cancelled`

RLS is enabled on all tables with per-user policies. Captures are the only thing
that can never be regenerated — extraction can always be re-run over them when
the prompt improves.

---

## 6. The interpretation contract (v2)

One utterance produces **N actions**. This is the core of the product.

```ts
{
  summary: string | null,
  confidence: 'high' | 'low',
  actions: Array<
    | { kind: 'reminder', task, dueAt, placeHint, people[], insistent }
    | { kind: 'memory',   content, people[], placeHint, topics[] }
    | { kind: 'recall',   query, scopePerson, scopePlace }
  >
}
```

A v1 schema with a single `intent` was replaced because it could not represent
the flagship case: a 90-second meeting recap containing several tasks and several
facts. **Never collapse this back to one action per utterance.**

`memory.content` must be ONE standalone statement, pronouns resolved, filler
stripped, still meaningful in six months. Reminder text never goes inside memory
content.

Retrieval is hybrid: pgvector cosine (75%) fused with Postgres full-text
`ts_rank` (25%) via the `match_memories` RPC, degrading to lexical-only if
embedding fails. The old `ILIKE %whole question%` search could only ever return
zero rows.

---

## 7. Design

Full system: **https://claude.ai/artifact/6sDsL44XFTZzigvBGQeq7E**
Read `project/README.md` first, then `project/tokens.json`.

**The mark is Adinkrahene**, the "chief" of the Adinkra symbols (Ghana) —
concentric circles standing for greatness and leadership. (Earlier notes called
it Mmere Dane; that is a different symbol and was wrong.)
**Never deform it** — no morphing, stretching, or animating its paths
independently. Expression is colour, uniform scale, glow and opacity only.

**Colour carries state:** `live` (orange) listening → `accent` (amber) attention
→ `settled` (olive) done → `alarm` (deep red) escalation. Nothing decorative is
ever `accent`. `alarm` and `settled-fill` are fills only; they fail contrast as
text.

**Type:** Fraunces for the wordmark, headings, answers and **the user's own
words**; Inter for all UI chrome. Five font files maximum.

**Navigation:** Home · Memory · Places · Reminders. Capture is never a tab.
Kandoo Moments are a Home state, not a screen.

**Home is one route with four states** — idle → listening → understanding →
remembered. Not four screens.

**No spinners anywhere.** Extracted chips stagger in instead.

**Tokens only, no inline hex, ever.** `accent` lives in `src/theme/brand.json`,
which both `theme.ts` and `app.config.ts` import, so the splash colour is not
duplicated — and native config never depends on a TypeScript import.

---

## 8. Remaining work

| Block | Done when | Status |
|---|---|---|
| A. Schema | migration applied | ✅ |
| B. Contract | one utterance → many actions | ✅ B1 passes |
| C. Retrieval | recall answers a real question | ✅ semantic match verified |
| D. Deploy | phone hits a public URL | ⬜ |
| E. Local notifications | reminder fires with server off | ⬜ |
| F. Review card | pending → confirmed on device | ⬜ browser-proven, not device-proven |
| G. Voice | speak → actions appear | ⬜ |
| H. Geofence (Places, Pro) | walk in → reminder / Moment fires | 🟡 built on `feature/places`; needs migration 007 + device walk test |
| I. Design tokens + brand | theme, Symbol, BrandIntro | in progress |
| J. RevenueCat | paywall + `useEntitlement()` | ⬜ |
| K. Freeze → film → submit | submitted | ⬜ |

---

## 9. Test B1 — the acceptance test that matters most

Send as ONE capture:

> Just came out of the meeting with Jed. He's pushing the API migration to Q1
> because of the vendor issue, and the budget got cut by fifteen percent. I need
> to send Michael the spec before 5, and remind me to book the review room
> tomorrow morning.

Must produce **2 memories + 2 reminders in one response**, with memories atomic
and pronoun-resolved, "before 5" → 17:00 today as absolute ISO with offset,
"tomorrow morning" → 09:00 **tomorrow**, and all reminders `status: 'pending'`.

This test is the demo. Nothing downstream is worth building until it passes.

---

## 10. Working rules

**DO**

```
Inspect → understand → smallest correct change → typecheck → test → continue
```

- `npx tsc --noEmit` in both root and `backend/` after every change set
- Commit before starting anything large
- Explain what changed and why, briefly
- Push back when an instruction is wrong — that has already prevented a leaked
  key pattern and a broken JSON config

**DO NOT**

- Rewrite architecture from scratch
- Replace Supabase, the AI provider abstraction, or the shared prompts module
- Collapse `actions[]` back to a single intent
- Let the AI execute database operations
- Put database logic in mobile UI
- Reintroduce the server-side `setInterval` scheduler
- Return `error.message` to clients (leaks internals; the repo is public)
- Log user memory content in production
- Expose service-role or provider keys
- Sign in to the emulator or drive its login screen — the developer handles
  authentication manually; emulator autofill must stay disabled
- Delete working functionality because a new implementation looks cleaner
- Perform large refactors without tests

**Debugging rule:** RED ERROR → STOP → IDENTIFY → FIX → REVIEW → CONTINUE

---

## 11. Before the repo goes public

```bash
git log -p | grep -iE "sk-[a-zA-Z0-9]|AQ\.|service_role|SUPABASE_SERVICE|eyJ"
```

`.gitignore` does not un-commit. Anything found must be **rotated**, not just
deleted.

Confirm the LICENSE is MIT and assigned to the author, not to the Expo template.

Keep scratch files out: `.gradle-build.log`, `backend/.dev-server.log`,
`backend/.test-*.cjs`.

Worth one line in the public README: the mark is Adinkrahene, the "chief" of the
Adinkra symbols. Also state honestly that development runs on the Gemini
free tier, and that production would require Tier 1 for the no-training
commitment.

---

## Appendix — operational recipes

Things that each cost real hours once. Read before running a build.

**`app.config.ts` must not import a `.ts` file.** Expo's config loader only
transpiles the config file itself; a nested `.ts` import works on Node ≥ 23.6
(native type stripping) and fails with "Cannot find module" on Node 20/22 —
which is what a judge may clone with. Shared values go in `src/theme/brand.json`,
which Node reads natively on every version.

**`expo prebuild --clean` wipes `android/local.properties`.** Recreate it with
`sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk` or Gradle fails with "SDK
location not found". Plain `expo prebuild` (no `--clean`) also clears and
regenerates `android/`, so treat the two as equivalent here.

**`google-services.json` is copied at prebuild time.** After replacing the root
file, prebuild again or `android/app/google-services.json` is stale and Gradle
fails with "No matching client found for package name".

**An interrupted native build leaves locked `.cxx` directories.** Symptom:
"used by another process" or "ninja: failed recompaction: Permission denied" on
the next build. Recovery:

```powershell
Get-Process -Name java,ninja,cmake,clang -ErrorAction SilentlyContinue | Stop-Process -Force
```

then delete `android/app/.cxx`, `android/app/build/intermediates/cxx`, and each
native library's `android/.cxx` (`react-native-worklets`, `react-native-reanimated`,
`react-native-svg`) before rebuilding. Gradle daemons can take several seconds
to actually exit after `Stop-Process`; verify with `Get-Process` before rebuilding.

**A 4-ABI build races Defender on Windows.** Freshly written CMake/ninja files get
scanned mid-write and the parallel per-ABI configure fails on a lock. Build a
single ABI with `--no-parallel` for MuMu; for a real-device build, expect to
retry or exclude the project directory from real-time scanning.

**Backend logs under `nohup … > file 2>&1` are block-buffered.** Node does not
flush stdout/stderr to a redirected file until exit, so a running server's log
looks empty even after requests succeed. To see a real error, reproduce it from
a one-off script that prints to a terminal, not from the server log.

**`service_role` bypasses RLS but not table grants.** An UPDATE can return
`42501 permission denied` on one table while succeeding on another under the same
key. `memories`, `reminders`, `captures`, `entities` and `memory_entities` were
all missing UPDATE/DELETE and have been granted; check
`information_schema.role_table_grants` in the SQL editor if a write fails.

**Never export a component named `Symbol`.** A module-scope binding called
`Symbol` shadows the JS global, and Babel's emitted helpers reference
`Symbol.iterator` / `Symbol.for` — those then resolve to the component and the
first render throws `TypeError: undefined is not a function` with the app
showing the dev client's blank grey. The mark is exported as `KandooSymbol`
(`src/components/Symbol.tsx`) for exactly this reason. The same applies to any
other global name (`Map`, `Set`, `Text`-style collisions are caught by TS; a
value that shadows a global is not).

**Native modules need a rebuild.** Adding `react-native-svg` or any other native
dependency is not picked up by Metro alone; prebuild and rebuild the APK.

**Metro can wedge: socket LISTENING but not serving.** The port shows up in
`netstat` and `adb reverse` looks fine, but the device (and the host itself)
gets nothing. Test with `curl http://127.0.0.1:8081/status` from the HOST — it
must return `packager-status:running`. If it hangs or returns empty, Metro is
wedged: kill it and `npx expo start --clear` again. This is not a network,
firewall, or reverse problem, so don't chase those first.

**Uninstall any stale `com.anonymous.kandoo` before deep-linking.** Before the
package rename the app was `com.anonymous.kandoo`, and an old install can linger.
Both it and `app.kandoo.mobile` register the `kandoo://` scheme, so a deep link
raises an "Open with" chooser and often launches the stale app (with its old
cached error screen). `adb -s <mumu> uninstall com.anonymous.kandoo` once, then
deep-links resolve unambiguously.

**MuMu's Android instance can quit under build load.** `MuMuNxMain` (launcher)
stays up while `MuMuNxDevice` (the device) is gone and no ADB ports are open.
Reopen the emulator window, then `adb connect` again.

**A flaky network turns a non-fatal 404 into a hard build failure — retry
before debugging.** `commons-io:1.4` (a transitive dep of `expo-file-system`)
lives on **Maven Central, not Google Maven**: `dl.google.com` returns 404 for
it and Gradle is supposed to fall through `google()` → `mavenCentral()`. But a
*transport* error (timeout, DNS "No such host") on `google()` aborts resolution
before the fallthrough, so intermittent connectivity surfaces as
`Could not resolve commons-io:commons-io:1.4` at `:app:mergeReleaseNativeLibs` —
a dependency error that looks like a build/config bug but is not. This bit the
first two 4-ABI builds. Fix: confirm the network, then just re-run. Once the
artifact caches from Central it never blocks again. Verify with
`curl -m8 https://repo1.maven.org/maven2/commons-io/commons-io/1.4/commons-io-1.4.pom`
(200 = reachable); a 404 from `dl.google.com` for the same path is expected and
harmless.

**A 4-ABI release build takes ~80 minutes; a single-ABI debug build ~15.** The
phone-runnable APK is `./gradlew assembleRelease -x lint -x test --no-parallel`
with NO `-PreactNativeArchitectures` override, so it builds all four ABIs
(`armeabi-v7a,arm64-v8a,x86,x86_64` from `gradle.properties`). The `release`
build type signs with the existing `debug.keystore` (see `signingConfig
signingConfigs.debug` in `app/build.gradle`), so it is installable on hardware
with no keystore setup, and R8 is OFF by default
(`enableMinifyInReleaseBuilds` defaults false) — the APK is ~107MB, unminified.
The arm cross-compile and the Defender/`.cxx` race did NOT bite under
`--no-parallel`; the real cost is just the ~80 min of 4× native work. Voice can
only be filmed on hardware (no emulator has an `android.speech.RecognitionService`),
so this build is mandatory before filming — do not first discover its runtime on
the 28th.

**Places: the OS reports every region's CURRENT state the moment you register.**
expo-location registers geofences with `INITIAL_TRIGGER_ENTER | INITIAL_TRIGGER_EXIT`,
so (re)registering while at home sends ENTER for home at once. `placeRules.ts`
records that burst silently (the `settleUntil` window) — otherwise "when I get
home" fires while the user is sitting at home. `placeSync` only re-registers
when the set of circles actually changes. expo-task-manager restores the task
after a reboot (BOOT_COMPLETED), and the persisted region state keeps that
second burst silent too.

**Places: irregular shapes are covered by circles, not watched with GPS.**
Android geofences are circles only. A traced shape is covered by ≤ 6 circles
centred inside it (`coverCircles`, `src/utils/geo.ts`). The alternative —
starting a location foreground service on arrival to check the exact shape —
is restricted from the background on Android 12+ and would fail silently.
`src/utils/geo.ts` is byte-copied to `backend/src/modules/places/geo.ts`;
edit the app copy, then copy it — a backend test fails if they differ.

**Never import MapLibre's `Map` under its own name.** Same trap as `Symbol`:
`import { Map as MapView } from '@maplibre/maplibre-react-native'`.

**The app entry is `index.ts`, not `expo-router/entry`.** It defines the
geofence task before anything else loads, because Android can start Kandoo
headless just to run it. Do not point `main` back at `expo-router/entry`.

