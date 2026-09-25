# Kandoo — UI Architecture & Build Plan

Everything decided in design review, in four parts:

1. **The flow map** — what connects to what, every screen, every button
2. **Key information** — the rules and reasoning behind the map
3. **Already built** — needs merging with the new UI only
4. **Not built** — must be created from scratch

---

# PART 1 — THE FLOW MAP

## 1.1 Entry

```
COLD START
    │
    ▼
NATIVE SPLASH ─────────► BRAND INTRO ─────────► has session?
(Adinkrahene on cream)   (mark → "Kandoo"           │
                          → "Yes You Kan")          │
                                            ┌───────┴───────┐
                                           NO              YES
                                            │               │
                                            ▼               ▼
                                   first launch?          HOME
                                       │                (tab: Home)
                              ┌────────┴────────┐
                             YES               NO
                              │                 │
                              ▼                 │
                        ONBOARDING              │
                        (3 cards, swipe)        │
                              │                 │
                              └────────┬────────┘
                                       ▼
                                   SIGN IN
```

### ONBOARDING — 3 cards, first launch only

```
Card 1: what Kandoo does    Card 2: how you talk to it    Card 3: how it remembers
[Skip]                  ·  [• • •]  ·                     [Get started] → SIGN IN
```

### SIGN IN

```
┌─ SIGN IN ──────────────────────────────┐
│  Kandoo (Fraunces Italic)              │
│  Yes You Kan                           │
│  [mark]                                │
│  [ Email ]                             │
│  [ Password ]                          │
│  [ Sign in ]  ──────► HOME             │
│  Forgot password? ───► RESET SHEET     │
│  Need an account? Create one ──► SIGN UP│
└────────────────────────────────────────┘

States: idle · submitting (button label "Signing in…", disabled)
        error (inline, plain language, never raw exceptions)
```

`SIGN UP` — same layout, "Create account" button, back link to Sign in.
On success → HOME (empty states everywhere).

`RESET SHEET` — email field, "Send reset link", confirmation line.

**On successful sign-in, three things fire before Home paints. None blocks it:**
`Supabase session` · `Purchases.logIn(supabaseUserId)` · `reminder sync + reconcile`

---

## 1.2 The shell

```
┌──────────────────────────────────────────────┐
│  Kandoo                          [ Free ]    │ ← badge → ACCOUNT SHEET
│                                               │
│                  ( screen )                   │
│                                               │
├───────────────────────────────────────────────┤
│   Home      Memory      People     Reminders  │
└───────────────────────────────────────────────┘
```

The **Free / Kandoo Pro** badge appears on all four tabs, top right.

```
ACCOUNT SHEET (bottom sheet)
├── Get Kandoo Pro  ─────► PAYWALL        (free users)
│   or Manage subscription (Pro; hidden on Test Store)
├── Restore purchase ────► RevenueCat restore → toast
├── ─────────────────
└── Sign out ────► confirm dialog "Sign out of Kandoo?"
                   [Cancel] [Sign out] → SIGN IN
```

---

## 1.3 HOME — one route, five states

```
        ┌──────────── IDLE ────────────┐
        │  mark (large, centred)       │
        │  "Good evening."             │
        │  "What should I remember     │
        │   for you?"                  │
        │  RECENTLY (3 rows) ──────────┼──► NOTE DETAIL / locked → PAYWALL
        │  [ Tell Kandoo anything… 🎙 ]│
        └──────┬────────────────┬──────┘
          type │                │ tap 🎙
               ▼                ▼
        ┌──────────── LISTENING ───────────┐
        │  mark + animation                │
        │  "Listening…"                    │
        │  live transcript (serif)         │
        │  [ Cancel ]   [ Stop ]           │
        └──────┬──────────────────┬────────┘
        Cancel │                  │ Stop → POST /interpret
               ▼                  ▼
             IDLE        ┌─── UNDERSTANDING ───┐
                         │  mark (amber, breathing) │
                         │  "I UNDERSTOOD"          │
                         │  note title              │
                         │  chips (stagger in)      │
                         │  [ Edit ]  [ Remember ]  │
                         └───┬──────────────┬───────┘
                        Edit │              │ Remember
                             ▼              ▼
                     REVIEW SHEET    ┌── REMEMBERED ──┐
                                     │ mark (still)   │
                                     │ "I'VE GOT IT"  │
                                     │ ✓ memory rows ─┼─► MEMORY DETAIL
                                     │ ✓ reminder rows┼─► REMINDER DETAIL
                                     │ [ Done ] ──────┼─► IDLE
                                     └────────────────┘

        ┌──────────── ANSWERED ────────────┐   ← recall actions land here,
        │  mark + animation                │     not Understanding
        │  answer streams in gradually     │
        │  SOURCES: note rows ─────────────┼──► NOTE DETAIL
        │  [ Done ] ──────────────────────►│    IDLE
        └──────────────────────────────────┘
             │ if boundary hit
             └──────► PAYWALL
```

