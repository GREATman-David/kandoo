import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LatLng } from '@/utils/geo';

/**
 * The phone's place state (AGENTS §3.2: the DEVICE owns triggers; §3.5: where
 * you have been never leaves the phone).
 *
 * Read by the geofence task, which runs headless with the app closed, so it
 * holds everything an arrival needs — no network on that path. Written by the
 * foreground sync and by reminder scheduling. Every write goes through
 * `updatePlaceState`, which serialises read-modify-write: two geofence events
 * for one place (it may be several circles) must not overwrite each other.
 */

export const GEOFENCE_TASK = 'kandoo-places-geofence';

const KEY = 'kandoo.places.state.v1';

export type WatchedPlace = {
  id: string;
  name: string;
  center: LatLng;
  radiusM: number;
  area: LatLng[] | null;
  /** The newest memory here, for a Kandoo Moment on arrival. */
  latestMemory: { content: string; created_at: string } | null;
  /** Region ids registered with the OS for this place: `${placeId}:${n}`. */
  regions: string[];
  /** The user's own important places: Moments come sooner (placeRules). */
  starred?: boolean;
};

/**
 * A place notification scheduled on arrival but not shown yet (the dwell).
 * Leaving before `fireAt` cancels it — a drive-by is not an arrival.
 */
export type PendingNotice = {
  notificationId: string;
  fireAt: number;
  /** Set for a reminder: un-marked as delivered if cancelled. */
  reminderId: string | null;
  /** Set for a Moment: the lastMoment to restore if cancelled. */
  moment: { prevLastMoment: number | null } | null;
};

/** One stay at a place: arrived (a) and left (l, null while there). ms. */
export type Visit = { a: number; l: number | null };

export type SyncStatus = 'watching' | 'not-pro' | 'no-permission' | 'location-off' | 'error';

export type ArmedReminder = {
  id: string;
  task: string;
  person: string | null;
  placeId: string;
  trigger: 'arrive' | 'leave';
  /** ISO; an event before it does not fire the reminder. */
  notBefore: string | null;
  insistent: boolean;
};

export type PlaceState = {
  places: Record<string, WatchedPlace>;
  reminders: ArmedReminder[];
  /** Last known state of each OS region; absent = never heard from it. */
  regionInside: Record<string, boolean>;
  /**
   * Registering geofences makes Android report the CURRENT state of every
   * region at once. Until this instant, the first event from a region we have
   * never heard from only records where the user already is — it must not fire
   * "when I get home" while they are sitting at home.
   */
  settleUntil: number;
  /** The exact regions last registered; unchanged means no re-register. */
  registeredKey: string;
  /** Reminder id → when it fired, so an arrival never fires one twice. */
  delivered: Record<string, number>;
  /** Place id → last arrival, ms. Device-only visit history. */
  lastArrived: Record<string, number>;
  /** Place id → last Kandoo Moment shown, ms. */
  lastMoment: Record<string, number>;
  /** When the current set of regions was handed to the OS, ms. */
  registeredAt: number;
  /**
   * Location services were off at the last sync. Android DELETES every
   * geofence when location is switched off, so the next sync with it back on
   * must re-register even though nothing about the places changed.
   */
  servicesWereOff: boolean;
  /** Place id → notices waiting out the dwell. */
  pending: Record<string, PendingNotice[]>;
  /** Place id → recent stays, newest last. Device-only (AGENTS §3.5). */
  visits: Record<string, Visit[]>;
  /** Place id → name, kept for the monthly recap after a place stops being watched. */
  names: Record<string, string>;
  /** Moments shown on a local day, to cap them across all places. */
  momentDay: { day: string; count: number };
  /** The last sync's outcome, for the Places tab to be honest about. */
  lastSync: { at: number; status: SyncStatus; places: number } | null;
};

export function emptyPlaceState(): PlaceState {
  return {
    places: {},
    reminders: [],
    regionInside: {},
    settleUntil: 0,
    registeredKey: '',
    delivered: {},
    lastArrived: {},
    lastMoment: {},
    registeredAt: 0,
    servicesWereOff: false,
    pending: {},
    visits: {},
    names: {},
    momentDay: { day: '', count: 0 },
    lastSync: null,
  };
}

export async function readPlaceState(): Promise<PlaceState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...emptyPlaceState(), ...(JSON.parse(raw) as Partial<PlaceState>) } : emptyPlaceState();
  } catch (error) {
    console.warn('Place state read failed; treating as empty:', error);
    return emptyPlaceState();
  }
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Read, change and save the state as one step. Calls run strictly one after
 * another. A failed write is thrown to the caller (AGENTS §3.7) — the caller
 * decides whether it can carry on.
 */
export function updatePlaceState<T>(change: (state: PlaceState) => Promise<T> | T): Promise<T> {
  const run = queue.then(async () => {
    const state = await readPlaceState();
    const result = await change(state);
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function clearPlaceState(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

/**
 * A reminder was cancelled, done, dismissed or deleted: it must never fire on
 * arrival. Called from localNotifications.cancelReminder for every reminder,
 * so it is a no-op for the (common) reminder that was never a place reminder.
 */
export async function forgetPlaceReminder(reminderId: string): Promise<void> {
  const state = await readPlaceState();
  if (!state.reminders.some((r) => r.id === reminderId)) return;
  await updatePlaceState((s) => {
    s.reminders = s.reminders.filter((r) => r.id !== reminderId);
  });
}

/**
 * A place reminder was just confirmed. Arm it at once if its place is already
 * watched; returns false when the place still needs a full sync (not drawn, or
 * not yet among the watched places).
 */
export async function armPlaceReminder(reminder: ArmedReminder): Promise<boolean> {
  return updatePlaceState((s) => {
    if (!s.places[reminder.placeId]) return false;
    s.reminders = [...s.reminders.filter((r) => r.id !== reminder.id), reminder];
    delete s.delivered[reminder.id];
    return true;
  });
}

// ---- sync requests -------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

/** Something changed that the watched places may depend on; resync soon. */
export function requestPlaceResync(): void {
  listeners.forEach((listener) => listener());
}

export function onPlaceResyncRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
