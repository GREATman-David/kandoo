import {
  clearOfflineCache,
  markNetworkFailure,
  markNetworkOk,
  readAllCached,
  recentlyOffline,
  rememberUser,
  setOffline,
  withOfflineCache,
} from './offlineCache';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';

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
 * The backend took too long — most often a free-tier server waking from sleep.
 * It IS a NetworkError, so reads fall back to saved copies; only the wording
 * differs, telling the user to try again rather than to check their signal.
 */
export class TimeoutError extends NetworkError {
  constructor() {
    super();
    this.message = 'Kandoo is taking longer than usual. Please try again in a moment.';
    this.name = 'TimeoutError';
  }
}

export const isNetworkError = (error: unknown): boolean =>
  error instanceof NetworkError;

/**
 * A message the backend chose to show (its errors are sanitised — AGENTS §10).
 * Distinct from a plain Error so the UI can tell it apart from a JS bug.
 */
export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Log a failed backend call at the right level. Being offline or timing out is
 * an expected state the UI already handles (saved copies, a friendly line), so
 * it is a warning; anything else is a real error worth the red dev overlay.
 */
export function logFailure(label: string, error: unknown): void {
  if (error instanceof NetworkError) console.warn(label, error.message);
  else console.error(label, error);
}

/**
 * The only way a caught error becomes on-screen text. Messages written for the
 * user — the backend's, offline/timeout, session ended — pass through; anything
 * else (a JS bug, a library error) shows the screen's own fallback line, and the
 * caller has already logged the real cause.
 */
export function userMessage(error: unknown, fallback: string): string {
  if (
    error instanceof ApiError ||
    error instanceof NetworkError ||
    error instanceof SessionExpiredError
  ) {
    return error.message;
  }
  return fallback;
}

/** Reads and simple writes. Long enough for a slow network, short enough to notice. */
const DEFAULT_TIMEOUT_MS = 20_000;
/**
 * Calls that run the model or embeddings. A sleeping free-tier server takes
 * ~35 s to wake, and a long recap takes a few seconds more to interpret, so
 * this leaves room for both instead of failing a request that would succeed.
 */
const AI_TIMEOUT_MS = 45_000;

/**
 * The backend rejected the session (401). The token is gone for good, so the
 * app signs out locally and the auth screen takes over; the UI shows this one
 * line rather than the server's wording.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super('Your session ended. Please sign in again.');
    this.name = 'SessionExpiredError';
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
 *   - 503 (backend can't reach its services) → NetworkError: offline, not failure.
 *   - 401 → refresh the session and retry once; sign out only if Supabase
 *     rejects the refresh outright.
 */
/** Short deadline while the network is known to be down (see offlineCache). */
const KNOWN_OFFLINE_TIMEOUT_MS = 8_000;

async function apiFetch<T>(
  path: string,
  init: RequestInit,
  fallbackMessage: string,
  opts: { timeoutMs?: number; retried?: boolean } = {}
): Promise<T> {
  try {
    const result = await apiFetchOnce<T>(path, init, fallbackMessage, opts);
    markNetworkOk();
    return result;
  } catch (error) {
    // Only a lost connection or timeout opens the "known offline" window; a
    // real answer from the server (even an error) means we are online.
    if (error instanceof NetworkError) markNetworkFailure();
    else markNetworkOk();
    throw error;
  }
}

