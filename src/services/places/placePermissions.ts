import * as Location from 'expo-location';

/**
 * Places need "Allow all the time": a geofence has to fire with Kandoo closed.
 * Android grants it in two steps — while-in-use first, then (Android 11+) a
 * trip to Settings for "all the time". The UI explains why BEFORE calling
 * `requestPlacePermission`; the system dialogs alone don't say what it's for.
 */

export type PlacePermission =
  /** "All the time": places work. */
  | 'granted'
  /** Only while using the app: the map works, arrivals do not. */
  | 'foreground-only'
  /** Refused, and Android won't ask again — only Settings can change it. */
  | 'blocked'
  /** Not asked yet, or refused but askable again. */
  | 'undetermined';

export async function getPlacePermission(): Promise<PlacePermission> {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) {
    return foreground.canAskAgain ? 'undetermined' : 'blocked';
  }
  const background = await Location.getBackgroundPermissionsAsync();
  return background.granted ? 'granted' : 'foreground-only';
}

/** Ask for while-in-use, then all-the-time. Resolves to where it ended up. */
export async function requestPlacePermission(): Promise<PlacePermission> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) {
    return foreground.canAskAgain ? 'undetermined' : 'blocked';
  }
  const background = await Location.requestBackgroundPermissionsAsync();
  return background.granted ? 'granted' : 'foreground-only';
}

/** While-in-use only — enough for the map and "use my location". */
export async function requestMapPermission(): Promise<boolean> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  return foreground.granted;
}
