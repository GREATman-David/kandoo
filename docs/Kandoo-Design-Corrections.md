# Kandoo — Design Frame Corrections & Additions

Nineteen frames were produced in Figma. This document says, for each one, what is
correct, what must change, and what behaviour the frame cannot show.

**Read alongside `Kandoo-UI-Architecture.md`.** The frames show composition; the
architecture shows flow and rules. Where they disagree, **the architecture wins**.

**Palette and type come from `theme.ts` and the architecture document. Do not
invent colours, fonts, spacing or radii.** Every value already exists.

---

## 01 · Sign in

**Correct as drawn.** Wordmark, motto, mark, two fields, amber button, create-account link.

**Add:**
- `Forgot password?` link below the button → reset sheet (email field, "Send reset
  link", confirmation line)
- Submitting state — button label becomes "Signing in…", disabled. No spinner.
- Inline error line in plain language. **Never render a raw exception** — a Java
  stack trace has already appeared on screen once in this project.

---

## 02 · Home — Idle

**Correct as drawn.** Large centred mark, greeting, serif question, Recently list,
input with mic at the right edge, four-tab bar.

**Corrections:**
- Recently rows are **tappable** → note detail. If the capture is older than ten
  days, tapping opens the paywall instead (the row itself still looks normal).
- The `Free` badge is tappable → account sheet. Reads `Kandoo Pro` when subscribed.

**Behaviour the frame can't show:**
- Recently must come from `GET /captures?limit=3`, not memory. It is currently
  in-memory and empty on every cold start — this is why Home has looked bare.
- Needs an empty state for new users: mark at 40%, "Nothing yet." / "Tell Kandoo
  about your day and it'll remember."

---

## 03 · Listening

**Correct as drawn.** Mark with glow, "Listening…", live transcript in serif,
Cancel and Stop.

**Behaviour the frame can't show:**
- Listening is **continuous** — it never stops on silence. Android's recogniser
  ends at the first pause; the app restarts it silently and keeps appending. Only
  Stop ends a capture.
- The user's words appear **instantly**. (Kandoo's answers stream in gradually —
  see 03b.) That rhythm difference is how the user knows who is talking.
- Typing must remain available throughout; the same `TextInput` persists.

**Optional if time allows:** a live waveform driven by the recogniser's volume
metering — it is the only thing on this screen that proves the mic is working. Plus
a silence hint on the Stop button after a few quiet seconds.

---

## 03b · Answered — **NEW, no frame exists**

Recall answers currently have nowhere to render. Reuse the Listening layout:

```
mark + animation
<Kandoo's answer, serif, streaming in gradually>
SOURCES
  <note row>  ›
  <note row>  ›
[ Done ]
```

If the question reaches past ten days, the answer covers what it can and the
paywall opens over it.

---

## 04 · Home — typing

**Correct as drawn.** Same screen as Idle with the keyboard up, cursor in the field,
mic still visible.

**Note:** the keyboard is Android's, not designed here. The field must not be
remounted between Idle and Listening or focus drops and the keyboard blinks.

---

## 05 · Review sheet

**Correct as drawn.** "FROM WHAT YOU SAID", note title, grouped cards, "Needs
review" dots, guessed chip in red.

**Corrections:**
- `Keep all four` → **`Keep all`**. One string, no pluralisation logic.
- `Not now` is **no longer a button**. It becomes a quiet text link below the
  buttons. The left button becomes **`Edit`**.
- Each card gets a small `✕` to remove that item only.

**Behaviour:**
- `Edit` → tapping a card expands it **in place**: text editable, time chip opens
  the time entry screen, person chip removable. Never navigate away mid-capture.
- `Keep all` → confirms every reminder, cards settle in a 90ms cascade → Remembered.
- `Not now` → the note and memories are **saved and marked unconfirmed**; reminders
  stay `pending` and appear under Reminders ▸ Needs review. **Nothing is discarded.**
- The card list must scroll — a long capture can produce a dozen items.

---

## 06 · Understanding

**Correct as drawn.** Amber mark, "I UNDERSTOOD", note title, chips, Edit and Remember.

**Behaviour:**
- Chips stagger in 80ms apart. **That staggering is the loading indicator — no
  spinner, ever.**
