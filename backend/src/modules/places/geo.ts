/**
 * Place geometry — shared by the app and the backend.
 *
 * KEEP IDENTICAL to backend/src/modules/places/geo.ts. The backend deploys on
 * its own, so it cannot import this file; a backend test fails if the two copies
 * ever differ. Pure functions, no imports, so the copy is the whole story.
 *
 * A place's AREA is the shape the user traced, any shape, stored as
 * [[lat, lng], ...]. Android can only watch circles, so every area also has the
 * smallest circle that encloses it: the phone registers that circle as the
 * geofence, and on arrival checks whether it is truly inside the traced shape.
 */

export type LatLng = { lat: number; lng: number };
export type Circle = { center: LatLng; radiusM: number };

/** Below this, GPS noise is bigger than the place: it is treated as a circle. */
export const MIN_AREA_RADIUS_M = 60;
/** The smallest circle worth monitoring — Android is unreliable under ~100 m. */
export const MIN_RADIUS_M = 100;
/** A place, not a city. Bigger areas are refused rather than silently shrunk. */
export const MAX_RADIUS_M = 3000;
/** Most points kept from a traced shape; a finger trace yields hundreds. */
export const MAX_AREA_POINTS = 120;

const EARTH_RADIUS_M = 6_371_000;
const RAD = Math.PI / 180;

type XY = { x: number; y: number };

/** Local flat projection in metres around `origin` — exact enough at place scale. */
function project(origin: LatLng, p: LatLng): XY {
  return {
    x: (p.lng - origin.lng) * RAD * EARTH_RADIUS_M * Math.cos(origin.lat * RAD),
    y: (p.lat - origin.lat) * RAD * EARTH_RADIUS_M,
  };
}

function unproject(origin: LatLng, p: XY): LatLng {
  return {
    lat: origin.lat + p.y / (RAD * EARTH_RADIUS_M),
    lng: origin.lng + p.x / (RAD * EARTH_RADIUS_M * Math.cos(origin.lat * RAD)),
  };
}

/** Great-circle distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isLatLng(p: unknown): p is LatLng {
  if (!p || typeof p !== 'object') return false;
  const { lat, lng } = p as { lat?: unknown; lng?: unknown };
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

type XYCircle = { c: XY; r: number };

const EPSILON_M = 1e-6;
const inside = (k: XYCircle, p: XY) => Math.hypot(p.x - k.c.x, p.y - k.c.y) <= k.r + EPSILON_M;

function circleOf2(a: XY, b: XY): XYCircle {
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return { c, r: Math.hypot(a.x - c.x, a.y - c.y) };
}

function circleOf3(a: XY, b: XY, c: XY): XYCircle {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) {
    // Collinear: the circle on the two farthest points.
    const pairs = [circleOf2(a, b), circleOf2(a, c), circleOf2(b, c)];
    return pairs.reduce((best, k) => (k.r > best.r ? k : best));
  }
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const center = {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
  return { c: center, r: Math.hypot(a.x - center.x, a.y - center.y) };
}

/**
 * The smallest circle containing every point (Welzl, iterative form). Exact,
 * and at most MAX_AREA_POINTS points, so the worst case is still instant.
 */
export function enclosingCircle(points: LatLng[]): Circle {
  if (points.length === 0) throw new Error('An area needs at least one point.');
  const origin = points[0];
  const xy = points.map((p) => project(origin, p));

  let k: XYCircle = { c: xy[0], r: 0 };
  for (let i = 1; i < xy.length; i++) {
    if (inside(k, xy[i])) continue;
    k = { c: xy[i], r: 0 };
    for (let j = 0; j < i; j++) {
      if (inside(k, xy[j])) continue;
      k = circleOf2(xy[i], xy[j]);
      for (let m = 0; m < j; m++) {
        if (!inside(k, xy[m])) k = circleOf3(xy[i], xy[j], xy[m]);
      }
    }
  }

  return { center: unproject(origin, k.c), radiusM: k.r };
}

/** Even-odd point-in-polygon, in local metres. Works for any traced shape. */
export function pointInArea(point: LatLng, area: LatLng[]): boolean {
  if (area.length < 3) return false;
  const p = project(point, point);
  const poly = area.map((q) => project(point, q));
  let result = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      result = !result;
    }
  }
  return result;
}

/**
 * Whether a position is in a place: inside the traced shape when there is one,
 * otherwise inside the circle. `slackM` widens both by the fix's own accuracy,
 * so a person standing at the edge of the shape isn't missed by GPS jitter.
 */
export function isInPlace(
  point: LatLng,
  place: { center: LatLng; radiusM: number; area: LatLng[] | null },
  slackM = 0
): boolean {
  if (distanceM(point, place.center) > place.radiusM + slackM) return false;
  if (!place.area) return true;
  if (pointInArea(point, place.area)) return true;
  if (slackM <= 0) return false;
  // Near the edge of the shape: accept if any edge is within the slack.
  return distanceToAreaEdgeM(point, place.area) <= slackM;
}

function distanceToAreaEdgeM(point: LatLng, area: LatLng[]): number {
  const poly = area.map((q) => project(point, q));
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return best;
}

/**
 * Clean a traced shape: valid points only, near-duplicates dropped, thinned to
 * MAX_AREA_POINTS. Returns null when fewer than 3 distinct points remain.
 */
export function normalizeArea(raw: unknown): LatLng[] | null {
  if (!Array.isArray(raw)) return null;
  const points: LatLng[] = [];
  for (const item of raw) {
    const p = Array.isArray(item) ? { lat: item[0], lng: item[1] } : item;
    if (!isLatLng(p)) return null;
    const last = points[points.length - 1];
    if (!last || distanceM(last, p) >= 2) points.push({ lat: p.lat, lng: p.lng });
  }
  if (points.length > 1 && distanceM(points[0], points[points.length - 1]) < 2) {
    points.pop(); // the loop closed on itself
  }
  if (points.length < 3) return null;
  if (points.length <= MAX_AREA_POINTS) return points;
  const step = points.length / MAX_AREA_POINTS;
  return Array.from({ length: MAX_AREA_POINTS }, (_, i) => points[Math.floor(i * step)]);
}

