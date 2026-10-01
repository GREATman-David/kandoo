/**
 * Insights (Pro and Elite): how the user has been using Kandoo over a week or
 * a month, shaped for charts. Pure — rows in, numbers out — so the counting
 * is tested without a database. Days are the USER's days (their timezone),
 * never the server's (AGENTS §3.4).
 */

export type UsageRows = {
  captures: { created_at: string; source: string | null }[];
  memories: { created_at: string; person: string | null; location: string | null }[];
  reminders: { created_at: string; due_at: string | null; status: string; person: string | null }[];
  libraryNotes: { created_at: string; source: string; category: string | null }[];
  photos: { created_at: string }[];
};

export type UsageDay = { date: string; label: string; captures: number; memories: number; reminders: number };
export type Slice = { name: string; value: number };

export type Usage = {
  from: string;
  to: string;
  days: UsageDay[];
  totals: { captures: number; memories: number; reminders: number; notes: number; photos: number };
  /** How things were captured: voice, typed, photo, written by hand. */
  sources: Slice[];
  reminders: { done: number; missed: number; upcoming: number; awaitingReview: number; cancelled: number };
  /** Library notes written in the window, by category. */
  library: Slice[];
  /** What kind of Library notes: written, read from a page, researched. */
  noteKinds: Slice[];
  people: Slice[];
  places: Slice[];
  /** The day with the most captures, if any. */
  busiestDay: string | null;
};

const SOURCE_NAMES: Record<string, string> = {
  voice: 'Voice',
  text: 'Typed',
  photo: 'Photo',
  manual: 'Written by hand',
};

const NOTE_KINDS: Record<string, string> = {
  manual: 'Written',
  document: 'From a page',
  research: 'Research',
};

/** "2026-09-30" in the given timezone. */
export function localDate(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Every local date from `from` to `to` inclusive, with a short label ("Mon", "30"). */
function dayList(from: string, to: string, timeZone: string): { date: string; label: string }[] {
  const out: { date: string; label: string }[] = [];
  const seen = new Set<string>();
  const spanDays = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  const weekday = spanDays <= 8;
  for (let t = Date.parse(from); t <= Date.parse(to); t += 3_600_000) {
    const iso = new Date(t).toISOString();
    const date = localDate(iso, timeZone);
    if (seen.has(date)) continue;
    seen.add(date);
    const label = weekday
      ? new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }).format(new Date(t))
      : String(Number(date.slice(8)));
    out.push({ date, label });
  }
  return out;
}

function top(counts: Map<string, number>, limit: number): Slice[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }));
}

function tally(values: (string | null | undefined)[], normalise = false): Map<string, number> {
  const counts = new Map<string, number>();
  const display = new Map<string, string>();
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    const key = normalise ? value.toLowerCase() : value;
    if (!display.has(key)) display.set(key, value);
    const name = display.get(key) as string;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

export function aggregateUsage(
  rows: UsageRows,
  window: { from: string; to: string; timeZone: string; now?: number }
): Usage {
  const { from, to, timeZone } = window;
  const now = window.now ?? Date.now();
  const days = dayList(from, to, timeZone).map((d) => ({ ...d, captures: 0, memories: 0, reminders: 0 }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  const bump = (iso: string, key: 'captures' | 'memories' | 'reminders') => {
    const day = byDate.get(localDate(iso, timeZone));
    if (day) day[key] += 1;
  };
  rows.captures.forEach((c) => bump(c.created_at, 'captures'));
  rows.memories.forEach((m) => bump(m.created_at, 'memories'));
  rows.reminders.forEach((r) => bump(r.created_at, 'reminders'));

  const sources = top(tally(rows.captures.map((c) => SOURCE_NAMES[c.source ?? 'text'] ?? 'Typed')), 6);

  const reminders = { done: 0, missed: 0, upcoming: 0, awaitingReview: 0, cancelled: 0 };
  for (const r of rows.reminders) {
    if (r.status === 'fired' || r.status === 'dismissed') reminders.done += 1;
    else if (r.status === 'cancelled') reminders.cancelled += 1;
    else if (r.status === 'pending') reminders.awaitingReview += 1;
    else if (r.due_at && Date.parse(r.due_at) < now) reminders.missed += 1;
    else reminders.upcoming += 1;
  }

  const busiest = [...days].sort((a, b) => b.captures - a.captures)[0];

  return {
    from,
    to,
    days: days.map(({ date, label, captures, memories, reminders: r }) => ({ date, label, captures, memories, reminders: r })),
    totals: {
      captures: rows.captures.length,
      memories: rows.memories.length,
      reminders: rows.reminders.length,
      notes: rows.libraryNotes.length,
      photos: rows.photos.length,
    },
    sources,
    reminders,
    library: top(tally(rows.libraryNotes.map((n) => n.category ?? 'Uncategorised')), 6),
    noteKinds: top(tally(rows.libraryNotes.map((n) => NOTE_KINDS[n.source] ?? 'Written')), 3),
    people: top(tally([...rows.memories.map((m) => m.person), ...rows.reminders.map((r) => r.person)], true), 5),
    places: top(tally(rows.memories.map((m) => m.location), true), 5),
    busiestDay: busiest && busiest.captures > 0 ? busiest.date : null,
  };
}
