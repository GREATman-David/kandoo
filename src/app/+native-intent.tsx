/**
 * kandoo://alert?... is not a screen: it is how Android opens a reminder's
 * full-screen alert over the lock screen (plugins/withFullScreenReminders.js).
 * The alert itself is shown by NotificationRouter, on top of whatever screen
 * is open — so the router must not try to navigate to an "alert" route.
 * Every other link is left exactly as it was.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    if (/^kandoo:\/\/alert\b/.test(path) || /^\/?alert\b/.test(path)) {
      // Cold launch: open Home under the alert. Already running: stay put.
      return initial ? '/' : null;
    }
    // A team invite (kandoo://join/ABCD2345): the Team view joins it.
    const invite = path.match(/^(?:kandoo:\/\/|\/)?join\/([A-Za-z0-9-]{8,12})\b/);
    if (invite) return `/memory?view=team&join=${invite[1]}`;
    return path;
  } catch (error) {
    console.warn('Reading an incoming link failed; opening it unchanged:', error);
    return path;
  }
}
