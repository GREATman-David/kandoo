import { Expo } from 'expo-server-sdk';

import { supabase } from '../../services/supabase';

type SendNotificationInput = {
  userId: string;
  title: string;
  body: string;
};

const expo = new Expo();

export async function sendNotification(
  input: SendNotificationInput
) {
  const { data: tokens, error } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', input.userId);

  if (error) {
    console.error(
      'Push token lookup error:',
      error
    );

    throw new Error(
      'Failed to retrieve push notification tokens.'
    );
  }

  if (!tokens || tokens.length === 0) {
    console.log(
      'No push notification tokens found for user:',
      input.userId
    );

    return {
      success: false,
      sent: 0,
    };
  }

  const messages = [];

  for (const tokenRecord of tokens) {
    const token = tokenRecord.token;

    if (!Expo.isExpoPushToken(token)) {
      console.error(
        'Invalid Expo push token:',
        token
      );

      continue;
    }

    messages.push({
      to: token,
      sound: 'default' as const,
      title: input.title,
      body: input.body,
    });
  }

  if (messages.length === 0) {
    return {
      success: false,
      sent: 0,
    };
  }

  const tickets = [];

  for (const chunk of expo.chunkPushNotifications(
    messages
  )) {
    try {
      const chunkTickets =
        await expo.sendPushNotificationsAsync(
          chunk
        );

      tickets.push(...chunkTickets);
    } catch (error) {
      console.error(
        'Expo push notification error:',
        error
      );
    }
  }

  return {
    success: tickets.length > 0,
    sent: tickets.length,
    tickets,
  };
}