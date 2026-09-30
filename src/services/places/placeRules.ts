import type { ArmedReminder, PendingNotice, PlaceState, WatchedPlace } from './placeStore';

/**
 * The decisions behind Places, as pure functions of the on-device state — no
 * storage, no notifications, no React Native — so they can be tested directly
 * (placeRules.test.ts). placeEngine carries out what these decide.
 */

/** A place unvisited this long, with a memory there, earns a Kandoo Moment. */
export const MOMENT_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
/** …sooner for a starred place: it matters more, so it comes back sooner. */
export const STARRED_MOMENT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** At most one Moment per place in this window, however often you pass by. */
export const MOMENT_COOLDOWN_MS = 20 * 60 * 60 * 1000;
/** At most this many Moments in a day across every place — never a stream. */
export const MAX_MOMENTS_PER_DAY = 2;

/**
 * The dwell: how long after arriving a notice waits, so that passing through
 * (driving past school) cancels it instead of firing. Short for reminders —
 * the user is arriving and wants them — longer for Moments, which are only
 * worth it if you are actually spending time there.
 */
export const REMINDER_DWELL_S = 60;
export const MOMENT_DWELL_S = 180;

/** Stays kept per place for the monthly recap; older ones roll off. */
export const MAX_VISITS_PER_PLACE = 120;

export type PlaceEvent = 'enter' | 'exit';

export type Moment = { placeId: string; title: string; body: string };

export type Outcome =
  | { kind: 'ignored'; why: 'unknown-region' | 'settled' | 'no-change' }
  | {
      kind: 'arrive';
      place: WatchedPlace;
      reminders: ArmedReminder[];
      moment: Moment | null;
    }
  | {
      kind: 'leave';
      place: WatchedPlace;
      reminders: ArmedReminder[];
      /** Notices from this visit that hadn't shown yet: a drive-by. Cancel them. */
      cancel: PendingNotice[];
    };

/** The local calendar day of an instant — the Moment cap resets at midnight. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

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
  const gap = place.starred ? STARRED_MOMENT_AFTER_MS : MOMENT_AFTER_MS;
  const lastMoment = state.lastMoment[place.id] ?? 0;
  if (now - lastSeen < gap || now - lastMoment < MOMENT_COOLDOWN_MS) return null;
  const today = state.momentDay.day === localDay(now) ? state.momentDay.count : 0;
  if (today >= MAX_MOMENTS_PER_DAY) return null;
  return {
    placeId: place.id,
    title: `Back at ${place.name}`,
    body: `Last time you were here: ${memory.content}`,
  };
}

function recordArrival(state: PlaceState, placeId: string, now: number): void {
  const visits = state.visits[placeId] ?? [];
  visits.push({ a: now, l: null });
  state.visits[placeId] = visits.slice(-MAX_VISITS_PER_PLACE);
}

function recordDeparture(state: PlaceState, placeId: string, now: number): void {
  const last = state.visits[placeId]?.at(-1);
  if (last && last.l === null) last.l = now;
}

/**
 * Leaving: every notice from this visit still inside its dwell is cancelled,
 * and undone as if it never happened — a cancelled reminder can fire on the
 * next real arrival; a cancelled Moment doesn't use up the day's allowance.
 */
function cancelPending(state: PlaceState, placeId: string, now: number): PendingNotice[] {
  const pending = state.pending[placeId] ?? [];
  const cancel = pending.filter((p) => p.fireAt > now);
  for (const notice of cancel) {
    if (notice.reminderId) delete state.delivered[notice.reminderId];
    if (notice.moment) {
      if (notice.moment.prevLastMoment === null) delete state.lastMoment[placeId];
      else state.lastMoment[placeId] = notice.moment.prevLastMoment;
      if (state.momentDay.day === localDay(now) && state.momentDay.count > 0) state.momentDay.count--;
    }
  }
  delete state.pending[placeId];
  return cancel;
}

/**
 * One OS region changed state. Updates the region state, visit log and pending
 * notices in `state`, and says what should now be shown or cancelled. A place
 * may be several regions — an irregular shape is covered by a few circles — so
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
    if (nowInside && !wasInside) {
      state.lastArrived[place.id] = now;
      recordArrival(state, place.id, now);
    }
    return { kind: 'ignored', why: 'settled' };
  }

  if (!wasInside && nowInside) {
    const previousVisit = state.lastArrived[place.id] ?? 0;
    state.lastArrived[place.id] = now;
    recordArrival(state, place.id, now);
    return {
      kind: 'arrive',
      place,
      reminders: dueReminders(state, place, 'arrive', now),
      moment: momentFor(state, place, previousVisit, now),
    };
  }
  if (wasInside && !nowInside) {
    recordDeparture(state, place.id, now);
    return {
      kind: 'leave',
      place,
      reminders: dueReminders(state, place, 'leave', now),
      cancel: cancelPending(state, place.id, now),
    };
  }
  return { kind: 'ignored', why: 'no-change' };
}

/** Places the user is inside right now, per the last events — for Home. */
export function placesInside(state: PlaceState): WatchedPlace[] {
  return Object.values(state.places).filter((place) => isInside(state, place));
}
