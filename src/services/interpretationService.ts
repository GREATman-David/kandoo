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

/**
 * Dev builds hit the local backend — localhost over the adb-reverse tunnel,
 * read from .env. Release builds ALWAYS hit production on Render, baked in at
 * build time so a shipped APK can never accidentally point at a laptop. `__DEV__`
 * is true under Metro and false in any release build.
 */
const PRODUCTION_API_URL = 'https://kandoo-toow.onrender.com';

const BACKEND_URL = __DEV__
  ? requireEnv(process.env.EXPO_PUBLIC_API_URL, 'EXPO_PUBLIC_API_URL')
  : PRODUCTION_API_URL;

/**
 * Raised when the backend can't be reached or didn't answer properly. Its
 * message is the ONLY thing the UI shows for a network failure — the raw cause
 * (a `java.net.*` / OkHttp string like `UnknownServiceException`) is logged,
 * never displayed. One friendly line, in Kandoo's voice.
 */
export class NetworkError extends Error {
  constructor() {
    super("Couldn't reach Kandoo. Check your connection and try again.");
    this.name = 'NetworkError';
  }
}

/**
 * The single door to the backend. Every call goes through here so the
 * transport-vs-application error boundary is decided in exactly one place:
 *   - fetch/read/parse failure → NetworkError (friendly), real cause logged.
 *   - a non-ok response WITH a backend error string → show that string; the
 *     backend already sanitises its errors (AGENTS §10), so it is safe to show.
 *   - a non-ok response with no usable body (an HTML 5xx from a proxy, a 204) →
 *     NetworkError, because there is nothing meaningful to say.
 */
async function apiFetch<T>(
  path: string,
  init: RequestInit,
  fallbackMessage: string
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND_URL}${path}`, init);
  } catch (transport) {
    // No connection, DNS, TLS, or cleartext-blocked: a transport failure.
    console.error(`Network request to ${path} failed:`, transport);
    throw new NetworkError();
  }

  let body = '';
  try {
    body = await response.text();
  } catch (readError) {
    console.error(`Reading response from ${path} failed:`, readError);
    throw new NetworkError();
  }

  let data: unknown = null;
  if (body) {
    try {
      data = JSON.parse(body);
    } catch (parseError) {
      console.error(
        `Non-JSON response from ${path} (status ${response.status}):`,
        parseError
      );
      throw new NetworkError();
    }
  }

  if (!response.ok) {
    const message = (data as { error?: unknown } | null)?.error;
    throw new Error(typeof message === 'string' ? message : fallbackMessage);
  }

  return data as T;
}

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
  | {
      kind: 'recall';
      status: 'ok';
      answer: string;
      memories: unknown[];
      /** The question reached past the free 7-day window; raise the paywall. */
      proBoundaryHit: boolean;
    }
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

export type CaptureNoteMemory = {
  id: string;
  content: string;
  person: string | null;
  location: string | null;
  topics: string[];
  created_at: string;
};

export type CaptureNoteReminder = {
  id: string;
  task: string;
  person: string | null;
  due_at: string | null;
  place_hint: string | null;
  status: ReminderStatus;
  created_at: string;
};

/** A capture that produced a note, with what Kandoo understood from it. */
export type CaptureNote = {
  id: string;
  text: string;
  note: { title: string; body: string } | null;
  created_at: string;
  memories: CaptureNoteMemory[];
  reminders: CaptureNoteReminder[];
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

  return apiFetch<InterpretationResponse>(
    '/interpret',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ text: trimmedText, clientTime, timezone }),
    },
    'Failed to interpret text.'
  );
}

/** Called from the review sheet. Reminders stay unscheduled until this fires. */
export async function confirmReminder(
  reminderId: string
): Promise<CreatedReminder> {
  const accessToken = await getAccessTokenOrThrow();

  const data = await apiFetch<{ reminder: CreatedReminder }>(
    `/reminders/${reminderId}/confirm`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    },
    'Failed to confirm reminder.'
  );

  return data.reminder;
}

/**
 * Confirmed + pending reminders, used on launch to rebuild the device's local
 * notification schedule. The device — not the server — decides what to fire.
 */
export async function fetchActiveReminders(): Promise<CreatedReminder[]> {
  const accessToken = await getAccessTokenOrThrow();

  const data = await apiFetch<{ reminders?: CreatedReminder[] }>(
    '/reminders/active',
    { headers: { Authorization: `Bearer ${accessToken}` } },
    'Failed to load reminders.'
  );

  return data.reminders ?? [];
}

/** The Memory screen: captures that produced a note, newest first. */
export async function fetchCaptureNotes(): Promise<CaptureNote[]> {
  const accessToken = await getAccessTokenOrThrow();

  const data = await apiFetch<{ captures?: CaptureNote[] }>(
    '/captures',
    { headers: { Authorization: `Bearer ${accessToken}` } },
    'Failed to load notes.'
  );

  return data.captures ?? [];
}

/** Dismiss a reminder server-side. The caller cancels its local notification. */
export async function dismissReminder(reminderId: string): Promise<void> {
  const accessToken = await getAccessTokenOrThrow();

  await apiFetch<unknown>(
    `/reminders/${reminderId}/dismiss`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    },
    'Failed to dismiss reminder.'
  );
}
