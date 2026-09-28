import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';

import { type AlertReminder, ReminderAlert } from '@/components/ReminderAlert';
import { useAuth } from '@/features/Auth/useAuth';

/** The alert a reminder notification carries; null for any other notification. */
function alertFrom(notification: Notifications.Notification): AlertReminder | null {
  const { content, identifier } = notification.request;
  const reminderId = content.data?.reminderId;
  if (typeof reminderId !== 'string' || !reminderId) return null;
  return {
    reminderId,
    notificationId: identifier,
    title: content.title ?? 'Your reminder',
    body: content.body ?? '',
    repeating: content.data?.repeating === true,
    insistent: content.data?.insistent === true,
    // The moment it was delivered; a tapped-later alert still shows that time.
    firedAt: Number.isFinite(notification.date) && notification.date > 0 ? notification.date : Date.now(),
  };
}

/**
 * Brings a reminder up full screen (ReminderAlert):
 *
 *   - the moment it fires while the app is open (the banner is suppressed for
 *     reminders in localNotifications, so this replaces it), and
 *   - when its notification is tapped — from the shade, or from the lock screen
 *     once the phone is unlocked — including the tap that launched the app from
 *     closed (the hook returns the last response either way).
 *
 * Only for a signed-in user. Each tap is handled once, then cleared so a later
 * remount doesn't reopen it.
 */
export function NotificationRouter() {
  const response = Notifications.useLastNotificationResponse();
  const { isAuthenticated } = useAuth();
  const handled = useRef<string | null>(null);
  const [alert, setAlert] = useState<AlertReminder | null>(null);

  // Fired while the app is open.
  useEffect(() => {
    if (!isAuthenticated) return;
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const next = alertFrom(notification);
      if (next) setAlert(next);
    });
    return () => subscription.remove();
  }, [isAuthenticated]);

  // Tapped.
  useEffect(() => {
    if (!response || !isAuthenticated) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;

    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;

    const next = alertFrom(response.notification);
    if (next) setAlert(next);

    Notifications.clearLastNotificationResponseAsync().catch((error: unknown) => {
      console.warn('Clearing the handled notification failed:', error);
    });
  }, [response, isAuthenticated]);

  return <ReminderAlert alert={alert} onClose={() => setAlert(null)} />;
}