**Failure:** interpret fails → back to LISTENING, transcript intact, plain-language
error line. No connection → same. Nothing is queued; nothing is lost from the field.

### REVIEW SHEET

```
┌─ REVIEW SHEET (bottom sheet over dimmed Home) ─┐
│  FROM WHAT YOU SAID                            │
│  <note title>                                  │
│                                                │
│  N REMINDERS                                   │
│  ┌ • Needs review          [✕]  ┐  ← tap = expand inline edit
│  │ Send Michael the spec        │     text editable
│  │ [Today, 5:00 PM]             │     time chip → TIME ENTRY
│  └──────────────────────────────┘     person chip → remove
│                                                │
│  N MEMORIES                                    │
│  ┌ • Needs review          [✕]  ┐              │
│  │ Jed is pushing the migration │              │
│  └──────────────────────────────┘              │
│                                                │
│  [ Edit ]        [ Keep all ]                  │
│  Not now                      ← quiet link     │
└────────────────────────────────────────────────┘

Keep all  → confirms every reminder, cascade settle 90ms apart → REMEMBERED
Not now   → note + memories SAVED and marked unconfirmed
             reminders stay `pending` → visible in Reminders ▸ Needs review
✕ on card → removes that one item only
```

---

## 1.4 MEMORY

```
┌─ MEMORY ───────────────────────────────┐
│  Memory                                │
│  [ Ask about anything you've said… 🔍 ]┼──► ANSWERED (same as Home)
│                                         │    boundary → PAYWALL
│  ┌ Standup with Jed — API…      📄 ┐   │
│  │ 2 hours ago · 4 items           │───┼──► NOTE DETAIL
│  └─────────────────────────────────┘   │
│  ┌ The budget was cut…          👤 ┐   │
│  │ From Standup with Jed           │───┼──► MEMORY DETAIL
│  └─────────────────────────────────┘   │
│  ┌ Dr. Mensah: Vitamin D…    📄 👤 ┐   │
│  │ Yesterday                        │──┼──► SPLIT VIEW
│  └─────────────────────────────────┘   │
│  ┌ 🔒 Sprint review recap          ┐   │
│  │ Part of Kandoo Pro              │───┼──► PAYWALL
│  └─────────────────────────────────┘   │
│                                         │
│  [ + Add something new ] ───────────────┼──► ADD SHEET
└─────────────────────────────────────────┘

Long-press any row → [Delete] → confirm dialog
Icons: 📄 has a note · 👤 has memories · both = SPLIT VIEW
```

```
ADD SHEET
├── Note only    → NOTE DETAIL (empty, edit mode)
├── Memory only  → MEMORY DETAIL (empty, edit mode)
└── Both         → SPLIT VIEW with one empty note + one empty memory
```

```
┌─ NOTE DETAIL ──────────────────────────┐
│  [‹]                            [✏]    │ ← pencil = edit title + body
│  <title>                               │
│  Captured 2 hours ago                  │
│  <clean body, serif>                   │
│                                         │
│  CONNECTIONS                            │
│  [👤 Jed] ──────────────────────────────┼──► PERSON DETAIL
│  [👤 Michael]                           │
│  [🕐 Send spec · Today 5:00 PM] ────────┼──► REMINDER DETAIL
│  ─────────────────────────────          │
│  What you said              [⌄] ────────┼──► expands verbatim capture
└─────────────────────────────────────────┘

Manual notes: no CONNECTIONS, no "What you said";
              a quiet "Written by you" label instead.
```

```
┌─ MEMORY DETAIL ────────────────────────┐
│                                 [✏]    │
│  <memory text, serif>                  │
│  From <note title> · 2 hours ago  [›] ─┼──► NOTE DETAIL
│  ─────────────────────────────          │
│  What you said              [⌄]        │
└─────────────────────────────────────────┘

Editing a memory RE-EMBEDS it on save.
```

