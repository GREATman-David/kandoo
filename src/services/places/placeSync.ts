import * as Location from 'expo-location';

import {
  fetchActiveReminders,
  fetchPlacesLive,
  isNetworkError,
  logFailure,
  type CreatedReminder,
  type PlaceSummary,
} from '@/services/interpretationService';
import { readEntitlement } from '@/services/purchases';
import { coverCircles, type Circle, type PlaceGeometry } from '@/utils/geo';

import { stopWatchingPlaces } from './placeEngine';
import { getPlacePermission } from './placePermissions';
import {
  GEOFENCE_TASK,
  updatePlaceState,
  type ArmedReminder,
  type SyncStatus,
  type WatchedPlace,
} from './placeStore';

/**
 * Foreground half of Places: decide WHICH places the phone watches and hand
 * their circles to the OS. Runs from Home (throttled), when Pro changes, and
 * whenever a place or place reminder changes. Never on the geofence path.
 *
 * Bounded (AGENTS §3.5): only drawn places with something to surface — a
 * reminder waiting or a memory made there — at most MAX_WATCHED_PLACES:
 * waiting reminders first, then starred, then the most recently mentioned.
 */

/** 15 places × up to 6 circles each stays under Android's 100 geofences. */
export const MAX_WATCHED_PLACES = 15;
/** Android's burst of current-state events after registering lands well inside this. */
const SETTLE_MS = 2 * 60 * 1000;
/**
 * Re-register at least this often even when nothing changed. Android silently
 * drops geofences in some cases (location switched off, Play Services
 * updated, storage cleared); re-registering is cheap and the settle window
 * keeps it silent.
 */
const REFRESH_MS = 12 * 60 * 60 * 1000;
/** A sync triggered just by opening the app runs at most this often. */
const FOREGROUND_MIN_INTERVAL_MS = 5 * 60 * 1000;

export type PlaceSyncResult =
  | { status: 'watching'; places: number; regions: number }
  | { status: Exclude<SyncStatus, 'watching' | 'error'> };

function armed(reminders: CreatedReminder[]): ArmedReminder[] {
  return reminders
    .filter((r) => r.status === 'confirmed' && !r.due_at && !!r.place_id)
    .map((r) => ({
      id: r.id,
      task: r.task,
      person: r.person,
      placeId: r.place_id as string,
      trigger: r.place_trigger === 'leave' ? 'leave' : 'arrive',
      notBefore: r.not_before ?? null,
      insistent: r.insistent,
    }));
}

/** coverCircles is real work on a phone; a shape's circles never change. */
const circleCache = new Map<string, Circle[]>();
function circlesFor(geometry: PlaceGeometry): Circle[] {
  const key = JSON.stringify(geometry);
  let circles = circleCache.get(key);
  if (!circles) {
    circles = coverCircles(geometry);
    if (circleCache.size > 64) circleCache.clear();
    circleCache.set(key, circles);
  }
  return circles;
}

type Chosen = { place: WatchedPlace; circles: Circle[] };

function choose(places: PlaceSummary[], reminders: ArmedReminder[]): Chosen[] {
  const waiting = new Set(reminders.map((r) => r.placeId));
  return places
    .filter((p) => p.center && p.radiusM && (waiting.has(p.id) || p.latestMemory || p.starred))
    .sort((a, b) => {
      const byWaiting = Number(waiting.has(b.id)) - Number(waiting.has(a.id));
      const byStar = Number(!!b.starred) - Number(!!a.starred);
      return byWaiting || byStar || b.lastMentionedAt.localeCompare(a.lastMentionedAt);
    })
    .slice(0, MAX_WATCHED_PLACES)
    .map((p) => {
      const geometry = { center: p.center!, radiusM: p.radiusM!, area: p.area };
      const circles = circlesFor(geometry);
      const place: WatchedPlace = {
        id: p.id,
        name: p.name,
        ...geometry,
        starred: !!p.starred,
        latestMemory: p.latestMemory
          ? { content: p.latestMemory.content, created_at: p.latestMemory.created_at }
          : null,
        regions: circles.map((_, i) => `${p.id}:${i}`),
      };
      return { place, circles };
    });
}

async function record(status: SyncStatus, places = 0): Promise<void> {
  await updatePlaceState((s) => {
    s.lastSync = { at: Date.now(), status, places };
    if (status === 'location-off') s.servicesWereOff = true;
  });
}

/**
 * Bring the phone's watching in line with the server. Registers with the OS
 * only when the circles changed, location came back on, the last registration
 * is old, or it never took — and records success only AFTER the OS accepted
 * it, so a failed registration is retried next time rather than forgotten.
 */