export type PlaceGeometry = { center: LatLng; radiusM: number; area: LatLng[] | null };

/**
 * Turn what the user drew into what is stored and monitored. Either a traced
 * shape (`area`) or a plain circle (`center` + `radiusM`). Returns an error
 * string for anything that cannot be a place, so the caller can say why.
 */
export function placeGeometry(input: {
  area?: unknown;
  center?: unknown;
  radiusM?: unknown;
}): PlaceGeometry | { error: string } {
  if (input.area !== undefined && input.area !== null) {
    const area = normalizeArea(input.area);
    if (!area) return { error: 'That shape needs at least three points.' };
    const circle = enclosingCircle(area);
    if (circle.radiusM > MAX_RADIUS_M) {
      return { error: 'That area is too big. Draw around one place.' };
    }
    if (circle.radiusM < MIN_AREA_RADIUS_M) {
      // Too small to tell apart from GPS noise: keep its centre as a circle.
      return { center: circle.center, radiusM: MIN_RADIUS_M, area: null };
    }
    return { center: circle.center, radiusM: Math.max(circle.radiusM, MIN_RADIUS_M), area };
  }

  if (!isLatLng(input.center)) return { error: 'A place needs a location.' };
  const radius = typeof input.radiusM === 'number' && Number.isFinite(input.radiusM)
    ? input.radiusM
    : MIN_RADIUS_M;
  if (radius > MAX_RADIUS_M) return { error: 'That area is too big. Draw around one place.' };
  return {
    center: { lat: input.center.lat, lng: input.center.lng },
    radiusM: Math.max(radius, MIN_RADIUS_M),
    area: null,
  };
}

/** Area of a traced shape in square metres (shoelace, local projection). */
export function areaSquareM(area: LatLng[]): number {
  if (area.length < 3) return 0;
  const poly = area.map((q) => project(area[0], q));
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    sum += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(sum) / 2;
}

/** Most circles one place may use — 15 watched places × 6 stays under Android's 100. */
export const MAX_COVER_CIRCLES = 6;
/** A shape filling this much of its enclosing circle is watched as that one circle. */
const ROUND_ENOUGH = 0.6;

/**
 * The circles the phone actually watches for a place. Android watches circles
 * only; one enclosing circle would fire in the empty corner of an L-shaped
 * campus. So an irregular shape is covered by up to MAX_COVER_CIRCLES smaller
 * circles centred inside the shape — every point of the shape is inside one of
 * them, and none reaches more than one circle-radius beyond its edge. A shape
 * that is roughly round, or too small to split, stays one circle.
 *
 * No background GPS, no foreground service: the OS does all the watching, and
 * entering ANY of a place's circles is arriving at the place.
 */
export function coverCircles(place: PlaceGeometry): Circle[] {
  const whole: Circle = { center: place.center, radiusM: place.radiusM };
  const area = place.area;
  if (!area) return [whole];

  const fill = areaSquareM(area) / (Math.PI * place.radiusM * place.radiusM);
  if (fill >= ROUND_ENOUGH) return [whole];

  const origin = place.center;
  const poly = area.map((q) => project(origin, q));
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const shape = poly.map((p) => unproject(origin, p));

  // Points that must be covered: every vertex, edge midpoints, and a fine
  // interior grid — enough to catch any gap between circles.
  const samples: XY[] = [...poly];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    samples.push({ x: (poly[i].x + poly[j].x) / 2, y: (poly[i].y + poly[j].y) / 2 });
  }
  const step = Math.max(10, Math.max(maxX - minX, maxY - minY) / 20);
  for (let x = minX; x <= maxX; x += step) {
    for (let y = minY; y <= maxY; y += step) {
      if (pointInArea(unproject(origin, { x, y }), shape)) samples.push({ x, y });
    }
  }

  // Candidate centres: points INSIDE the shape only, so no circle reaches more
  // than one radius past the edge the user drew.
  const candidates = samples.filter((s, i) => i >= poly.length * 2 || pointInArea(unproject(origin, s), shape));

  for (let r = MIN_RADIUS_M; r < place.radiusM; r *= 1.2) {
    // Greedy set cover: take the centre covering the most still-uncovered
    // points, until everything is covered or the budget is spent.
    let uncovered = samples;
    const centers: XY[] = [];
    while (uncovered.length > 0 && centers.length < MAX_COVER_CIRCLES) {
      let best: XY | null = null;
      let bestCount = 0;
      for (const c of candidates) {
        let count = 0;
        for (const s of uncovered) if (Math.hypot(s.x - c.x, s.y - c.y) <= r) count++;
        if (count > bestCount) {
          best = c;
          bestCount = count;
        }
      }
      if (!best) break;
      const chosen = best;
      centers.push(chosen);
      uncovered = uncovered.filter((s) => Math.hypot(s.x - chosen.x, s.y - chosen.y) > r);
    }
    if (uncovered.length === 0) {
      return centers.map((c) => ({ center: unproject(origin, c), radiusM: r }));
    }
  }

  return [whole];
}

/** Stored form of an area: compact [[lat, lng], ...], 6 decimals (~10 cm). */
export function areaToRows(area: LatLng[] | null): [number, number][] | null {
  return area
    ? area.map((p) => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6])
    : null;
}

export function areaFromRows(rows: unknown): LatLng[] | null {
  return normalizeArea(rows);
}
