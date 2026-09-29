import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { reminderActionSchema } from '../modules/ai/interpretationSchema';
import {
  MAX_COVER_CIRCLES,
  MIN_RADIUS_M,
  coverCircles,
  distanceM,
  enclosingCircle,
  isInPlace,
  normalizeArea,
  placeGeometry,
  pointInArea,
  type LatLng,
} from '../modules/places/geo';

/** Offline checks for Places: no database, no model, no network. */

// A point `north`/`east` metres from an origin (flat approximation, fine at this scale).
const ORIGIN: LatLng = { lat: 5.6037, lng: -0.187 }; // Accra
function offset(north: number, east: number, from: LatLng = ORIGIN): LatLng {
  return {
    lat: from.lat + north / 111_320,
    lng: from.lng + east / (111_320 * Math.cos((from.lat * Math.PI) / 180)),
  };
}

// An L-shaped campus: 400 m wide along the bottom, 400 m tall up the left side,
// arms 100 m thick. Its enclosing circle covers the empty top-right corner.
const L_SHAPE: LatLng[] = [
  offset(0, 0),
  offset(0, 400),
  offset(100, 400),
  offset(100, 100),
  offset(400, 100),
  offset(400, 0),
];

describe('place geometry', () => {
  it('encloses every point of a traced shape in the smallest circle', () => {
    const circle = enclosingCircle(L_SHAPE);
    for (const p of L_SHAPE) {
      assert.ok(distanceM(circle.center, p) <= circle.radiusM + 0.5);
    }
    // The L's bounding square is 400 m, so the tight circle is ~283 m (half the diagonal).
    assert.ok(Math.abs(circle.radiusM - 282.8) < 3, `radius ${circle.radiusM}`);
  });

  it('honours an irregular shape: the empty corner of the L is not inside', () => {
    const place = { ...enclosingCircle(L_SHAPE), area: L_SHAPE };
    const inTheArm = offset(50, 250);
    const emptyCorner = offset(300, 300);

    assert.equal(pointInArea(inTheArm, L_SHAPE), true);
    assert.equal(pointInArea(emptyCorner, L_SHAPE), false);
    // The corner IS inside the geofence circle — which is exactly why the phone
    // checks the shape on arrival instead of trusting the circle.
    assert.ok(distanceM(emptyCorner, place.center) < place.radiusM);
    assert.equal(isInPlace(emptyCorner, place), false);
    assert.equal(isInPlace(inTheArm, place), true);
  });

  it('gives a point just outside the edge the benefit of GPS accuracy', () => {
    const place = { ...enclosingCircle(L_SHAPE), area: L_SHAPE };
    const justOutside = offset(-10, 200); // 10 m below the bottom edge
    assert.equal(isInPlace(justOutside, place), false);
    assert.equal(isInPlace(justOutside, place, 25), true);
  });

  it('covers an irregular shape with a few circles that skip its empty corner', () => {
    const drawn = placeGeometry({ area: L_SHAPE.map((p) => [p.lat, p.lng]) });
    assert.ok(!('error' in drawn));
    const circles = coverCircles(drawn);
    assert.ok(circles.length > 1 && circles.length <= MAX_COVER_CIRCLES, `${circles.length} circles`);

    const inAny = (p: LatLng) => circles.some((c) => distanceM(p, c.center) <= c.radiusM + 0.5);
    // Every part of the L is watched…
    for (let n = 0; n <= 400; n += 25) {
      assert.ok(inAny(offset(50, n)), `bottom arm at ${n} m`);
      assert.ok(inAny(offset(n, 50)), `left arm at ${n} m`);
    }
    // …and the empty corner is not.
    assert.equal(inAny(offset(330, 330)), false);
  });

  it('watches a round shape, or a plain circle, as one circle', () => {
    const ring: [number, number][] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * 2 * Math.PI;
      const p = offset(250 * Math.sin(a), 250 * Math.cos(a));
      ring.push([p.lat, p.lng]);
    }
    const round = placeGeometry({ area: ring });
    assert.ok(!('error' in round));
    assert.equal(coverCircles(round).length, 1);
    assert.equal(coverCircles({ center: ORIGIN, radiusM: 150, area: null }).length, 1);
  });

  it('cleans a finger trace: drops duplicates, closes the loop, caps the points', () => {
    const trace: [number, number][] = [];
    for (let i = 0; i < 1000; i++) {
      const a = (i / 1000) * 2 * Math.PI;
      const p = offset(200 * Math.sin(a), 200 * Math.cos(a));
      trace.push([p.lat, p.lng], [p.lat, p.lng]); // every point twice
    }
    const area = normalizeArea(trace);
    assert.ok(area);
    assert.ok(area.length <= 120);
    assert.ok(area.length >= 3);
  });

  it('rejects junk rather than storing it', () => {
    assert.equal(normalizeArea([[5.6, -0.18], [5.61, 'x']]), null);
    assert.equal(normalizeArea([[5.6, -0.18], [5.6, -0.18]]), null);
    assert.equal(normalizeArea([[200, 0], [0, 0], [1, 1]]), null);
    assert.equal(normalizeArea('not an array'), null);
  });

  it('turns a drawing into what is stored and monitored', () => {
    const drawn = placeGeometry({ area: L_SHAPE.map((p) => [p.lat, p.lng]) });
    assert.ok(!('error' in drawn));
    assert.ok(drawn.area && drawn.area.length === 6);

    // A tiny scribble is smaller than GPS noise: it becomes a minimum circle.
    const scribble = placeGeometry({
      area: [offset(0, 0), offset(0, 10), offset(10, 10)],
    });
    assert.ok(!('error' in scribble));
    assert.equal(scribble.area, null);
    assert.equal(scribble.radiusM, MIN_RADIUS_M);

    // A plain circle is floored at the minimum Android watches reliably.
    const small = placeGeometry({ center: ORIGIN, radiusM: 20 });
    assert.ok(!('error' in small));
    assert.equal(small.radiusM, MIN_RADIUS_M);

    // A city is not a place.
    const huge = placeGeometry({ area: [offset(0, 0), offset(0, 9000), offset(9000, 0)] });
    assert.ok('error' in huge);
    assert.ok('error' in placeGeometry({ center: { lat: 999, lng: 0 } }));
  });
});

