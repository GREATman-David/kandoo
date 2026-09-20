import { supabase } from './supabase';

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to .env (see .env.example) and restart Metro ` +
        'with --clear — EXPO_PUBLIC_ vars are inlined into the bundle at build ' +
        'time, so a stale bundle can still be missing it after the .env is fixed.'
    );
  }
  return value;
}

const BACKEND_URL = requireEnv(
  process.env.EXPO_PUBLIC_API_URL,
  'EXPO_PUBLIC_API_URL'
);

export type ReminderStatus =
  | 'pending'
  | 'confirmed'
  | 'fired'
  | 'dismissed'
  | 'cancelled';

export type CreatedReminder = {
  id: string;
  task: string;
  person: string | null;
  due_at: string | null;
  place_hint: string | null;
  place_id: string | null;
  insistent: boolean;
  status: ReminderStatus;
  created_at: string;
};

export type CreatedMemory = {
  id: string;
  content: string;
  person: string | null;
  location: string | null;
  topics: string[];
  created_at: string;
};

export type InterpretResult =
  | { kind: 'reminder'; status: 'ok'; reminder: CreatedReminder }
  | { kind: 'memory'; status: 'ok'; memory: CreatedMemory }
  | { kind: 'recall'; status: 'ok'; answer: string; memories: unknown[] }
  | {
      kind: 'reminder' | 'memory' | 'recall';
      status: 'failed';
      reason: string;
    };

export type InterpretationResponse = {
  success: true;
  captureId: string;
  summary: string | null;
  confidence: 'high' | 'low';
  results: InterpretResult[];
};

async function getAccessTokenOrThrow(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('You must be signed in to use Kandoo.');
  }

  return session.access_token;
}

export async function interpretText(
  text: string
): Promise<InterpretationResponse> {
  const trimmedText = text.trim();

  if (!trimmedText) {
    throw new Error('Text cannot be empty.');
  }

  const accessToken = await getAccessTokenOrThrow();

  const clientTime = new Date().toISOString();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const response = await fetch(`${BACKEND_URL}/interpret`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      text: trimmedText,
      clientTime,
      timezone,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error ?? 'Failed to interpret text.');
  }

  return data;
}

/** Called from the review sheet. Reminders stay unscheduled until this fires. */
export async function confirmReminder(
  reminderId: string
): Promise<CreatedReminder> {
  const accessToken = await getAccessTokenOrThrow();

  const response = await fetch(
    `${BACKEND_URL}/reminders/${reminderId}/confirm`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error ?? 'Failed to confirm reminder.');
  }

  return data.reminder;
}
