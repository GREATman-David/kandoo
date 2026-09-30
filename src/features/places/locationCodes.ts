import type { LatLng } from '@/utils/geo';

/**
 * Finding a place with no street address. Much of the world — including most
 * of Africa — has no usable address for a home or a compound, so search also
 * understands two things that work everywhere:
 *
 *   - Plus Codes (Open Location Code, open and free): "7FWR+CV", or the full
 *     "6CQQ7FWR+CV". A short code is resolved near the map / the user.
 *   - Raw coordinates: "5.6508, -0.1870" (as copied from any maps app).
 *
 * Pure functions, tested in locationCodes.test.ts.
 */

const ALPHABET = '23456789CFGHJMPQRVWX';
/** Degrees per digit for each of the first five digit pairs. */
const PAIR_RESOLUTIONS = [20, 1, 0.05, 0.0025, 0.000125];
const GRID_ROWS = 5;
const GRID_COLS = 4;
const SEPARATOR_POSITION = 8;

const CODE_PATTERN = /(?:^|\s)([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,7})(?=\s|,|$)/i;
const COORDS_PATTERN = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

function digit(c: string): number {
  return ALPHABET.indexOf(c.toUpperCase());
}

/** Encode to a 10-digit code — used to supply the prefix of a short code. */
export function encodePlusCode(point: LatLng): string {
  let lat = Math.min(Math.max(point.lat, -90), 90 - 1e-9) + 90;
  let lng = ((((point.lng + 180) % 360) + 360) % 360);
  let code = '';
  for (const res of PAIR_RESOLUTIONS) {
    const la = Math.floor(lat / res);
    const lo = Math.floor(lng / res);
    lat -= la * res;
    lng -= lo * res;
    code += ALPHABET[la] + ALPHABET[lo];
    if (code.length === SEPARATOR_POSITION) code += '+';
  }
  return code;
}

/** Centre of a FULL code (8 digits before the '+'), or null if invalid. */
export function decodePlusCode(code: string): LatLng | null {
  const clean = code.toUpperCase().replace('+', '').replace(/0+$/, '');
  if (clean.length < 2 || [...clean].some((c) => digit(c) < 0)) return null;

  let lat = -90;
  let lng = -180;
  let latSize = 0;
  let lngSize = 0;
  const pairs = Math.min(clean.length, 10);
  for (let i = 0; i + 1 < pairs; i += 2) {
    const res = PAIR_RESOLUTIONS[i / 2];
    lat += digit(clean[i]) * res;
    lng += digit(clean[i + 1]) * res;
    latSize = lngSize = res;
  }
  for (let i = 10; i < clean.length; i++) {
    const d = digit(clean[i]);
    latSize /= GRID_ROWS;
    lngSize /= GRID_COLS;
    lat += Math.floor(d / GRID_COLS) * latSize;
    lng += (d % GRID_COLS) * lngSize;
  }
  return { lat: lat + latSize / 2, lng: lng + lngSize / 2 };
}

/**
 * Resolve a code — full or short — to a point. A short code ("7FWR+CV") only
 * means something near a reference point; Google's recoverNearest rule picks
 * the matching cell closest to it.
 */
export function resolvePlusCode(code: string, near: LatLng | null): LatLng | null {
  const upper = code.toUpperCase();
  const sep = upper.indexOf('+');
  if (sep < 0 || sep > SEPARATOR_POSITION || sep % 2 === 1) return null;
  if (sep === SEPARATOR_POSITION) return decodePlusCode(upper);
  if (!near) return null;

  const padding = SEPARATOR_POSITION - sep;
  const resolution = Math.pow(20, 2 - padding / 2);
  const half = resolution / 2;
  const center = decodePlusCode(encodePlusCode(near).slice(0, padding) + upper);
  if (!center) return null;

  let { lat, lng } = center;
  if (near.lat + half < lat && lat - resolution >= -90) lat -= resolution;
  else if (near.lat - half > lat && lat + resolution <= 90) lat += resolution;
  if (near.lng + half < lng) lng -= resolution;
  else if (near.lng - half > lng) lng += resolution;
  return { lat, lng };
}

export type ParsedLocation = { center: LatLng; label: string };

/** A Plus Code or coordinates typed into search, or null for anything else. */
export function parseLocationQuery(query: string, near: LatLng | null): ParsedLocation | null {
  const coords = COORDS_PATTERN.exec(query);
  if (coords) {
    const lat = Number(coords[1]);
    const lng = Number(coords[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { center: { lat, lng }, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
    }
  }

  const match = CODE_PATTERN.exec(query.trim());
  if (match) {
    const point = resolvePlusCode(match[1], near);
    if (point) return { center: point, label: match[1].toUpperCase() };
  }
  return null;
}