describe('place reminders in the contract', () => {
  it('still accepts a reminder written before places existed', () => {
    const parsed = reminderActionSchema.parse({
      kind: 'reminder',
      task: 'Send Michael the spec',
      dueAt: '2026-09-28T17:00:00+01:00',
      placeHint: null,
      people: ['Michael'],
      insistent: false,
    });
    assert.equal(parsed.placeTrigger, 'arrive');
    assert.equal(parsed.notBefore, null);
  });

  it('carries "when I get to school tomorrow" as a place + a day, not a time', () => {
    const parsed = reminderActionSchema.parse({
      kind: 'reminder',
      task: 'Give John his calculator',
      dueAt: null,
      placeHint: 'school',
      placeTrigger: 'arrive',
      notBefore: '2026-09-30T00:00:00+00:00',
      people: ['John'],
      insistent: false,
    });
    assert.equal(parsed.dueAt, null);
    assert.equal(parsed.placeHint, 'school');
    assert.equal(parsed.notBefore, '2026-09-30T00:00:00+00:00');
  });

  it('refuses a notBefore that is not an absolute instant', () => {
    assert.throws(() =>
      reminderActionSchema.parse({
        kind: 'reminder',
        task: 'x',
        dueAt: null,
        placeHint: 'school',
        notBefore: 'tomorrow',
        people: [],
        insistent: false,
      })
    );
  });
});

describe('one geometry, two copies', () => {
  it('backend geo.ts is identical to the app’s src/utils/geo.ts', (t) => {
    const appCopy = join(__dirname, '../../../src/utils/geo.ts');
    // The backend deploys alone (no app files); only check where both exist.
    if (!existsSync(appCopy)) return t.skip('app source not present');
    const backendCopy = join(__dirname, '../modules/places/geo.ts');
    const normalize = (s: string) => s.replace(/\r\n/g, '\n');
    assert.equal(
      normalize(readFileSync(backendCopy, 'utf8')),
      normalize(readFileSync(appCopy, 'utf8')),
      'Edit src/utils/geo.ts, then copy it to backend/src/modules/places/geo.ts.'
    );
  });
});