```
┌─ SPLIT VIEW ───────────────────────────┐
│  [‹]                                   │
│  TWO WAYS TO SEE THIS                  │
│  ┌ 📄 NOTE ┐  ┌ 👤 MEMORY ┐            │
│  │ preview │  │ preview   │            │
│  └────┬────┘  └─────┬─────┘            │
│  Captured yesterday                    │
└───────┼─────────────┼──────────────────┘
        ▼             ▼
   NOTE DETAIL   MEMORY DETAIL
```

---

## 1.5 PEOPLE

```
┌─ PEOPLE ───────────────────────────────┐
│  People                                │
│  People Kandoo knows from what         │
│  you've said.                          │
│                                         │
│  (J) Jed                           🕐  │
│      Pushing the API migration to Q1   │───► PERSON DETAIL
│      3 memories · 1 reminder            │
│  ─────────────────────────────          │
│  (M) Mum                                │
│      Dad's checkup is on Thursday       │
│      4 memories                         │
└─────────────────────────────────────────┘

Ordered by most recently mentioned. Summary = most recent memory text.
🕐 = has an active reminder.
Long-press → [Merge with…] [Delete] → confirm
```

```
MERGE FLOW
long-press "Mum" → Merge with… → multi-select ["Mummy", "Mom"] → Confirm
  dialog: "Mummy and Mom will be merged into Mum.
           All memories, reminders and notes move across."
  → the long-pressed person survives
```

```
┌─ PERSON DETAIL ────────────────────────┐
│  [‹]                                   │
│         (J)                            │
│        Jed                             │
│  3 memories · 1 reminder · 1 note      │ ← each count tappable
│    │             │            │        │
│    ▼             ▼            ▼        │
│  MEMORY       REMINDERS     MEMORY     │
│  filtered     filtered      filtered   │
│  by Jed       by Jed        by Jed     │
│                                         │
│  WHAT YOU KNOW                          │
│  He's pushing the migration…      [›] ──┼──► MEMORY DETAIL
│  The vendor issue is unresolved   [›]   │
│  🔒 Part of Kandoo Pro            [›] ──┼──► PAYWALL
│                                         │
│  WHAT YOU PROMISED                      │
│  Send him the revised timeline    [›] ──┼──► REMINDER DETAIL
│  Friday, 10:00 AM                       │
│                                         │
│  MENTIONED IN                           │
│  Standup with Jed — API…          [›] ──┼──► NOTE DETAIL
└─────────────────────────────────────────┘
```

Filtered lists open the normal Memory / Reminders screen with a
`[ Jed ✕ ]` chip at the top; ✕ clears the filter.

---

## 1.6 REMINDERS

```
┌─ REMINDERS ────────────────────────────┐
│  Reminders                             │
│                                   [+] ─┼──► NEW REMINDER
│                                         │
│  NEEDS REVIEW  (only if any pending)    │
│  ┌ • Book the review room          ┐   │
│  │ Tomorrow, 9:00 AM — guessed     │───┼──► reopens REVIEW SHEET
│  └─────────────────────────────────┘   │
│                                         │
│  TODAY                                  │
│  ┌ Send Michael the updated spec   ┐   │
│  │ [5:00 PM]            [Michael]  │   │  tap time → complete
│  └──────┬──────────────────────────┘   │  tap row  → REMINDER DETAIL
│         └───────────────────────────────┼──► DETAIL
│  UPCOMING                               │
│  ┌ Book the review room            ┐   │
│  │ Tomorrow, 9:00 AM               │   │
│  └─────────────────────────────────┘   │
│                                         │
│  HISTORY  2                       [⌄]  │
└─────────────────────────────────────────┘

tap the time pill → marks done, row animates to History, "Undo" for 5s
long-press row    → [Delete] → confirm
```

```
┌─ REMINDER DETAIL ──────────────────────┐
│                                 [✏]    │
│  <task, serif>                         │
│  Today, 5:00 PM                   ─────┼──► TIME ENTRY (tap to change)
│  [👤 Michael]                           │
│  ─────────────────────────────          │
│  From <note title> · 2 hours ago  [›] ─┼──► NOTE DETAIL
│                                         │
│  [ Snooze ]        [ Done ]             │
└─────────────────────────────────────────┘

Snooze → sheet: [15 minutes] [1 hour] [Tomorrow morning]
Done   → status fired, local notification cancelled → back to list
Reminders are NEVER locked, whatever their age.
```

```
TIME ENTRY (full screen, digital only — no clock dial)
  07:00   [AM] [PM]
  numeric keypad · [✕ close]  [Next/Save]
```