- `Edit` → opens the review sheet (05).
- `Remember` → confirms everything → Remembered.

---

## 07 · Remembered

**Correction:** `2 memories saved` becomes **separate tappable rows, one per
memory**, each leading to that memory's detail.

The count hides the product's best evidence. "Jed is pushing the API migration to
Q1 ›" and "The budget was cut by fifteen percent ›" is proof that Kandoo understood
a paragraph rather than transcribing it. Reminder rows are tappable too.

**Behaviour:** the mark is **completely still** here. Everything else in the app
breathes; stillness is the payoff. No confetti, no success animation.

---

## 08 · Memory — list

**Correct as drawn.** Title, ask field, cards with type icons, "Add something new".

**Corrections:**
- The ask field is **recall** — it needs the same ten-day boundary and paywall as
  Home. It is currently a second entry point with no wiring.
- Add **locked rows** for anything older than ten days: title in `ink-faint`, small
  lock, "Part of Kandoo Pro" where the date sits. Tapping opens the paywall.
- Cards from a dismissed capture show the amber dot and "Needs review", and tapping
  reopens the review sheet.

**Behaviour:**
- Icons: 📄 the capture has a note · 👤 it has memories · both → split view (11).
- `+ Add something new` → sheet offering **Note / Memory / Both**.
- Long-press any row → Delete, with a confirm dialog.
- Empty state: "Nothing saved yet." / "What you tell Kandoo shows up here."

---

## 09 · Note detail

**Correct as drawn, and the strongest frame in the set.** Back, pencil, title,
captured date, clean body, Connections chips, "What you said" collapsed.

**Behaviour:**
- Connections chips are tappable: a person → their page, a reminder → its detail.
- The pencil edits **title and body only**. It does **not** alter the memories
  extracted from this capture — they are separate records.
- "What you said" expands to the verbatim capture in muted text. The contrast
  between the messy original and the clean note is the point of the screen.
- **Manual notes** have no Connections and no "What you said". They carry a quiet
  **"Written by you"** label instead.

---

## 10 · Memory detail

**Correct as drawn.** Pencil, memory text in serif, "From <note> · 2 hours ago"
with a chevron.

**Behaviour:**
- The source line navigates to the parent note.
- **Editing re-embeds the memory on save.** Without that, recall keeps searching
  the old wording while the screen shows the new one — the app silently wrong.
- A manual memory has no source line.

---

## 11 · Split view — "Two ways to see this"

**Correct as drawn.** Reached when one capture has both a note and memories, or
from a manual "Both" entry.

**Behaviour:** each card opens its own detail screen. For manual "Both", the two
cards start empty and open in edit mode.

---

## 12 · People

**Correct as drawn.** Title, subtitle, initial avatars, name, one-line summary,
counts, clock icon.

**Behaviour:**
- The summary is the **most recent memory** about that person — not generated.
- 🕐 means an active reminder exists.
- Ordered by most recently mentioned, never alphabetical.
- Long-press → **Merge with…** (multi-select) or **Delete**, both confirmed.
  In a merge, **the long-pressed person survives**: "Mummy will be merged into Mum.
  All memories, reminders and notes move across."
- Locked rows apply to people whose memories are all older than ten days.
- Empty state: "No one yet." / "Kandoo learns people from what you say."

---

## 13 · Person detail

**Correct as drawn, and better than specified.** Avatar, name, counts, "What you
know", "What you promised", "Mentioned in", every row chevroned.

**Corrections:**
- The counts — "3 memories · 1 reminder · 1 note" — are **tappable**, opening the
  Memory or Reminders list filtered to that person with a `[ Jed ✕ ]` chip at the
  top. This is what keeps the page usable when the lists grow long.
- Locked rows appear under "What you know" for older memories.

**Requires a schema change:** `reminder_entities`. Reminders currently store
`person` as one text column while memories link through `memory_entities`. Without
the join table, "What you promised" matches on a string, multi-person reminders are
impossible, and **merge silently leaves reminders behind.**

---

## 14 · Reminders

**Correct as drawn.** Title, Today, Upcoming, History collapsed, person chips.

