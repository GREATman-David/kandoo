import type { Capture } from '../features/Capture/types';
import { supabase } from './supabase';

export async function saveCapture(capture: Capture) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('You must be signed in to save a capture.');
  }

  const response = await fetch(
    'http://10.156.34.193:3000/captures',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        text: capture.text,
        createdAt: capture.createdAt,
      }),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to save capture.');
  }

  return response.json();
}