```
NEW REMINDER (from +)
  task field → TIME ENTRY → optional person → Save
  Creates a reminder directly, status `confirmed`, no capture.
```

**Notification tap → REMINDER DETAIL** (deep link).

---

## 1.7 PAYWALL

Three entry points, one sheet:

```
1. recall boundary (Home ANSWERED or Memory search)
2. tapping any 🔒 locked row
3. Account sheet ▸ Get Kandoo Pro
```

```
┌─ (dimmed above: Kandoo's clamped answer) ─┐
├─ PAYWALL ─────────────────────────────────┤
│  [mark]                                   │
│  Remember everything                      │
│  Free Kandoo remembers the last ten days. │
│  Pro holds your whole history.            │
│                                            │
│  ✓ Unlimited history                      │
│  ✓ Ask about anything, anytime            │
│  ✓ Every person remembered                │
│                                            │
│  ( Yearly    <price from offering> )      │ ← highlighted
│  ( Monthly   <price from offering> )      │
│  [ Continue ] ──► RevenueCat purchase     │
│  Restore purchase  ·  Not now             │
└────────────────────────────────────────────┘

On success:
  entitlement flips → all mounted lists refetch immediately
  → the blocked question is RE-ASKED automatically
  → the answer appears with the previously locked memories
```

---

## 1.8 Empty states

Same shape on all four tabs: the mark at 40% opacity, one serif line, one help line.

| Tab | Line | Help |
|---|---|---|
| Home | Nothing yet. | Tell Kandoo about your day and it'll remember. |
| Memory | Nothing saved yet. | What you tell Kandoo shows up here. |
| People | No one yet. | Kandoo learns people from what you say. |
| Reminders | Nothing due. | Ask Kandoo to remind you about something. |

---

# PART 2 — KEY INFORMATION

## 2.1 The product thesis the UI must serve

Voice-to-reminder apps exist. Kandoo is different in four ways, and **every screen
should make one of them visible:**

1. One messy utterance becomes many structured things at once
2. It writes a professional note and shows what it understood beside your words
3. It remembers and answers questions weeks later
4. It builds a map of the people in your life from speech alone

If a screen could belong to any to-do app, it is designed wrong.

## 2.2 The ten-day rule

**Free Kandoo remembers the last ten days. Pro holds your whole history.**

One number, everywhere. It governs:

- **Recall** — clamped server-side in `recallService.ts`
- **Memory list** — older rows render locked
- **Person detail** — older memories render locked
- **Home ▸ Recently** — rows show normally; opening a locked one shows the paywall

**Reminders are never locked, at any age.** A reminder created five weeks ago for
next Friday must still fire. Locking a future reminder because its capture was old
would be a functional bug.

Locked row component: title in `ink-faint`, small lock icon, "Part of Kandoo Pro"
in place of the date. No blur, no teaser. Tapping opens the paywall.

## 2.3 Enforcement is server-side

The backend verifies the entitlement through RevenueCat's V2 REST API, caches
briefly, and clamps recall before the answer model ever runs. The client's
`useEntitlement` hook drives what the UI *shows*; it is never the authority.
Fails closed to free on any error.

## 2.4 Notes vs memories — one table underneath

Every item in Memory comes from a **capture**. What differs is whether extraction ran:

| Origin | Capture | Note | Memories | Reminders | Embedded |
|---|---|---|---|---|---|
| Spoken/typed | ✓ | ✓ (generated) | ✓ (extracted) | ✓ (extracted) | ✓ |
| Manual note | ✓ | ✓ (user-written) | — | — | — |
| Manual memory | ✓ | — | ✓ (user-written) | — | ✓ |
| Manual both | ✓ | ✓ | ✓ | — | ✓ |

This gives the dual icons for free: a row shows 📄 if the capture has a note,
👤 if it has memories, both if both.

**A manual memory must still be embedded**, or recall will never find it.
Extraction off ≠ embedding off.

## 2.5 Editing rules

| Action | Effect |
|---|---|
| Pencil on a note | Edits title and body only. **Does not** change its memories. |
| Pencil on a memory | Edits text, **re-embeds on save**. |
| Pencil on a reminder | Edits task, time, person; reschedules the local notification. |
| Long-press anything | Deletes the **whole** item, with a confirm dialog. |

If a memory is wrong, the user edits the memory, not the note. They are separate
records and never rewrite each other.

