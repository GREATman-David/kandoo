import { useEffect, useState } from 'react';

import { fetchActiveReminders } from '@/services/interpretationService';
import {
  reconcileReminders,
  setupNotifications,
} from '@/services/localNotifications';

/**
 * On launch: set up notification channels and permissions, then reconcile the
 * device's scheduled notifications against the server's active reminders. This
 * is the device rebuilding its own trigger schedule (AGENTS.md §3.2) — it runs
 * once when Home mounts and never blocks the UI.
 */
export function useReminderSync(enabled: boolean): { notificationsGranted: boolean } {
  const [granted, setGranted] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    let active = true;

    (async () => {
      try {
        const setup = await setupNotifications();
        if (active) setGranted(setup.granted);

        const reminders = await fetchActiveReminders();
        if (!active) return;
        await reconcileReminders(reminders);
      } catch (error) {
        // A sync failure must never break Home; the reminders that are already
        // scheduled keep firing, and the next launch reconciles again.
        console.warn('Reminder sync failed:', error);
      }
    })();

    return () => {
      active = false;
    };
  }, [enabled]);

  return { notificationsGranted: granted };
}
