/**
 * Repeating reminders. `repeat_days` holds weekdays as JavaScript numbers them:
 * 0 = Sunday … 6 = Saturday, at the time of day of the reminder's `due_at`.
 * null or empty = the reminder happens once.
 */

export const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const DAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export function isRepeating(days?: number[] | null): days is number[] {
  return !!days && days.length > 0;
}

/** Sorted, unique, valid weekdays; null when there are none. */
export function normalizeDays(days?: number[] | null): number[] | null {
  if (!days) return null;
  const clean = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  return clean.length ? clean : null;
}

function isSet(days: number[], set: number[]) {
  return days.length === set.length && set.every((d) => days.includes(d));
}

/** "Every day", "Weekdays", "Weekends", or "Every Mon, Wed, Fri". */
export function repeatShort(days?: number[] | null): string {
  const d = normalizeDays(days);
  if (!d) return 'Never';
  if (d.length === 7) return 'Every day';
  if (isSet(d, [1, 2, 3, 4, 5])) return 'Weekdays';
  if (isSet(d, [0, 6])) return 'Weekends';
  return 'Every ' + d.map((x) => DAY_SHORT[x]).join(', ');
}

/** The sentence under the day toggles (Figma: "Repeats every Monday, Wednesday, Friday"). */
export function repeatSentence(days?: number[] | null): string {
  const d = normalizeDays(days);
  if (!d) return 'Doesn’t repeat';
  if (d.length === 7) return 'Repeats every day';
  if (isSet(d, [1, 2, 3, 4, 5])) return 'Repeats every weekday';
  if (isSet(d, [0, 6])) return 'Repeats every weekend';
  return 'Repeats every ' + d.map((x) => DAY_LONG[x]).join(', ');
}

/**
 * The next time a repeating reminder happens, at or after `from`: the first
 * chosen weekday whose time-of-day (taken from `timeISO`) is still ahead.
 */
export function nextOccurrence(timeISO: string, days: number[], from = new Date()): Date {
  const time = new Date(timeISO);
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(from);
    candidate.setDate(from.getDate() + offset);
    candidate.setHours(time.getHours(), time.getMinutes(), 0, 0);
    if (days.includes(candidate.getDay()) && candidate.getTime() > from.getTime()) {
      return candidate;
    }
  }
  return time;
}

/** A reminder's time line: "Every Mon, Wed · 7:00 AM" when it repeats. */
export function repeatWhen(timeISO: string, days: number[]): string {
  const time = new Date(timeISO).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${repeatShort(days)} · ${time}`;
}