**Open decision:** whether memory editing is Pro-only. Recommended: available to
everyone, because an edit without re-embedding makes recall silently return the old
wording — the app being quietly wrong is worse than a missing feature. An embedding
call costs a fraction of a cent.

## 2.6 Nothing is ever deleted without the user asking

"Not now" on the review sheet **saves** the note and memories, marked unconfirmed,
and leaves the reminders `pending` where Reminders ▸ Needs review can rescue them.
No timers, no automatic discards. An app whose promise is remembering must never
destroy the user's words on a schedule.

## 2.7 Offline

No queue. If there is no connection, the capture fails with a plain-language line
and **the user's text stays in the field**. Never show a raw exception — that has
already happened once on device.

## 2.8 Duplicates

A capture identical to a recent one (same text, same key details) is rejected
rather than creating a second note and near-identical memories that would both
surface in recall.

## 2.9 Time zones

Store the **absolute instant** in UTC; display in the device's local time.
A reminder fires at the instant it was set for, wherever the user is — unlike
Apple Reminders, which binds to the creation zone and shifts when you travel.
Every request already carries `clientTime` and `timezone`. Show a reminder's zone
only when it differs from the device's current one.

## 2.10 Motion

- **No spinners anywhere.** Working = the mark animating, chips staggering in 80ms
  apart, or an answer streaming in gradually.
- Your words appear **instantly** as you speak; Kandoo's answers **stream in**.
  That rhythm difference is what tells the user who is talking, so the Listening
  screen needs no extra label.
- Confirm = the settle: bottom hairline sweeps amber → olive, card drops flat.
- Remembered is **motionless**. Stillness is the payoff. No confetti.

## 2.11 Voice

On-device recognition, zero API quota. **Continuous — it never stops on silence.**
Android's recogniser ends on the first pause, so the app silently restarts it and
keeps appending. Only Stop ends a capture. After a few seconds of quiet the Stop
button should hint that the user can finish.

Voice is unavailable on emulators (no `RecognitionService`); the mic hides and
typing always remains available. **The demo must be filmed on a physical phone.**

## 2.12 Brand

The mark is **Adinkrahene**, an Adinkra symbol from Ghana — the chief of Adinkra
symbols, signifying leadership and greatness. Never deform it; express only
through colour, uniform scale, glow and opacity.

Type: **Fraunces** for the wordmark, headings, answers, and the user's own words.
**Inter** for everything Kandoo itself says. The user's words get the typeface
with a voice; the app's scaffolding recedes.

Theme is now **light/cream**. Tokens exist for it but nothing has rendered in
light — this is a conversion, not a config flip (see 4.1).

## 2.13 Voice and tone

- "Got it — four things from that." not "Successfully processed 4 items."
- "You mentioned this last week." not "Retrieved 1 memory."
- Never show confidence scores, model names, or the word "extraction".
- Low confidence = the single word **guessed** on the affected chip.

---

# PART 3 — ALREADY BUILT · needs merging only

These work today. The job is re-skinning to the new palette and wiring the new
navigation — not rebuilding.

| Feature | State | Merge work |
|---|---|---|
| Multi-action extraction | ✅ proven (test B1) | none |
| Professional notes from speech | ✅ verified, nothing invented | none |
| Recall over memories **and** reminders | ✅ semantic match proven | change the constant 7 → **10** |
| Server-side entitlement check | ✅ built | 7 → **10** |
| Local notifications, fire with server off | ✅ proven on device | none |
| Voice capture, continuous | ✅ on hardware | none |
| Sign in screen | ✅ | re-skin |
| Home — 4 states | ✅ | re-skin, new layout, add Free badge |
| Review sheet | ✅ | re-skin, inline edit, Edit/Keep all/Not now |
| Memory list + note detail | ✅ built, unverified on device | re-skin, add locked rows, icons |
| MemoryCard component | ✅ 4 states + settle | re-skin |
| Paywall | ✅ built, loop never run | re-skin, read prices from offering, **remove Kandoo Voice line** |
| Brand intro | ✅ built for dark | re-colour + new splash asset |
| Backend on Render | ✅ live | none |
| Gemini + key failover | ✅ proven under load | none |
| `GET /captures` | ✅ | extend to include memories |
| `GET /reminders/active` | ✅ | none |

---

# PART 4 — NOT BUILT · must be created

## 4.1 Light theme conversion — **large**

`theme.ts` holds dark values; light values exist in `tokens.json` but have never
rendered. Requires: swapping the theme, re-checking every state colour for contrast
on cream (orange and amber sit much closer together on light than on dark), a new
native splash asset, and re-colouring the brand intro.

