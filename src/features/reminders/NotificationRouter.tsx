import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { type AlertReminder, ReminderAlert } from '@/components/ReminderAlert';
import { useAuth } from '@/features/Auth/useAuth';
import { parseAlertLink } from '@/utils/alertLink';

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
    fromLockScreen: false,
  };
}

/** The alert Android opened over the lock screen via its full-screen intent. */
function alertFromLink(url: string | null): AlertReminder | null {
  const link = parseAlertLink(url);
  if (!link) return null;
  return {
    ...link,
    notificationId: null,
    body: '',
    firedAt: Date.now(),
    fromLockScreen: true,
  };
}

/**
 * Brings a reminder up full screen (ReminderAlert) in the three ways Android
 * allows:
 *
 *   - Phone locked or screen off: the notification's full-screen intent wakes
 *     the screen and opens kandoo://alert over the lock screen (see
 *     plugins/withFullScreenReminders.js). Closing it returns to the lock
 *     screen; nothing else in the app is reachable without unlocking.
 *   - Using Kandoo: it appears the moment the reminder fires (the banner is
 *     suppressed for reminders in localNotifications).
 *   - Using another app: Android shows a heads-up banner; tapping it opens the
 *     alert. It does NOT wait inside Kandoo for the next time it is opened.
 *
 * Only for a signed-in user. Each tap is handled once, then cleared so a later
 * remount doesn't reopen it.
 */
export function NotificationRouter() {
  const response = Notifications.useLastNotificationResponse();
  const { isAuthenticated } = useAuth();
  const handled = useRef<string | null>(null);
  const initialLinkChecked = useRef(false);
  const [alert, setAlert] = useState<AlertReminder | null>(null);

  // Fired while Kandoo is open and in front.
  useEffect(() => {
    if (!isAuthenticated) return;
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      if (AppState.currentState !== 'active') return;
      const next = alertFrom(notification);
      if (next) setAlert(next);
    });
    return () => subscription.remove();
  }, [isAuthenticated]);

  // Opened over the lock screen by the full-screen intent.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!initialLinkChecked.current) {
      initialLinkChecked.current = true;
      Linking.getInitialURL()
        .then((url) => {
          const next = alertFromLink(url);
          if (next) setAlert(next);
        })
        .catch((error: unknown) => console.warn('Reading the launch link failed:', error));
    }
    const subscription = Linking.addEventListener('url', ({ url }) => {
      const next = alertFromLink(url);
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
