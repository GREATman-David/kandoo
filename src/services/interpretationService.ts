import { supabase } from './supabase';

const BACKEND_URL = 'http://127.0.0.1:3000';

export type InterpretationResponse = {
  success: boolean;
  interpretation: {
    intent:
      | 'create_reminder'
      | 'save_memory'
      | 'recall_memory'
      | 'unknown';
    task: string | null;
    person: string | null;
    location: string | null;
    reminderTime: string | null;
    searchQuery: string | null;
    originalText: string;
  };
  reminder?: unknown;
  memory?: unknown;
  answer?: string;
  memories?: unknown[];
};

export async function interpretText(
  text: string
): Promise<InterpretationResponse> {
  const trimmedText = text.trim();

  if (!trimmedText) {
    throw new Error('Text cannot be empty.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error(
      'You must be signed in to use Kandoo.'
    );
  }

  const response = await fetch(
    `${BACKEND_URL}/interpret`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        text: trimmedText,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error ?? 'Failed to interpret text.'
    );
  }

  return data;
}