**Corrections:**
- **Remove the clock icon** top right — that led to Alarms, which are cut. An icon
  leading nowhere is worse than no icon.
- Add a **`+`** in its place → manual reminder creation.
- Add a **`NEEDS REVIEW`** section above Today, shown only when pending reminders
  exist. Amber dot, tinted background; tapping reopens that capture's review sheet.
  Without this, a dismissed sheet loses those reminders permanently.

**Behaviour:**
- **Tap the time pill to complete.** No checkboxes, no swipe to discover. The row
  animates to History with an "Undo" for five seconds.
- Tap the row → reminder detail.
- Long-press → Delete, confirmed.
- **Reminders are never locked**, at any age. One created five weeks ago for next
  Friday must still fire.
- Empty state: "Nothing due." / "Ask Kandoo to remind you about something."

---

## 15 · Reminder detail

**Correct as drawn.** Task, time, person chip, source line.

**Add:**
- **`Snooze`** (secondary) and **`Done`** (amber, primary) at the bottom.
  Snooze opens a small sheet: 15 minutes · 1 hour · Tomorrow morning.
- Tapping the time opens the time entry screen (17).
- The pencil edits task, time and person, and **reschedules the local notification**.
- The source line navigates to the parent note.

---

## 16 · Alarms list — **CUT**

Do not build. Recurring alarms need repeating notifications, alarm CRUD and a schema
change — a full session, for the one screen set that has nothing to do with the AI.
`insistent` reminders already fire on the high-priority alarm channel.

Goes to the README roadmap.

---

## 17 · Time keypad — **KEEP, repurposed**

No longer for alarms. This becomes the **time entry screen**, reached from:
- a time chip in the review sheet
- the time on a reminder detail
- manual reminder creation

**Correct as drawn.** Digital entry only — no clock dial. `07:00`, AM/PM toggle,
numeric keypad, close and save.

---

## 18 · Repeat days — **CUT**

Belongs to alarms. Kandoo has no recurring reminders. README roadmap.

---

## 19 · Paywall

**Correct as drawn.** Dimmed answer above, mark, "Remember everything", benefits,
two plans, Continue, Restore and Not now.

**Corrections — all three matter:**

1. **The prices are inverted.** Yearly shows $8.99/month against Monthly at
   $3.99/month, so the annual plan costs more than twice as much and "Save 25%" is
   wrong in the other direction. **The paywall must read prices from the RevenueCat
   offering and never hardcode them** — hardcoded prices go stale and won't match
   what the user is actually charged.
2. **Remove the "Kandoo Voice" benefit.** It is not built. Advertising an unbuilt
   feature to a judge who taps through is the worst thing that could be on this
   screen.
3. **"Seven days" → "ten days"** in the copy.

**Behaviour:**
- Three entry points, one sheet: the recall boundary, any locked row, and the
  account sheet.
- On success: the entitlement flips, **all mounted lists refetch immediately**, and
  **the blocked question is re-asked automatically** so the previously locked
  memories appear. That is the payoff moment — a user who has just paid must never
  wonder whether it worked.

---

## Screens with no frame — build from the architecture

| Screen | Section |
|---|---|
| Brand intro (re-coloured for cream) | 1.1 |
| Onboarding — 3 cards | 1.1 |
| Sign up | 1.1 |
| Reset password sheet | 1.1 |
| Account sheet | 1.2 |
| Answered state | 1.3 |
| Add sheet — Note / Memory / Both | 1.4 |
| Filtered Memory / Reminders views | 1.5 |
| New reminder | 1.6 |
| Locked row component | 2.2 |
| Four empty states | 1.8 |
| Long-press menus + confirm dialogs | 4.7 |

---

## Rules that apply to every screen

- **Tokens only.** No inline hex, no new fonts, no new spacing values.
- **No spinners anywhere.** Working = the mark animating, chips staggering, or an
  answer streaming in.
- **Everything vertical scrolls.** Any list can grow.
- **Never show a raw error.** Plain language only; log the real cause.
- **Nothing is deleted without the user asking.** No timers, no automatic discards.
- **Ten days** is the free boundary — recall, Memory, People. Never reminders.
- Minimum touch target 44×44.
