export function normalizeReminderTime(
  reminderTime: string,
  currentTime: string
): string {
  const value = reminderTime.trim();

  if (!value) {
    throw new Error('Reminder time is required.');
  }

  const current = new Date(currentTime);

  if (Number.isNaN(current.getTime())) {
    throw new Error('Invalid current time.');
  }

  /*
   * If the AI already returned a valid ISO timestamp,
   * preserve it.
   */
  const directDate = new Date(value);

  if (
    value.includes('T') &&
    !Number.isNaN(directDate.getTime())
  ) {
    return directDate.toISOString();
  }

  /*
   * Handle common AI outputs such as:
   * "4:00 PM"
   * "4 PM"
   * "16:00"
   */
  const timeMatch = value.match(
    /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i
  );

  if (!timeMatch) {
    throw new Error(
      `Unable to understand reminder time: "${value}".`
    );
  }

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] ?? '0');
  const meridiem = timeMatch[3]?.toUpperCase();

  if (minute < 0 || minute > 59) {
    throw new Error('Invalid reminder minutes.');
  }

  if (meridiem === 'AM') {
    if (hour < 1 || hour > 12) {
      throw new Error('Invalid AM reminder hour.');
    }

    if (hour === 12) {
      hour = 0;
    }
  }

  if (meridiem === 'PM') {
    if (hour < 1 || hour > 12) {
      throw new Error('Invalid PM reminder hour.');
    }

    if (hour !== 12) {
      hour += 12;
    }
  }

  if (!meridiem && (hour < 0 || hour > 23)) {
    throw new Error('Invalid reminder hour.');
  }

  const reminderDate = new Date(current);

  reminderDate.setHours(
    hour,
    minute,
    0,
    0
  );

  /*
   * If the requested time has already passed today,
   * we don't silently create a reminder in the past.
   */
  if (reminderDate.getTime() <= current.getTime()) {
    reminderDate.setDate(
      reminderDate.getDate() + 1
    );
  }

  return reminderDate.toISOString();
}