async function apiFetchOnce<T>(
  path: string,
  init: RequestInit,
  fallbackMessage: string,
  opts: { timeoutMs?: number; retried?: boolean } = {}
): Promise<T> {
  const timeoutMs = Math.min(
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    recentlyOffline() ? KNOWN_OFFLINE_TIMEOUT_MS : Number.POSITIVE_INFINITY
  );
  // Without a deadline a hung connection (or a server still waking) leaves the
  // UI waiting forever — "Working it out" with no end.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      signal: controller.signal,
    });
  } catch (transport) {
    if (controller.signal.aborted) {
      console.warn(`Request to ${path} timed out after ${timeoutMs} ms.`);
      throw new TimeoutError();
    }
    // No connection, DNS, TLS, or cleartext-blocked: a transport failure.
    console.warn(`Network request to ${path} failed:`, transport);
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }

  // The backend is up but could not reach its own services (e.g. to verify the
  // session). For the user that is "offline", not an error or a sign-out.
  if (response.status === 503) {
    console.warn(`Backend unavailable for ${path} (503).`);
    throw new NetworkError();
  }

  setOffline(false);

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

  if (response.status === 401) {
    // Stay signed in until the user signs out: a 401 first gets a session
    // refresh and one retry. Only a refresh Supabase itself REJECTS (revoked,
    // signed out elsewhere) ends the session; a refresh that fails for lack of
    // a connection is just "offline".
    if (!opts.retried) {
      const { data: refreshed, error: refreshError } =
        await supabase.auth.refreshSession();
      if (refreshError && isAuthRetryableFetchError(refreshError)) {
        console.warn(`Session refresh for ${path} failed offline.`);
        throw new NetworkError();
      }
      const token = refreshed.session?.access_token;
      if (token) {
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${token}`);
        return apiFetch<T>(path, { ...init, headers }, fallbackMessage, {
          ...opts,
          retried: true,
        });
      }
    }

    console.error(`Session for ${path} was rejected after refresh; signing out.`);
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (signOutError) {
      console.error('Local sign-out after 401 failed:', signOutError);
    }
    await clearOfflineCache();
    throw new SessionExpiredError();
  }

  if (!response.ok) {
    const message = (data as { error?: unknown } | null)?.error;
    throw new ApiError(typeof message === 'string' ? message : fallbackMessage);
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
  /** Present on the reminders-tab list; used to open the parent note. */
  capture_id?: string | null;
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
      /** The question reached past the free 10-day window; raise the paywall. */
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
  /** Set when extraction judged the capture substantial enough to write up. */
  note?: { title: string; body: string } | null;
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
  /** `manual` marks a note/memory the user typed themselves ("Written by you"). */
  source: string | null;
  created_at: string;
  memories: CaptureNoteMemory[];
  reminders: CaptureNoteReminder[];
};

async function getAccessTokenOrThrow(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  // An expired token that could not be refreshed for lack of a connection is a
  // network failure, not a sign-out — offline copies can still be shown.
  if (error?.name === 'AuthRetryableFetchError') {
    console.error('Session refresh failed (offline?):', error);
    throw new NetworkError();
  }

  if (!session) {
    throw new Error('You must be signed in to use Kandoo.');
  }

  void rememberUser(session.user.id);
  return session.access_token;
}

export async function interpretText(
  text: string,
  /** Right after a purchase: ask the server to re-check Pro, not use its cache. */
  opts: { freshEntitlement?: boolean } = {}
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
      body: JSON.stringify({
        text: trimmedText,
        clientTime,
        timezone,
        ...(opts.freshEntitlement ? { freshEntitlement: true } : {}),
      }),
    },
    'Failed to interpret text.',
    { timeoutMs: AI_TIMEOUT_MS }
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
/**
 * Live server truth for the launch-time notification rebuild. Deliberately NOT
 * cached: reconcile cancels any notification missing from this list, so a stale
 * offline copy would silently cancel reminders confirmed since it was saved.
 * Offline, this throws and the sync is skipped — scheduled reminders stay put.
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

export type GroupedReminders = {
  needsReview: CreatedReminder[];
  active: CreatedReminder[];
  history: CreatedReminder[];
};

/** The Reminders tab. The device splits `active` into Today/Upcoming locally. */
export async function fetchGroupedReminders(): Promise<GroupedReminders> {
  return withOfflineCache('reminders:grouped', async () => {
    const accessToken = await getAccessTokenOrThrow();

    const data = await apiFetch<Partial<GroupedReminders>>(
      '/reminders',
      { headers: { Authorization: `Bearer ${accessToken}` } },
      'Failed to load reminders.'
    );

    return {
      needsReview: data.needsReview ?? [],
      active: data.active ?? [],
      history: data.history ?? [],
    };
  }, isNetworkError);
}

/** Manual reminder from the + button — created confirmed. Caller schedules it. */
export async function createManualReminder(input: {
  task: string;
  dueAt: string;
  person: string | null;
}): Promise<CreatedReminder> {
  const accessToken = await getAccessTokenOrThrow();

  const data = await apiFetch<{ reminder: CreatedReminder }>(
    '/reminders',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(input),
    },
    'Failed to create reminder.'
  );

  return data.reminder;
}

/** Edit task/time/person, or change status (done, snooze). Caller re-syncs the
 *  local notification. */
export async function updateReminder(
  id: string,
  patch: {
    task?: string;
    dueAt?: string | null;
    person?: string | null;
    status?: ReminderStatus;
  }
): Promise<CreatedReminder> {
  const accessToken = await getAccessTokenOrThrow();

  const data = await apiFetch<{ reminder: CreatedReminder }>(
    `/reminders/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(patch),
    },
    'Failed to update reminder.'
  );

  return data.reminder;
}

