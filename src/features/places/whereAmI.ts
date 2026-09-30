import * as Location from 'expo-location';

import { fetchPlaces, logFailure } from '@/services/interpretationService';
import { distanceM, isInPlace, type LatLng } from '@/utils/geo';

import { composeWhereAnswer, parseWhereQuestion, type WhereFacts } from './whereAmIText';

/**
 * Answer "where am I?" on the phone: a GPS fix, the user's drawn places (from
 * the saved copy — works offline), and the phone's own geocoder for a plain
 * area name. Returns null when the text isn't that kind of question, so the
 * caller sends it to Kandoo as usual.
 */

/** A fix this recent is good enough; otherwise wait this long for a new one. */
const FRESH_MS = 2 * 60 * 1000;
const FIX_TIMEOUT_MS = 10_000;
/** GPS accuracy counted in the user's favour at a place's edge, at most. */
const MAX_SLACK_M = 75;

async function position(): Promise<Location.LocationObject | null> {
  const last = await Location.getLastKnownPositionAsync({ maxAge: FRESH_MS }).catch(() => null);
  if (last) return last;
  const fresh = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS));
  return Promise.race([fresh, timeout]).catch(() => null);
}

async function areaName(point: LatLng): Promise<string | null> {
  try {
    const [hit] = await Location.reverseGeocodeAsync({ latitude: point.lat, longitude: point.lng });
    if (!hit) return null;
    const near = hit.district ?? hit.subregion ?? hit.street ?? hit.name;
    const town = hit.city ?? hit.region;
    return [near, town].filter((part, i, all): part is string => !!part && all.indexOf(part) === i).join(', ') || null;
  } catch (error) {
    // The answer still stands without an area name.
    console.warn('Reverse geocoding failed:', error);
    return null;
  }
}

export async function answerWhereAmI(text: string): Promise<string | null> {
  const question = parseWhereQuestion(text);
  if (!question) return null;

  const permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) {
    const asked = permission.canAskAgain ? await Location.requestForegroundPermissionsAsync() : permission;
    if (!asked.granted) {
      return 'Kandoo needs your location to answer that. You can allow it in the Places tab.';
    }
  }

  const fix = await position();
  if (!fix) return "I couldn't get a fix on where you are just now. Check that location is on and try again.";
  const here = { lat: fix.coords.latitude, lng: fix.coords.longitude };
  const slack = Math.min(fix.coords.accuracy ?? MAX_SLACK_M, MAX_SLACK_M);

  let places: Awaited<ReturnType<typeof fetchPlaces>> = [];
  try {
    places = await fetchPlaces();
  } catch (error) {
    logFailure('Loading places for "where am I" failed:', error);
  }
  const drawn = places.filter((p) => p.center && p.radiusM);

  const inside = drawn
    .filter((p) => isInPlace(here, { center: p.center!, radiusM: p.radiusM!, area: p.area }, slack))
    .sort((a, b) => a.radiusM! - b.radiusM!); // most specific first

  // "Am I at campus?" means the place "campus" is another name for.
  if (question.kind === 'at') {
    const alias = drawn.find((p) => p.aliases?.some((a) => a.toLowerCase() === question.place.toLowerCase()));
    if (alias) question.place = alias.name;
  }

  const nearest = inside.length
    ? null
    : drawn
        .map((p) => ({ name: p.name, distanceM: distanceM(here, p.center!) }))
        .sort((a, b) => a.distanceM - b.distanceM)[0] ?? null;

  const facts: WhereFacts = {
    inside: inside.map((p) => ({
      name: p.name,
      waitingCount: p.waitingCount,
      latestMemory: p.latestMemory?.content ?? null,
    })),
    nearest,
    area: inside.length ? null : await areaName(here),
  };
  return composeWhereAnswer(question, facts);
}
