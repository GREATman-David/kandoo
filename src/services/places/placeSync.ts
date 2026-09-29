import * as Location from 'expo-location';

import {
  fetchActiveReminders,
  fetchPlacesLive,
  logFailure,
  type CreatedReminder,
  type PlaceSummary,
} from '@/services/interpretationService';
import { readEntitlement } from '@/services/purchases';
import { coverCircles, type Circle } from '@/utils/geo';

import { stopWatchingPlaces } from './placeEngine';
import { getPlacePermission } from './placePermissions';
import {
  GEOFENCE_TASK,
  updatePlaceState,
  type ArmedReminder,
  type WatchedPlace,
} from './placeStore';

/**
 * Foreground half of Places: decide WHICH places the phone watches and hand
 * their circles to the OS. Runs on Home, when Pro changes, and after a place
 * reminder is confirmed. Never on the geofence path.
 *
 * Bounded (AGENTS §3.5): only drawn places that have something to surface —
 * a reminder waiting or a memory made there — and at most MAX_WATCHED_PLACES,
 * those with a waiting reminder first, then the most recently mentioned.
 */

/** 15 places × up to 6 circles each stays under Android's 100 geofences. */
export const MAX_WATCHED_PLACES = 15;
/** Android's burst of current-state events after registering lands well inside this. */
const SETTLE_MS = 2 * 60 * 1000;

export type PlaceSyncResult =
  | { status: 'watching'; places: number; regions: number }
  | { status: 'not-pro' | 'no-permission' | 'unknown' };

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

type Chosen = { place: WatchedPlace; circles: Circle[] };

function choose(places: PlaceSummary[], reminders: ArmedReminder[]): Chosen[] {
  const waiting = new Set(reminders.map((r) => r.placeId));
  return places
    .filter((p) => p.center && p.radiusM && (waiting.has(p.id) || p.latestMemory))
    .sort((a, b) => {
      const byWaiting = Number(waiting.has(b.id)) - Number(waiting.has(a.id));
      return byWaiting || b.lastMentionedAt.localeCompare(a.lastMentionedAt);
    })
    .slice(0, MAX_WATCHED_PLACES)
    .map((p) => {
      const geometry = { center: p.center!, radiusM: p.radiusM!, area: p.area };
      const circles = coverCircles(geometry);
      const place: WatchedPlace = {
        id: p.id,
        name: p.name,
        ...geometry,
        latestMemory: p.latestMemory
          ? { content: p.latestMemory.content, created_at: p.latestMemory.created_at }
          : null,
        regions: circles.map((_, i) => `${p.id}:${i}`),
      };
      return { place, circles };
    });
}

/**
 * Bring the phone's watching in line with the server. Idempotent: when the set
 * of circles is unchanged it does not re-register, so opening Home repeatedly
 * never causes Android to re-send its burst of events.
 */
export async function syncPlaces(): Promise<PlaceSyncResult> {
  const pro = await readEntitlement();
  // Unknown (RevenueCat not ready, offline): leave whatever is running alone.
  if (pro === null) return { status: 'unknown' };
  if (!pro) {
    await stopWatchingPlaces({ forget: false });
    return { status: 'not-pro' };
  }
  if ((await getPlacePermission()) !== 'granted') {
    await stopWatchingPlaces({ forget: false });
    return { status: 'no-permission' };
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

    const changed = key !== state.registeredKey || !running;
    if (changed && regions.length > 0) {
      state.registeredKey = key;
      state.settleUntil = Date.now() + SETTLE_MS;
    }
    return changed;
  });

  if (regions.length === 0) {
    await stopWatchingPlaces({ forget: false });
    return { status: 'watching', places: 0, regions: 0 };
  }
  if (needsRegister) {
    // Replaces the task's previous regions in one call.
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
  }
  return { status: 'watching', places: chosen.length, regions: regions.length };
}

let inFlight: Promise<PlaceSyncResult | null> | null = null;
let again = false;

/**
 * Run a sync, coalescing overlapping requests: a request that arrives while one
 * is running triggers exactly one more run afterwards. Failures are logged and
 * reported as null — the circles already registered keep working.
 */
export function requestPlaceSync(): Promise<PlaceSyncResult | null> {
  if (inFlight) {
    again = true;
    return inFlight;
  }
  inFlight = (async () => {
    let result: PlaceSyncResult | null = null;
    do {
      again = false;
      try {
        result = await syncPlaces();
      } catch (error) {
        logFailure('Place sync failed:', error);
        result = null;
      }
    } while (again);
    return result;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