export type PersonSummary = {
  id: string;
  name: string;
  summary: string | null;
  memoryCount: number;
  reminderCount: number;
  noteCount: number;
  hasActiveReminder: boolean;
  lastMentionedAt: string;
};

export type PersonMemory = {
  id: string;
  content: string;
  person: string | null;
  created_at: string;
  capture_id: string | null;
};

export type PersonReminder = {
  id: string;
  task: string;
  status: ReminderStatus;
  due_at: string | null;
  created_at: string;
  capture_id: string | null;
};

export type PersonDetail = {
  id: string;
  name: string;
  memories: PersonMemory[];
  reminders: PersonReminder[];
  notes: { id: string; title: string | null; created_at: string }[];
};

/** The People tab — one row per person, most recently mentioned first. */
export async function fetchPeople(): Promise<PersonSummary[]> {
  return withOfflineCache('people', async () => {
    const accessToken = await getAccessTokenOrThrow();
    const data = await apiFetch<{ people?: PersonSummary[] }>(
      '/people',
      { headers: { Authorization: `Bearer ${accessToken}` } },
      'Failed to load people.'
    );
    return data.people ?? [];
  }, isNetworkError);
}

export async function fetchPerson(id: string): Promise<PersonDetail | null> {
  return withOfflineCache(`person:${id}`, async () => {
    const accessToken = await getAccessTokenOrThrow();
    const data = await apiFetch<{ person?: PersonDetail }>(
      `/people/${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      'Failed to load that person.'
    );
    return data.person ?? null;
  }, isNetworkError);
}

/** Merge others into the survivor. The survivor keeps everything. */
export async function mergePeople(
  survivorId: string,
  otherIds: string[]
): Promise<void> {
  const accessToken = await getAccessTokenOrThrow();
  await apiFetch<unknown>(
    '/people/merge',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ survivorId, otherIds }),
    },
    'Failed to merge those people.'
  );
}

export async function deletePerson(id: string): Promise<void> {
  const accessToken = await getAccessTokenOrThrow();
  await apiFetch<unknown>(
    `/people/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    'Failed to delete that person.'
  );
}

/** Hard-delete a reminder. Caller cancels its local notification. */
export async function deleteReminderById(id: string): Promise<void> {
  const accessToken = await getAccessTokenOrThrow();

  await apiFetch<unknown>(
    `/reminders/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    'Failed to delete reminder.'
  );
}

/**
 * Captures newest-first. The Memory screen passes `{ requireContent: true }` to
 * list everything with a note OR a memory (dropping bare recall queries); Home ▸
 * Recently passes `{ limit: 3, notedOnly: false }` to include one-line captures.
 */
export async function fetchCaptureNotes(
  opts: {
    limit?: number;
    notedOnly?: boolean;
    requireContent?: boolean;
    /** Only captures that produced a note, memory or reminder (Home ▸ Recently). */
    requireActions?: boolean;
    /** Only captures created before this ISO instant — the "load more" cursor. */
    before?: string;
  } = {}
): Promise<CaptureNote[]> {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.notedOnly === false) params.set('noted', 'false');
  if (opts.requireContent) params.set('content', 'true');
  if (opts.requireActions) params.set('actions', 'true');
  if (opts.before) params.set('before', opts.before);
  const query = params.toString();

  // Each list shape (Home's Recently, the Memory tab) is kept separately.
  return withOfflineCache(`captures:list:${query}`, async () => {
    const accessToken = await getAccessTokenOrThrow();

    const data = await apiFetch<{ captures?: CaptureNote[] }>(
      `/captures${query ? `?${query}` : ''}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      'Failed to load notes.'
    );

    return data.captures ?? [];
  }, isNetworkError);
}

