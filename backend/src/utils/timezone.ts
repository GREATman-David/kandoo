/**
 * The device's IANA timezone, validated. Relative times ("tomorrow morning")
 * are resolved against it, so a malformed value must not reach the prompt or
 * Intl: an unknown zone falls back to UTC rather than failing the request.
 */
export function resolveTimezone(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 64) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    // Not an error worth surfacing: the device sent a zone the server's ICU
    // data doesn't know. UTC keeps the request working.
    console.warn('Unknown timezone from client; using UTC.');
    return 'UTC';
  }
}
