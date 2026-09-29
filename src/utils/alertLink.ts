/**
 * kandoo://alert?id=…&title=…&repeating=1&insistent=0
 *
 * The link Android opens when a reminder's full-screen intent fires with the
 * phone locked or the screen off (see plugins/withFullScreenReminders.js and
 * the expo-notifications patch). It carries everything the alert shows, so the
 * alert appears before any network request — with the phone offline too.
 */

export type AlertLink = {
  reminderId: string;
  title: string;
  repeating: boolean;
  insistent: boolean;
};

export function buildAlertLink(link: AlertLink): string {
  const q = [
    `id=${encodeURIComponent(link.reminderId)}`,
    `title=${encodeURIComponent(link.title)}`,
    `repeating=${link.repeating ? 1 : 0}`,
    `insistent=${link.insistent ? 1 : 0}`,
  ].join('&');
  return `kandoo://alert?${q}`;
}

/** The alert a link describes, or null for any other link. */
export function parseAlertLink(url: string | null | undefined): AlertLink | null {
  if (!url || !/^kandoo:\/\/alert\b/.test(url)) return null;
  const query = url.split('?')[1] ?? '';
  const params: Record<string, string> = {};
  for (const part of query.split('&')) {
    const [key, value = ''] = part.split('=');
    if (!key) continue;
    try {
      params[key] = decodeURIComponent(value);
    } catch (error) {
      console.warn('Malformed alert link parameter; skipping it:', error);
    }
  }
  if (!params.id) return null;
  return {
    reminderId: params.id,
    title: params.title || 'Your reminder',
    repeating: params.repeating === '1',
    insistent: params.insistent === '1',
  };
}