/**
 * Manual entry from the + button. Send a note, a memory, or both; Kandoo saves
 * one `manual`-source capture and embeds the memory. Returns the assembled row.
 */
export async function createManualCapture(input: {
  note?: { title: string; body: string };
  memory?: { content: string };
}): Promise<CaptureNote | null> {
  const accessToken = await getAccessTokenOrThrow();

  const clientTime = new Date().toISOString();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const data = await apiFetch<{ capture?: CaptureNote | null }>(
    '/captures/manual',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ ...input, clientTime, timezone }),
    },
    'Could not save that.',
    { timeoutMs: AI_TIMEOUT_MS }
  );

  return data.capture ?? null;
}

/** Edit a memory's text; the backend re-embeds so recall matches the new words. */
export async function updateMemory(
  id: string,
  content: string
): Promise<CreatedMemory> {
  const accessToken = await getAccessTokenOrThrow();

  const data = await apiFetch<{ memory: CreatedMemory }>(
    `/memories/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ content }),
    },
    'Could not update that memory.',
    { timeoutMs: AI_TIMEOUT_MS }
  );

  return data.memory;
}

/** Delete one memory. */
export async function deleteMemoryById(id: string): Promise<void> {
  const accessToken = await getAccessTokenOrThrow();
  await apiFetch<unknown>(
    `/memories/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    'Could not delete that memory.'
  );
}

/** Edit a capture's note (title + body only; memories are left untouched). */
export async function updateCaptureNote(
  id: string,
  note: { title: string; body: string }
): Promise<void> {
  const accessToken = await getAccessTokenOrThrow();
  await apiFetch<unknown>(
    `/captures/${encodeURIComponent(id)}/note`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(note),
    },
    'Could not update that note.'
  );
}

/**
 * "Take note": ask Kandoo to write a clean note for one capture. Returns the
 * saved note (or the one it already had — a capture is never noted twice).
 */
export async function takeNote(
  captureId: string
): Promise<{ title: string; body: string }> {
  const accessToken = await getAccessTokenOrThrow();
  const result = await apiFetch<{ note: { title: string; body: string } }>(
    `/captures/${encodeURIComponent(captureId)}/note`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    'Kandoo could not take a note just now.',
    { timeoutMs: AI_TIMEOUT_MS }
  );
  return result.note;
}

/** Delete a capture (a note) and the memories it produced. */
export async function deleteCaptureById(id: string): Promise<void> {
  const accessToken = await getAccessTokenOrThrow();
  await apiFetch<unknown>(
    `/captures/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    'Could not delete that note.'
  );
}

/** One capture with everything it produced — for the note-detail screen. */
export async function fetchCaptureNote(id: string): Promise<CaptureNote | null> {
  try {
    return await withOfflineCache(`captures:one:${id}`, async () => {
      const accessToken = await getAccessTokenOrThrow();

      const data = await apiFetch<{ capture?: CaptureNote }>(
        `/captures/${encodeURIComponent(id)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        'Failed to load that note.'
      );

      return data.capture ?? null;
    }, isNetworkError);
  } catch (error) {
    // Offline and never opened before: it is usually inside a saved list.
    if (!isNetworkError(error)) throw error;
    const lists = await readAllCached<CaptureNote[]>('captures:list:');
    const found = lists.flat().find((capture) => capture.id === id);
    if (!found) throw error;
    setOffline(true);
    return found;
  }
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