export async function syncPlaces(): Promise<PlaceSyncResult> {
  const pro = await readEntitlement();
  // Unknown (RevenueCat not ready, offline): leave whatever is running alone.
  if (pro === null) return { status: 'watching', places: 0, regions: 0 };
  if (!pro) {
    await stopWatchingPlaces({ forget: false });
    await record('not-pro');
    return { status: 'not-pro' };
  }
  if ((await getPlacePermission()) !== 'granted') {
    await stopWatchingPlaces({ forget: false });
    await record('no-permission');
    return { status: 'no-permission' };
  }
  // Location off: Android has already removed our geofences and will reject
  // new ones. Say so, and re-register the moment it is back on.
  if (!(await Location.hasServicesEnabledAsync())) {
    await record('location-off');
    return { status: 'location-off' };
  }

  // Live, never cached: anything missing here stops being watched.
  const [places, reminders] = await Promise.all([fetchPlacesLive(), fetchActiveReminders()]);
  const toArm = armed(reminders);
  const chosen = choose(places, toArm);

  const regions: Location.LocationRegion[] = chosen.flatMap(({ place, circles }) =>
    circles.map((circle, i) => ({
      identifier: place.regions[i],
      latitude: circle.center.lat,
      longitude: circle.center.lng,
      radius: Math.round(circle.radiusM),
      notifyOnEnter: true,
      notifyOnExit: true,
    }))
  );
  const key = JSON.stringify(
    regions.map((r) => [r.identifier, r.latitude.toFixed(5), r.longitude.toFixed(5), r.radius])
  );
  const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);

  const needsRegister = await updatePlaceState((state) => {
    state.places = Object.fromEntries(chosen.map(({ place }) => [place.id, place]));
    // Names of every place, for the recap — even ones not watched right now.
    for (const p of places) state.names[p.id] = p.name;
    const watchedIds = new Set(chosen.map(({ place }) => place.id));
    state.reminders = toArm.filter((r) => watchedIds.has(r.placeId));

    // Forget what no longer applies, so the state never grows without bound.
    const liveReminders = new Set(toArm.map((r) => r.id));
    for (const id of Object.keys(state.delivered)) {
      if (!liveReminders.has(id)) delete state.delivered[id];
    }
    const liveRegions = new Set(regions.map((r) => r.identifier as string));
    for (const id of Object.keys(state.regionInside)) {
      if (!liveRegions.has(id)) delete state.regionInside[id];
    }
    const livePlaces = new Set(places.map((p) => p.id));
    for (const id of Object.keys(state.visits)) {
      if (!livePlaces.has(id)) delete state.visits[id];
    }

    return (
      key !== state.registeredKey ||
      !running ||
      state.servicesWereOff ||
      Date.now() - state.registeredAt > REFRESH_MS
    );
  });

  if (regions.length === 0) {
    await stopWatchingPlaces({ forget: false });
    await record('watching', 0);
    return { status: 'watching', places: 0, regions: 0 };
  }

  if (needsRegister) {
    // Replaces the task's previous regions in one call.
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    await updatePlaceState((state) => {
      state.registeredKey = key;
      state.registeredAt = Date.now();
      state.settleUntil = Date.now() + SETTLE_MS;
      state.servicesWereOff = false;
    });
  }
  await record('watching', chosen.length);
  return { status: 'watching', places: chosen.length, regions: regions.length };
}

let inFlight: Promise<PlaceSyncResult | null> | null = null;
let again = false;
let lastRunAt = 0;

/**
 * Run a sync, coalescing overlapping requests: a request that arrives while one
 * is running triggers exactly one more run afterwards. `reason: 'foreground'`
 * (the app merely came to the front) is skipped if a sync ran recently;
 * anything the user changed always runs. Failures are logged, recorded for
 * the Places tab, and reported as null — the circles already registered keep
 * working.
 */
export function requestPlaceSync(reason: 'foreground' | 'change' = 'change'): Promise<PlaceSyncResult | null> {
  if (reason === 'foreground' && Date.now() - lastRunAt < FOREGROUND_MIN_INTERVAL_MS && !inFlight) {
    return Promise.resolve(null);
  }
  if (inFlight) {
    again = true;
    return inFlight;
  }
  inFlight = (async () => {
    let result: PlaceSyncResult | null = null;
    do {
      again = false;
      lastRunAt = Date.now();
      try {
        result = await syncPlaces();
      } catch (error) {
        logFailure('Place sync failed:', error);
        result = null;
        // Offline is normal and the registered places keep working; only a
        // real failure is worth telling the user about.
        if (!isNetworkError(error)) {
          await record('error').catch((recordError) =>
            console.warn('Recording the place sync failure failed:', recordError)
          );
        }
      }
    } while (again);
    return result;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
