# Kandoo

**Tell Kandoo once. It remembers when it matters.**

Kandoo is a personal memory and action assistant. You speak naturally — a messy
recap after a meeting, a thought on the walk home — and it works out the people,
times and commitments in what you said, keeps what matters, and brings it back
when it matters: as a reminder at the right time, or the moment you ask.

Most assistants wait to be told exactly what to do. Kandoo takes one unstructured
sentence and turns it into the reminders, memories and notes inside it.

Built for the **RevenueCat Shipaton 2026 — Next Gen Award**.

---

## Demo

> **Demo video:** _coming soon — link will be added here before submission._

> **Screenshot:** _coming soon._
>
> <!-- ![Kandoo review sheet](docs/screenshot-review.png) -->

---

## The mark

Kandoo's symbol is **Adinkrahene**, the Adinkra symbol from Ghana known as the
"chief" of the Adinkra symbols — concentric circles standing for greatness,
leadership and the idea at the centre of everything else. For Kandoo it is the
one place everything you've told it comes back to.

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
4. **Surface.** Nothing is scheduled until you review it. Once confirmed, the
   device — not the server — owns the trigger, so a reminder fires on time even
   with no connection. (Place and person triggers are on the roadmap.)

### What's in this build

- **Voice or text capture** — on-device speech recognition; one utterance can
  hold several reminders and memories.
- **Understood → review → remember** — every extracted action is shown before it
  counts; reminders stay `pending` until you confirm them.
- **Recall** — ask about anything you've said; the answer is written from your
  own memories, and can be read aloud.
- **Take note** — turn any capture into a clean, professional note.
- **Local reminders** — scheduled on the phone, delivered with the server off.
- **Offline** — what you've already seen stays readable with no connection, and
  questions are answered from what's saved.
- **Kandoo Pro (RevenueCat)** — Free recall reaches back ten days; Pro reaches
  back across your whole history.

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

### Monetization — RevenueCat

Kandoo Pro is a single `kandoo_pro` entitlement sold as monthly and annual
packages from the RevenueCat **current offering**. The line between Free and Pro
is *memory depth*, and it is enforced **on the server**: the backend reads the
entitlement from RevenueCat's V2 REST API, keyed by the Supabase user id (the
app calls `Purchases.logIn` with that id), so a modified client cannot unlock
older memories. The paywall appears only at that boundary — when a question
reaches past the free ten days — never on launch.

This build uses RevenueCat's **Test Store**, since it is distributed as an APK
rather than through Google Play.

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

`backend/.env` needs your Supabase URL and **service-role** key,
`GEMINI_API_KEY` / `GEMINI_MODEL` with `AI_PROVIDER=gemini`, and
`REVENUECAT_SECRET_KEY` / `REVENUECAT_PROJECT_ID` for the Pro check (without
them everyone is treated as Free). The service-role key must never reach the
mobile app.

The server listens on port 3000. `GET /health` confirms it's up.

### 2. Mobile

```bash
npm install
cp .env.example .env     # then fill it in
```

`.env` needs your Supabase URL and **anon/publishable** key, the backend URL,
and `EXPO_PUBLIC_REVENUECAT_KEY` (the RevenueCat public SDK key). From a Google
AVD the host is reachable at `10.0.2.2`, so use
`EXPO_PUBLIC_API_URL=http://10.0.2.2:3000`; with `adb reverse tcp:3000 tcp:3000`
(any emulator, including MuMu) `http://127.0.0.1:3000` works too.

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
| Understood / review / remember | ✅ |
| Voice capture and spoken answers | ✅ |
| Local notifications (fire offline) | ✅ |
| Take note | ✅ |
| Offline reading and recall | ✅ |
| RevenueCat Pro (server-enforced) | ✅ |
| Design system and brand | ✅ |
| Place triggers (geofencing) | planned |
| Person triggers | planned |
| Usage-based free tier limits | planned · post-submission |

---

## License

MIT — see [LICENSE](LICENSE).
