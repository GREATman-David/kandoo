/**
 * `due_at` is an absolute ISO instant; formatting it against `new Date()`
 * (no explicit timeZone) renders it in the device's own local time, which is
 * the only clock the UI should ever show the user.
 */
export function formatDueDate(iso: string | null): string | null {
  if (!iso) return null;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);

  const time = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Tomorrow, ${time}`;
  if (dayDiff === -1) return `Yesterday, ${time}`;

  const day = date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return `${day}, ${time}`;
}

/**
 * How a place reminder reads where a time would: "At school · Tomorrow",
 * "Leaving work". Null for a reminder that is not a place reminder.
 */
export function formatPlaceWhen(reminder: {
  due_at?: string | null;
  place_hint?: string | null;
  place_trigger?: 'arrive' | 'leave' | null;
  not_before?: string | null;
}): string | null {
  if (reminder.due_at || !reminder.place_hint) return null;
  const where = `${reminder.place_trigger === 'leave' ? 'Leaving' : 'At'} ${reminder.place_hint}`;

  const from = reminder.not_before ? new Date(reminder.not_before) : null;
  if (!from || Number.isNaN(from.getTime()) || from.getTime() <= Date.now()) return where;

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(from) - startOfDay(new Date())) / 86_400_000);
  if (dayDiff === 1) return `${where} · Tomorrow`;
  const day = from.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${where} · from ${day}`;
}
