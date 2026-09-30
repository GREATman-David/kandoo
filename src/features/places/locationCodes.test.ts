import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  decodePlusCode,
  encodePlusCode,
  parseLocationQuery,
  resolvePlusCode,
} from './locationCodes';

/** Finding places without an address: Plus Codes and coordinates. */

const close = (a: number, b: number, tolerance = 0.0002) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);

// A point on the University of Ghana campus.
const LEGON = { lat: 5.6508, lng: -0.187 };

describe('Plus Codes', () => {
  it('round-trips: encode then decode lands on the same spot', () => {
    const code = encodePlusCode(LEGON);
    assert.match(code, /^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2}$/);
    const back = decodePlusCode(code)!;
    close(back.lat, LEGON.lat);
    close(back.lng, LEGON.lng);
  });

  it('decodes a published code (Google’s reference: 8FVC9G8F+6X is Zurich)', () => {
    const zurich = decodePlusCode('8FVC9G8F+6X')!;
    close(zurich.lat, 47.365562, 0.0002);
    close(zurich.lng, 8.524813, 0.0002);
  });

  it('resolves a short code relative to where the user is', () => {
    const full = encodePlusCode(LEGON); // e.g. 6CQQ7FWR+8X
    const short = full.slice(4); // e.g. 7FWR+8X
    const nearAccra = { lat: 5.6037, lng: -0.187 };
    const point = resolvePlusCode(short, nearAccra)!;
    close(point.lat, LEGON.lat);
    close(point.lng, LEGON.lng);
  });

  it('needs a reference point for a short code', () => {
    assert.equal(resolvePlusCode('7FWR+CV', null), null);
  });
});

describe('search text that is a location', () => {
  it('reads coordinates copied from any maps app', () => {
    const parsed = parseLocationQuery('5.6508, -0.1870', null)!;
    close(parsed.center.lat, 5.6508);
    close(parsed.center.lng, -0.187);
    assert.ok(parseLocationQuery('5.6508 -0.1870', null));
  });

  it('reads a Plus Code, with or without a town after it', () => {
    const short = encodePlusCode(LEGON).slice(4);
    const parsed = parseLocationQuery(`${short} Accra`, { lat: 5.6, lng: -0.2 })!;
    close(parsed.center.lat, LEGON.lat);
  });

  it('leaves ordinary searches alone', () => {
    assert.equal(parseLocationQuery('University of Ghana', null), null);
    assert.equal(parseLocationQuery('Osu', null), null);
    assert.equal(parseLocationQuery('123, 456', null), null);
  });
});
