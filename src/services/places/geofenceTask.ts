import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { handleGeofenceEvent } from './placeEngine';
import { GEOFENCE_TASK } from './placeStore';

/**
 * The geofence task. TaskManager requires it to be defined at the top level of
 * the bundle, before any screen mounts: Android can start Kandoo headless — no
 * UI, app closed, after a reboot — just to run it. That is why the app entry
 * (index.ts) imports this file before expo-router.
 */

type GeofenceData = {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
};

TaskManager.defineTask<GeofenceData>(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Geofence task error:', error.message);
    return;
  }
  const regionId = data?.region?.identifier;
  if (!regionId) return;

  const event = data.eventType === Location.GeofencingEventType.Enter ? 'enter' : 'exit';
  try {
    await handleGeofenceEvent(event, regionId);
  } catch (handlerError) {
    console.error('Place event failed:', handlerError);
  }
});