## 4.2 People tab — **large**

New screens: People list, Person detail, filtered Memory/Reminders views, merge flow.

**Schema change required:**

```sql
create table reminder_entities (
  reminder_id uuid references reminders(id) on delete cascade,
  entity_id   uuid references entities(id) on delete cascade,
  primary key (reminder_id, entity_id)
);
```

Reminders currently store `person` as a single text column while memories link
properly through `memory_entities`. Without the join table, "What you promised"
matches on a string, multi-person reminders are impossible, and **merge silently
leaves reminders behind**. `createReminder` must resolve `action.people` into
entities exactly as `createMemory` already does, plus a backfill.

New endpoints: `GET /people`, `GET /people/:id`, `POST /people/merge`.

## 4.3 Reminders tab — **medium**

Today / Upcoming / History / Needs review. Tap-time-to-complete with undo.
Reminder detail with Done and Snooze. Manual reminder creation via `+`.
Time entry screen (digital keypad, no dial). Notification deep link to detail.

New endpoints: `GET /reminders` (grouped), `POST /reminders` (manual),
`PATCH /reminders/:id`, `DELETE /reminders/:id`.

## 4.4 Locked rows — **small, high value**

One component, used in Memory, Person detail, and Home ▸ Recently. A date check
against the ten-day boundary. This is what makes the business model visible.

## 4.5 Account sheet — **small**

Behind the Free/Pro badge. Get Pro / Restore / Sign out with confirm.
Hide "Manage subscription" while on Test Store — a link that goes nowhere is worse
than no link.

## 4.6 Manual entry — **medium**

Add sheet (Note / Memory / Both), empty detail screens in edit mode, "Written by
you" label, embedding for manual memories, and the Split view for Both.

New endpoints: `POST /captures/manual`, `PATCH /memories/:id` (with re-embed),
`PATCH /captures/:id/note`, `DELETE` for each type.

## 4.7 Long-press menus — **small**

Delete on notes, memories, reminders and people, each with a confirm dialog.
Merge on People.

## 4.8 Onboarding + sign-up + reset — **medium**

Three onboarding cards, sign-up screen, forgot-password sheet, and error states
for every auth failure.

## 4.9 Empty states — **small**

Four, one shape. The first thing a new user or a judge creating an account sees.

## 4.10 Home ▸ Recently from the server — **small**

Currently in-memory and empty on every cold start. `GET /captures?limit=3` on mount.
This alone is why Home has looked empty.

## 4.11 Answered state — **small**

Recall answers currently have nowhere to render. Reuses the Listening layout with
the answer streaming in and source rows beneath.

## 4.12 Optional if time allows

- Waveform on Listening — proves the mic is live; ~20 lines, no library
- Silence hint on the Stop button
- Search/filter chips on Memory and Reminders

---

# PART 5 — BUILD ORDER

Six days. Ordered so that stopping at any point still leaves a demoable app.

| Priority | Work | Why |
|---|---|---|
| **1** | Verify the paywall loop on MuMu | Built, never run once |
| **2** | 7 → 10 everywhere | One constant, two files |
| **3** | Light theme conversion | Blocks every other screen |
| **4** | Home ▸ Recently from server + Answered state | Home currently looks empty; recall has nowhere to render |
| **5** | Reminders tab | A reminder app that can't show reminders |
| **6** | People tab + `reminder_entities` | The strongest "why the AI" screen |
| **7** | Locked rows | Makes Pro visible |
| **8** | Account sheet + empty states | Sign out has no home; new users see blanks |
| **9** | Manual entry + long-press delete | A judge will look for these |
| **10** | Onboarding + sign-up polish | First impression |
| **11** | Waveform, silence hint, filters | Pure polish |

**Cut line:** if time runs out, stop after 8. Items 9–11 go to the README roadmap
alongside Kandoo Voice, the lock-screen widget, Google Assistant handoff, alarms,
and location triggers.

---

# PART 6 — OPEN ITEMS

1. **Memory editing: Pro-only or everyone?** Recommended everyone, with re-embed.
2. **Prices.** Test Store products cannot have price or duration changed after
   creation; the current yearly is $8.99/month against $3.99 monthly, which is
   inverted. Either recreate the yearly product or accept it — but the paywall must
   read prices from the offering, never hardcode them.
3. **The shot list.** Still outstanding. It is what decides whether items 9–11 are
   built or cut.
