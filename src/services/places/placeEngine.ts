import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import {
  cancelPlaceNotice,
  scheduleMoment,
  schedulePlaceReminder,
} from '@/services/localNotifications';

import {
  MOMENT_DWELL_S,
  REMINDER_DWELL_S,
  applyGeofenceEvent,
  localDay,
  type PlaceEvent,
} from './placeRules';
import { GEOFENCE_TASK, clearPlaceState, updatePlaceState, type PendingNotice } from './placeStore';

/**
 * What happens when the phone crosses a place's edge. Runs inside the geofence
 * task — headless, often with the app closed and no connection — so it reads
 * only the on-device state and never calls the server. The decisions are in
 * placeRules (pure, tested); this file only carries them out.
 */

export async function handleGeofenceEvent(event: PlaceEvent, regionId: string): Promise<void> {
  const summary = await updatePlaceState(async (state) => {
    const now = Date.now();
    const outcome = applyGeofenceEvent(state, event, regionId, now);
    if (outcome.kind === 'ignored') return outcome.why;

    const place = outcome.place;

    if (outcome.kind === 'leave') {
      // A drive-by: what arrival scheduled hasn't shown yet — take it back.
      for (const notice of outcome.cancel) {
        try {
          await cancelPlaceNotice(notice.notificationId);
        } catch (error) {
          console.warn('Cancelling a place notice failed:', error);
        }
      }
      let fired = 0;
      for (const reminder of outcome.reminders) {
        try {
          await schedulePlaceReminder(reminder, `Leaving ${place.name}`, 0);
          state.delivered[reminder.id] = now;
          fired++;
        } catch (error) {
          // Not marked delivered, so the next departure tries again.
          console.error('Place reminder notification failed:', error);
        }
      }
      return `leave, ${fired} reminder(s), ${outcome.cancel.length} cancelled`;
    }

    // Arrive: schedule after the dwell; leaving first cancels (placeRules).
    const pending: PendingNotice[] = [];
    for (const reminder of outcome.reminders) {
      try {
        const id = await schedulePlaceReminder(reminder, `At ${place.name}`, REMINDER_DWELL_S);
        state.delivered[reminder.id] = now;
        pending.push({ notificationId: id, fireAt: now + REMINDER_DWELL_S * 1000, reminderId: reminder.id, moment: null });
      } catch (error) {
        console.error('Place reminder notification failed:', error);
      }
    }
    if (outcome.moment) {
      try {
        const id = await scheduleMoment(outcome.moment, MOMENT_DWELL_S);
        const prev = state.lastMoment[place.id] ?? null;
        state.lastMoment[place.id] = now;
        const day = localDay(now);
        state.momentDay = { day, count: (state.momentDay.day === day ? state.momentDay.count : 0) + 1 };
        pending.push({ notificationId: id, fireAt: now + MOMENT_DWELL_S * 1000, reminderId: null, moment: { prevLastMoment: prev } });
      } catch (error) {
        console.error('Kandoo Moment notification failed:', error);
      }
    }
    state.pending[place.id] = pending;

    return `arrive, ${outcome.reminders.length} reminder(s)${outcome.moment ? ', moment' : ''}`;
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
  // Ask TaskManager, not Location: hasStartedGeofencingAsync itself throws
  // without background permission — exactly the state (free, or permission
  // never granted) in which this is usually called.
  if (await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK)) {
    try {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    } catch (error) {
      // Permission was withdrawn since registering: Location refuses to stop
      // it, but the OS has stopped delivering anyway. Drop the registration.
      console.warn('Stopping geofencing failed; unregistering the task:', error);
      await TaskManager.unregisterTaskAsync(GEOFENCE_TASK);
    }
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
