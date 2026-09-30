import type { Visit } from '@/services/places/placeStore';

/**
 * The monthly recap's device half: where the month went, from the visit log
 * that never leaves the phone. Pure functions, tested in monthRecap.test.ts.
 */

export type MonthWindow = { from: Date; to: Date; key: string; label: string };

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The local calendar month containing `day`: [1st 00:00, next 1st 00:00). */
export function monthWindow(day: Date): MonthWindow {
  const from = new Date(day.getFullYear(), day.getMonth(), 1);
  const to = new Date(day.getFullYear(), day.getMonth() + 1, 1);
  const key = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;
  return { from, to, key, label: MONTHS[from.getMonth()] };
}

/** The month before the one containing `day` — what the 1st's recap is about. */
export function previousMonth(day: Date): MonthWindow {
  return monthWindow(new Date(day.getFullYear(), day.getMonth() - 1, 15));
}

/** 10:00 local on the 1st of the month after `day`: when the recap arrives. */
export function nextRecapTime(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth() + 1, 1, 10, 0, 0);
}

export type PlaceTime = { id: string; name: string; visits: number; ms: number };

/** A stay still open longer than this is capped: a missed exit is not a week at the gym. */
const MAX_STAY_MS = 16 * 60 * 60 * 1000;

/**
 * Time and visits per place within [from, to), longest first. A stay that
 * crosses the month edge counts only the part inside; one with no recorded
 * exit counts until now, capped.
 */
export function timeByPlace(
  visits: Record<string, Visit[]>,
  names: Record<string, string>,
  from: Date,
  to: Date,
  now = Date.now()
): PlaceTime[] {
  const start = from.getTime();
  const end = Math.min(to.getTime(), now);
  const rows: PlaceTime[] = [];
  for (const [id, stays] of Object.entries(visits)) {
    let ms = 0;
    let count = 0;
    for (const stay of stays) {
      const left = Math.min(stay.l ?? now, stay.a + MAX_STAY_MS);
      const overlap = Math.min(left, end) - Math.max(stay.a, start);
      if (stay.a >= start && stay.a < end) count++;
      if (overlap > 0) ms += overlap;
    }
    if (count > 0 || ms > 0) rows.push({ id, name: names[id] ?? 'A place', visits: count, ms });
  }
  return rows.sort((a, b) => b.ms - a.ms || b.visits - a.visits);
}

/** "3 h", "45 min", "2 days" — how long, the way a person would say it. */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}
