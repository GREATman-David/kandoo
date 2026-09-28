import * as Notifications from 'expo-notifications';
import { useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useAuth } from '@/features/Auth/useAuth';

/**
 * Tapping a reminder notification opens that reminder. Handles both a tap while
 * the app is running and the tap that launched it from closed (the hook returns
 * the last response either way). Renders nothing.
 *
 * Waits for the navigator to be ready and the user to be signed in, handles
 * each response once, then clears it so a later remount doesn't reopen it.
 */
export function NotificationRouter() {
  const response = Notifications.useLastNotificationResponse();
  const router = useRouter();
  const navigationReady = !!useRootNavigationState()?.key;
  const { isAuthenticated } = useAuth();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response || !navigationReady || !isAuthenticated) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;

    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;

    const reminderId = response.notification.request.content.data?.reminderId;
    if (typeof reminderId === 'string' && reminderId) {
      router.navigate({ pathname: '/reminders', params: { open: reminderId } });
    }

    Notifications.clearLastNotificationResponseAsync().catch((error: unknown) => {
      console.warn('Clearing the handled notification failed:', error);
    });
  }, [response, navigationReady, isAuthenticated, router]);

  return null;
}
