import * as Location from 'expo-location';

import { presentMomentNow, presentReminderNow } from '@/services/localNotifications';

import { applyGeofenceEvent, type PlaceEvent } from './placeRules';
import { GEOFENCE_TASK, clearPlaceState, updatePlaceState } from './placeStore';

/**
 * What happens when the phone crosses a place's edge. Runs inside the geofence
 * task — headless, often with the app closed and no connection — so it reads
 * only the on-device state and never calls the server. The decisions are in
 * placeRules (pure, tested); this file only shows what they decide.
 */

export async function handleGeofenceEvent(event: PlaceEvent, regionId: string): Promise<void> {
  const summary = await updatePlaceState(async (state) => {
    const now = Date.now();
    const outcome = applyGeofenceEvent(state, event, regionId, now);
    if (outcome.kind === 'ignored') return outcome.why;

    const body = `${outcome.kind === 'arrive' ? 'At' : 'Leaving'} ${outcome.place.name}`;
    let fired = 0;
    for (const reminder of outcome.reminders) {
      try {
        await presentReminderNow(reminder, body);
        state.delivered[reminder.id] = now;
        fired++;
      } catch (error) {
        // Not marked delivered, so the next arrival tries again.
        console.error('Place reminder notification failed:', error);
      }
    }

    if (outcome.moment) {
      try {
        await presentMomentNow(outcome.moment);
        state.lastMoment[outcome.moment.placeId] = now;
      } catch (error) {
        console.error('Kandoo Moment notification failed:', error);
      }
    }

    return `${outcome.kind}, ${fired} reminder(s)${outcome.moment ? ', moment' : ''}`;
  });

  // Ids and counts only — never place names or memory content (AGENTS §10).
  if (__DEV__) console.log(`[places] ${event} ${regionId}: ${summary}`);
}

/**
 * Stop watching everything — sign-out (`forget`: also drop this account's
 * places and visit history), or Pro ending / permission withdrawn (keep them).
 * Failures reach the caller rather than being swallowed.
 */
export async function stopWatchingPlaces(opts: { forget: boolean }): Promise<void> {
  if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }
  if (opts.forget) {
    await clearPlaceState();
  } else {
    await updatePlaceState((s) => {
      s.registeredKey = '';
      s.regionInside = {};
    });
  }
}
