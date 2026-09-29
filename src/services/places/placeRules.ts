import type { ArmedReminder, PlaceState, WatchedPlace } from './placeStore';

/**
 * The decisions behind Places, as pure functions of the on-device state — no
 * storage, no notifications, no React Native — so they can be tested directly
 * (scripts/test-place-rules.ts). placeEngine executes what these decide.
 */

/** A place unvisited this long, with a memory there, earns a Kandoo Moment. */
export const MOMENT_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
/** At most one Moment per place in this window, however often you pass by. */
export const MOMENT_COOLDOWN_MS = 20 * 60 * 60 * 1000;

export type PlaceEvent = 'enter' | 'exit';

export type Moment = { placeId: string; title: string; body: string };

export type Outcome =
  | { kind: 'ignored'; why: 'unknown-region' | 'settled' | 'no-change' }
  | { kind: 'arrive' | 'leave'; place: WatchedPlace; reminders: ArmedReminder[]; moment: Moment | null };

function isInside(state: PlaceState, place: WatchedPlace): boolean {
  return place.regions.some((region) => state.regionInside[region] === true);
}

function dueReminders(
  state: PlaceState,
  place: WatchedPlace,
  trigger: 'arrive' | 'leave',
  now: number
): ArmedReminder[] {
  return state.reminders.filter(
    (r) =>
      r.placeId === place.id &&
      r.trigger === trigger &&
      !state.delivered[r.id] &&
      (!r.notBefore || Date.parse(r.notBefore) <= now)
  );
}

function momentFor(state: PlaceState, place: WatchedPlace, previousVisit: number, now: number): Moment | null {
  const memory = place.latestMemory;
  if (!memory) return null;
  // "A while" counts from the last time the user was here OR said something
  // about here, whichever is later.
  const lastSeen = Math.max(previousVisit, Date.parse(memory.created_at) || 0);
  const lastMoment = state.lastMoment[place.id] ?? 0;
  if (now - lastSeen < MOMENT_AFTER_MS || now - lastMoment < MOMENT_COOLDOWN_MS) return null;
  return {
    placeId: place.id,
    title: `Back at ${place.name}`,
    body: `Last time you were here: ${memory.content}`,
  };
}

/**
 * One OS region changed state. Updates the region state (and, on arrival, the
 * visit time) in `state`, and says what should now be shown. A place may be
 * several regions — an irregular shape is covered by a few circles — so
 * arriving means going from NO region of the place to ANY, leaving the reverse.
 */
export function applyGeofenceEvent(
  state: PlaceState,
  event: PlaceEvent,
  regionId: string,
  now: number
): Outcome {
  const placeId = regionId.split(':')[0];
  const place = state.places[placeId];
  if (!place || !place.regions.includes(regionId)) return { kind: 'ignored', why: 'unknown-region' };

  const wasInside = isInside(state, place);
  const heardBefore = regionId in state.regionInside;
  state.regionInside[regionId] = event === 'enter';
  const nowInside = isInside(state, place);

  // The burst Android sends right after registering reports where the user
  // already IS. Record it; fire nothing ("when I get home" must not go off
  // while they sit at home).
  if (!heardBefore && now < state.settleUntil) {
    if (nowInside && !wasInside) state.lastArrived[place.id] = now;
    return { kind: 'ignored', why: 'settled' };
  }

  if (!wasInside && nowInside) {
    const previousVisit = state.lastArrived[place.id] ?? 0;
    state.lastArrived[place.id] = now;
    return {
      kind: 'arrive',
      place,
      reminders: dueReminders(state, place, 'arrive', now),
      moment: momentFor(state, place, previousVisit, now),
    };
  }
  if (wasInside && !nowInside) {
    return { kind: 'leave', place, reminders: dueReminders(state, place, 'leave', now), moment: null };
  }
  return { kind: 'ignored', why: 'no-change' };
}
