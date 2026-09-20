# Kandoo

**Tell Kandoo once. It remembers when it matters.**

Kandoo is a personal memory and action assistant. You speak naturally — a messy
recap after a meeting, a thought on the walk home — and it works out the people,
places, times and commitments in what you said, keeps what matters, and brings it
back at the moment it becomes useful: at the time, at the place, with the person.

Most assistants wait to be asked. Kandoo remembers *where* and *when* a memory
becomes useful, and hands it to you there.

Built for the **RevenueCat Shipaton 2026 — Next Gen Award**.

---

## Demo

> **Demo video:** _coming soon — link will be added here before submission._

> **Screenshot:** _coming soon._
>
> <!-- ![Kandoo review sheet](docs/screenshot-review.png) -->

---

## The mark

Kandoo's symbol is **Mmere Dane**, an Adinkra symbol from Ghana meaning *time
changes* — which is the product: information is worthless at the wrong moment
and valuable at the right one.

---

## How it works

One loop, not five features:

```
CAPTURE  →  EXTRACT  →  LINK  →  SURFACE
```

1. **Capture.** You say or type something unstructured. The raw words are saved
   verbatim and never overwritten.
2. **Extract.** A model turns that one utterance into *many* structured actions
   — reminders, memories, and questions about things you said before. A single
   meeting recap can produce several of each.
3. **Link.** Each action is anchored to who, where and when, and memories are
   embedded for semantic search.
4. **Surface.** Nothing is committed until you review it. Once confirmed, the
   device — not the server — owns the trigger: a time, a place, a person.

### Architecture in brief

```
USER → AI INTERPRETS → BUSINESS LOGIC DECIDES → DATABASE PERSISTS → USER
```

- **The AI is the understanding layer, never the actor.** It returns JSON that is
  validated with Zod; deterministic services act on it. Kandoo is not "an LLM
  with database access."
- **The server is stateless; the device owns triggers.** Time, location and
  presence are device facts. Reminders fire as local notifications and work with
  the server offline.
- **Nothing commits without review.** Extracted reminders are created `pending`
  and are only scheduled after you confirm them.
- **Time comes from the device.** Every request carries the device's clock and
  IANA timezone; relative times ("tomorrow morning") are resolved into absolute
  instants against those.
- **Retrieval is hybrid.** Vector similarity (pgvector) fused with Postgres
  full-text ranking, so a recall query finds a memory it shares no words with.

**Stack:** React Native · Expo · TypeScript · Expo Router · Reanimated — Node ·
Express 5 — Supabase (Postgres, pgvector, Auth) — Google Gemini via a provider
abstraction (OpenAI and a mock provider are also implemented).

### AI provider

Development runs on the Gemini API free tier, which is rate-limited and does not
carry Google's no-training commitment. A production deployment would need a paid
tier (Tier 1 or above) for that guarantee, and for the request volume a real
user base generates.

---

## Running it

Android only. iOS is out of scope for this release.

### Prerequisites

- **Node 20 or newer**
- Android Studio with the SDK, or an Android emulator (developed against
  [MuMu Player](https://www.mumuplayer.com/); Google's AVD also works)
- A [Supabase](https://supabase.com) project
- A [Google AI Studio](https://aistudio.google.com) API key

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env     # then fill it in
npm run dev
```

`backend/.env` needs your Supabase URL and **service-role** key, and
`GEMINI_API_KEY` / `GEMINI_MODEL` (see `.env.example` for the current model).
The service-role key must never reach the mobile app.

The server listens on port 3000. `GET /health` confirms it's up.

### 2. Mobile

```bash
npm install
cp .env.example .env     # then fill it in
```

`.env` needs your Supabase URL and **anon/publishable** key, and the backend URL.
From an Android emulator the host machine is reachable at `10.0.2.2`, so use
`EXPO_PUBLIC_API_URL=http://10.0.2.2:3000`.

Everything in the root `.env` is inlined into the JS bundle at build time — never
put a secret there. After changing it, restart Metro with `--clear`.

### 3. Build and run

The app uses native modules, so it needs a development build rather than Expo Go.

```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleDebug -x lint -x test -PreactNativeArchitectures=x86_64 --no-parallel
cd ..
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081
npx expo start --clear
```

`-PreactNativeArchitectures=x86_64` builds only the emulator's ABI, which is
several times faster. For a physical phone, omit that flag to build all four.

If you're on MuMu rather than a Google AVD, connect adb first with
`adb connect 127.0.0.1:7555`, and use `adb -s 127.0.0.1:7555` for the install and
reverse commands above.

---

## The acceptance test

Send this as **one** capture:

> Just came out of the meeting with Jed. He's pushing the API migration to Q1
> because of the vendor issue, and the budget got cut by fifteen percent. I need
> to send Michael the spec before 5, and remind me to book the review room
> tomorrow morning.

Kandoo should return **two memories and two reminders** in a single response:
memories atomic and pronoun-resolved ("Jed is pushing…", not "he said…"),
"before 5" resolved to 17:00 today, "tomorrow morning" to 09:00 tomorrow, and
both reminders `pending` until you confirm them.

---

## Status

| | |
|---|---|
| Multi-action extraction | ✅ |
| Hybrid semantic recall | ✅ |
| Review sheet with confirm | ✅ |
| Design system and brand | in progress |
| Local notifications | planned |
| Voice capture | planned |
| Place triggers (geofencing) | planned |
| RevenueCat | planned |

---

## License

MIT — see [LICENSE](LICENSE).
