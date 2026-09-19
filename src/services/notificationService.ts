import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import { supabase } from './supabase';

export async function registerForPushNotifications() {
  console.log('Kandoo: starting push notification registration...');

  if (!Device.isDevice) {
    console.log(
      'Kandoo: push notifications require a physical device.'
    );

    return null;
  }

  console.log(
    'Kandoo: physical device detected:',
    Device.osName
  );

  const { status: existingStatus } =
    await Notifications.getPermissionsAsync();

  console.log(
    'Kandoo: existing notification permission:',
    existingStatus
  );

  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } =
      await Notifications.requestPermissionsAsync();

    finalStatus = status;

    console.log(
      'Kandoo: requested notification permission:',
      finalStatus
    );
  }

  if (finalStatus !== 'granted') {
    console.log(
      'Kandoo: push notification permission was not granted.'
    );

    return null;
  }

  console.log(
    'Kandoo: notification permission granted.'
  );

  console.log(
    'Kandoo: requesting Expo push token...'
  );

  const token =
    await Notifications.getExpoPushTokenAsync();

  console.log(
    'Kandoo: Expo push token received:',
    token.data
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  console.log(
    'Kandoo: authenticated user for push registration:',
    user?.id ?? null
  );

  if (!user) {
    throw new Error(
      'You must be signed in to register push notifications.'
    );
  }

  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      {
        user_id: user.id,
        token: token.data,
        platform: Device.osName ?? 'unknown',
      },
      {
        onConflict: 'user_id,token',
      }
    );

  if (error) {
    console.error(
      'Kandoo: push token database error:',
      error
    );

    throw new Error(
      'Failed to save push notification token.'
    );
  }

  console.log(
    'Kandoo: push token successfully saved to database.'
  );

  return token.data;
}