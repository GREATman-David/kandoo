import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { CreatedReminder } from './interpretationService';
import {
  clearTriggers,
  getAllTriggers,
  getTrigger,
  removeTrigger,
  setTrigger,
} from './triggerRegistry';

/**
 * Local notification scheduling — the whole point of AGENTS.md §3.2. Once
 * scheduled here, the OS AlarmManager fires the notification whether the app
 * is closed, the phone rebooted, or the Kandoo server stopped entirely.
 * Nothing on this path talks to the server.
 */

const CHANNEL_DEFAULT = 'kandoo-reminders';
const CHANNEL_INSISTENT = 'kandoo-alarms';

let channelsReady = false;

/** Fire in the foreground too — a reminder the user doesn't see is useless. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type NotificationSetup = {
  /** False when the user denied POST_NOTIFICATIONS; scheduling still runs but
   *  nothing will be shown, so the UI can warn rather than fail silently. */
  granted: boolean;
};

async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android' || channelsReady) return;

  await Notifications.setNotificationChannelAsync(CHANNEL_DEFAULT, {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250],
    enableVibrate: true,
  });

  // Insistent reminders (alarms) get a louder channel: MAX importance, longer
  // vibration, bypasses Do Not Disturb.
  await Notifications.setNotificationChannelAsync(CHANNEL_INSISTENT, {
    name: 'Alarms',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 500, 250, 500],
    enableVibrate: true,
    bypassDnd: true,
  });

  channelsReady = true;
}

/**
 * Ask for POST_NOTIFICATIONS (Android 13+). Exact-alarm scheduling relies on
 * SCHEDULE_EXACT_ALARM, which the expo-notifications manifest already declares;
 * where the OS withholds it, the notification still fires, just not to the
 * exact second. Either way this degrades rather than throwing.
 */
export async function setupNotifications(): Promise<NotificationSetup> {
  await ensureChannels();

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }

  if (status !== 'granted') {
    console.warn('Notifications not granted; reminders will not be shown.');
  }

  return { granted: status === 'granted' };
}

function channelFor(reminder: CreatedReminder): string {
  return reminder.insistent ? CHANNEL_INSISTENT : CHANNEL_DEFAULT;
}

/**
 * Schedule (or reschedule) a reminder's local notification. Returns the OS
 * notification id, or null when there is nothing to fire — no time set (a
 * place-anchored reminder is block H, not this one) or the time is already
 * past. Cancels any existing notification for this reminder first, so calling
 * it twice never leaves a duplicate.
 */
export async function scheduleReminder(
  reminder: CreatedReminder
): Promise<string | null> {
  await ensureChannels();
  await cancelReminder(reminder.id);

  if (!reminder.due_at) return null;

  const due = new Date(reminder.due_at);
  if (Number.isNaN(due.getTime()) || due.getTime() <= Date.now()) return null;

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: reminder.task,
      body: reminder.person ? `With ${reminder.person}` : 'Kandoo reminder',
      sound: true,
      // Lets a tap open this reminder (NotificationRouter).
      data: { reminderId: reminder.id },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: due,
      channelId: channelFor(reminder),
    },
  });

  await setTrigger(reminder.id, {
    notificationId,
    dueAt: reminder.due_at,
  });

  return notificationId;
}

/** Cancel a reminder's notification and forget it. Safe if none exists. */
export async function cancelReminder(reminderId: string): Promise<void> {
  const entry = await getTrigger(reminderId);
  if (entry) {
    try {
      await Notifications.cancelScheduledNotificationAsync(entry.notificationId);
    } catch (error) {
      console.warn('Cancel scheduled notification failed:', error);
    }
    await removeTrigger(reminderId);
  }
}

/** Editing a reminder's time is a cancel + schedule. */
export async function rescheduleReminder(
  reminder: CreatedReminder
): Promise<string | null> {
  return scheduleReminder(reminder);
}

/**
 * Reconcile the device's scheduled notifications against the server's truth,
 * called on launch. This is what makes the system self-healing: the app may
 * have been killed when a reminder was confirmed on another device, or a
 * scheduled reminder dismissed while offline.
 *
 *   - a confirmed, future reminder with no notification  → schedule it
 *   - a notification whose reminder is gone / past / not-confirmed → cancel it
 *   - a reminder already in the past → skip (never schedule)
 */
export async function reconcileReminders(
  reminders: CreatedReminder[]
): Promise<void> {
  await ensureChannels();

  const now = Date.now();
  const desired = reminders.filter(
    (r) =>
      r.status === 'confirmed' &&
      !!r.due_at &&
      new Date(r.due_at).getTime() > now
  );
  const desiredIds = new Set(desired.map((r) => r.id));

  // 1. Drop triggers whose reminder is no longer a confirmed future reminder
  //    (dismissed, fired, cancelled, edited into the past, or deleted).
  const registry = await getAllTriggers();
  for (const reminderId of Object.keys(registry)) {
    if (!desiredIds.has(reminderId)) {
      await cancelReminder(reminderId);
    }
  }

  // 2. Ensure every desired reminder has a current notification. Reschedule if
  //    the stored due time no longer matches the server's.
  for (const reminder of desired) {
    const entry = await getTrigger(reminder.id);
    if (entry && entry.dueAt === reminder.due_at) continue;
    await scheduleReminder(reminder);
  }

  // 3. Sweep OS-scheduled notifications the registry no longer references
  //    (e.g. registry was cleared but notifications survived a reinstall).
  const known = new Set(
    Object.values(await getAllTriggers()).map((e) => e.notificationId)
  );
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const request of scheduled) {
    if (!known.has(request.identifier)) {
      try {
        await Notifications.cancelScheduledNotificationAsync(request.identifier);
      } catch (error) {
        console.warn('Sweep cancel failed:', error);
      }
    }
  }
}

/**
 * Sign-out: cancel every reminder this account scheduled on the phone, so they
 * don't keep firing on the lock screen for whoever uses it next. The next
 * sign-in's launch reconcile schedules that account's own reminders.
 */
export async function cancelAllReminders(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (error) {
    console.warn('Cancelling scheduled reminders failed:', error);
  }
  await clearTriggers();
}
