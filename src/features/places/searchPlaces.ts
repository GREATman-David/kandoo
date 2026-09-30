import * as Location from 'expo-location';

import type { LatLng } from '@/utils/geo';

import { parseLocationQuery } from './locationCodes';

/**
 * Finding a place to draw. Photon (OpenStreetMap's search, run by Komoot) knows
 * landmarks by name — "University of Ghana", "Korle Bu" — and is free with no
 * key. Results are biased towards where the user is. If Photon can't be
 * reached, Android's own geocoder still resolves a plain address.
 *
 * Plus Codes and coordinates are resolved on the phone (locationCodes.ts) —
 * they work where there is no street address at all.
 *
 * Only the typed search text (and a rough position, for bias) leaves the phone.
 */

export type SearchResult = {
  id: string;
  name: string;
  /** "Legon, Accra" — enough to tell two results apart. */
  detail: string;
  center: LatLng;
  /** [west, south, east, north] when the result is an area (a campus, a park). */
  bounds: [number, number, number, number] | null;
  /** A real place name — worth suggesting as the place's name. */
  named: boolean;
};

const PHOTON_URL = 'https://photon.komoot.io/api/';
const TIMEOUT_MS = 8000;

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    city?: string;
    state?: string;
    country?: string;
    /** [minLon, maxLat, maxLon, minLat] */
    extent?: [number, number, number, number];
  };
};

function describe(p: PhotonFeature['properties']): string {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  return [street || null, p.district, p.city, p.city ? null : p.state, p.country]
    .filter((part, i, all): part is string => !!part && all.indexOf(part) === i && part !== p.name)
    .slice(0, 3)
    .join(', ');
}

async function photon(query: string, near: LatLng | null): Promise<SearchResult[]> {
  const params = [`q=${encodeURIComponent(query)}`, 'limit=8'];
  if (near) params.push(`lat=${near.lat.toFixed(3)}`, `lon=${near.lng.toFixed(3)}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${PHOTON_URL}?${params.join('&')}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Photon returned ${response.status}`);
    const data = (await response.json()) as { features?: PhotonFeature[] };

    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (const f of data.features ?? []) {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      const key = `${p.osm_type}${p.osm_id}` || `${lat},${lng}`;
      if (seen.has(key)) continue; // one OSM object can match twice (shop + amenity)
      seen.add(key);
      const e = p.extent;
      results.push({
        id: key,
        name: p.name ?? ([p.housenumber, p.street].filter(Boolean).join(' ') || 'Unnamed place'),
        detail: describe(p),
        center: { lat, lng },
        bounds: e ? [e[0], e[3], e[2], e[1]] : null,
        named: !!p.name,
      });
    }
    return results.slice(0, 6);
  } finally {
    clearTimeout(timer);
  }
}

async function androidGeocoder(query: string): Promise<SearchResult[]> {
  const hits = await Location.geocodeAsync(query);
  return hits.slice(0, 3).map((h, i) => ({
    id: `geocoder-${i}`,
    name: query,
    detail: '',
    center: { lat: h.latitude, lng: h.longitude },
    bounds: null,
    named: false,
  }));
}

/** Search for a place by name or address. Throws only if both sources fail. */
export async function searchPlaces(query: string, near: LatLng | null): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  // A Plus Code or coordinates: no network needed, and exact.
  const exact = parseLocationQuery(trimmed, near);
  if (exact) {
    return [{ id: `exact-${exact.label}`, name: exact.label, detail: 'Exact location', center: exact.center, bounds: null, named: false }];
  }

  try {
    return await photon(trimmed, near);
  } catch (error) {
    console.warn('Place search (Photon) failed; trying the device geocoder:', error);
    return androidGeocoder(trimmed);
  }
}
