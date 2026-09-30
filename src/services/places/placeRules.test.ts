import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_MOMENTS_PER_DAY,
  MOMENT_AFTER_MS,
  MOMENT_COOLDOWN_MS,
  STARRED_MOMENT_AFTER_MS,
  applyGeofenceEvent,
  localDay,
  placesInside,
} from './placeRules';
import type { ArmedReminder, PlaceState, WatchedPlace } from './placeStore';

/**
 * The arrival rules, run with no phone: `npm test` at the repo root.
 * Every case here is a way a real place reminder could misfire.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-30T08:00:00Z');

function place(id: string, name: string, circles = 1, memoryDaysAgo: number | null = null): WatchedPlace {
  return {
    id,
    name,
    center: { lat: 5.6, lng: -0.18 },
    radiusM: 150,
    area: null,
    latestMemory:
      memoryDaysAgo === null
        ? null
        : { content: 'John still has your calculator.', created_at: new Date(NOW - memoryDaysAgo * DAY).toISOString() },
    regions: Array.from({ length: circles }, (_, i) => `${id}:${i}`),
  };
}

function reminder(id: string, placeId: string, extra: Partial<ArmedReminder> = {}): ArmedReminder {
  return { id, task: 'Give John his calculator', person: 'John', placeId, trigger: 'arrive', notBefore: null, insistent: false, ...extra };
}

function state(places: WatchedPlace[], reminders: ArmedReminder[] = []): PlaceState {
  return {
    places: Object.fromEntries(places.map((p) => [p.id, p])),
    reminders,
    regionInside: {},
    settleUntil: 0,
    registeredKey: 'k',
    delivered: {},
    lastArrived: {},
    lastMoment: {},
    registeredAt: 0,
    servicesWereOff: false,
    pending: {},
    visits: {},
    names: {},
    momentDay: { day: '', count: 0 },
    lastSync: null,
  };
}

describe('place arrival rules', () => {
  it('fires a place reminder on arrival, once', () => {
    const s = state([place('school', 'School')], [reminder('r1', 'school')]);
    const first = applyGeofenceEvent(s, 'enter', 'school:0', NOW);
    assert.equal(first.kind, 'arrive');
    assert.deepEqual(first.kind === 'arrive' && first.reminders.map((r) => r.id), ['r1']);

    s.delivered.r1 = NOW; // the engine marks it once shown
    applyGeofenceEvent(s, 'exit', 'school:0', NOW + 1000);
    const again = applyGeofenceEvent(s, 'enter', 'school:0', NOW + 2000);
    assert.equal(again.kind === 'arrive' && again.reminders.length, 0);
  });

  it('does not fire "when I get home" for someone already at home when watching starts', () => {
    const s = state([place('home', 'Home')], [reminder('r1', 'home')]);
    s.settleUntil = NOW + 120_000; // just registered
    const burst = applyGeofenceEvent(s, 'enter', 'home:0', NOW);
    assert.deepEqual(burst, { kind: 'ignored', why: 'settled' });

    // Leaving and coming back is a real arrival.
    applyGeofenceEvent(s, 'exit', 'home:0', NOW + 600_000);
    const back = applyGeofenceEvent(s, 'enter', 'home:0', NOW + 900_000);
    assert.equal(back.kind === 'arrive' && back.reminders.length, 1);
  });

  it('still fires for a region first heard from after the settle window', () => {
    const s = state([place('gym', 'Gym')], [reminder('r1', 'gym')]);
    s.settleUntil = NOW - 1;
    const out = applyGeofenceEvent(s, 'enter', 'gym:0', NOW);
    assert.equal(out.kind, 'arrive');
  });

  it('holds "when I get to school tomorrow" until tomorrow', () => {
    const tomorrow = new Date(NOW + DAY).toISOString();
    const s = state([place('school', 'School')], [reminder('r1', 'school', { notBefore: tomorrow })]);

    const today = applyGeofenceEvent(s, 'enter', 'school:0', NOW);
    assert.equal(today.kind === 'arrive' && today.reminders.length, 0);
    applyGeofenceEvent(s, 'exit', 'school:0', NOW + 3600_000);

    const next = applyGeofenceEvent(s, 'enter', 'school:0', NOW + DAY + 3600_000);
    assert.deepEqual(next.kind === 'arrive' && next.reminders.map((r) => r.id), ['r1']);
  });

  it('treats a shape covered by several circles as one place', () => {
    const s = state([place('campus', 'Campus', 3)], [
      reminder('arrive1', 'campus'),
      reminder('leave1', 'campus', { trigger: 'leave', task: 'Lock the lab' }),
    ]);
    assert.equal(applyGeofenceEvent(s, 'enter', 'campus:0', NOW).kind, 'arrive');
    s.delivered.arrive1 = NOW;
    // Walking across the campus: into the next circle, out of the first.
    assert.equal(applyGeofenceEvent(s, 'enter', 'campus:1', NOW + 60_000).kind, 'ignored');
    assert.equal(applyGeofenceEvent(s, 'exit', 'campus:0', NOW + 120_000).kind, 'ignored');
    // Out of the last circle: that is leaving.
    const left = applyGeofenceEvent(s, 'exit', 'campus:1', NOW + 180_000);
    assert.equal(left.kind, 'leave');
    assert.deepEqual(left.kind === 'leave' && left.reminders.map((r) => r.id), ['leave1']);
  });

  it('ignores regions it is not watching', () => {
    const s = state([place('home', 'Home')]);
    assert.deepEqual(applyGeofenceEvent(s, 'enter', 'elsewhere:0', NOW), { kind: 'ignored', why: 'unknown-region' });
    assert.deepEqual(applyGeofenceEvent(s, 'enter', 'home:7', NOW), { kind: 'ignored', why: 'unknown-region' });
  });
});

describe('Kandoo Moments', () => {
  it('hands back the last memory when you return after a long while', () => {
    const s = state([place('clinic', 'the clinic', 1, 30)]);
    const out = applyGeofenceEvent(s, 'enter', 'clinic:0', NOW);
    assert.equal(out.kind, 'arrive');
    assert.equal(out.kind === 'arrive' && out.moment?.title, 'Back at the clinic');
    assert.match((out.kind === 'arrive' && out.moment?.body) || '', /calculator/);
  });

  it('stays quiet for a place you were at recently', () => {
    const s = state([place('clinic', 'the clinic', 1, 30)]);
    s.lastArrived.clinic = NOW - 3 * DAY;
    const out = applyGeofenceEvent(s, 'enter', 'clinic:0', NOW);
    assert.equal(out.kind === 'arrive' && out.moment, null);
  });

  it('stays quiet when the memory itself is recent', () => {
    const s = state([place('clinic', 'the clinic', 1, 2)]);
    const out = applyGeofenceEvent(s, 'enter', 'clinic:0', NOW);
    assert.equal(out.kind === 'arrive' && out.moment, null);
  });

  it('shows at most one Moment per place in the cooldown', () => {
    const s = state([place('clinic', 'the clinic', 1, 30)]);
    s.lastMoment.clinic = NOW - (MOMENT_COOLDOWN_MS - 60_000);
    s.lastArrived.clinic = NOW - MOMENT_AFTER_MS - DAY;
    const out = applyGeofenceEvent(s, 'enter', 'clinic:0', NOW);
    assert.equal(out.kind === 'arrive' && out.moment, null);
  });

  it('never shows a Moment for a place with nothing said there', () => {
    const s = state([place('mall', 'the mall')]);
    const out = applyGeofenceEvent(s, 'enter', 'mall:0', NOW);
    assert.equal(out.kind === 'arrive' && out.moment, null);
  });
});

describe('passing through is not arriving', () => {
  it('cancels what arrival scheduled when you leave inside the dwell (a drive-by)', () => {
    const s = state([place('school', 'School')], [reminder('r1', 'school')]);
    applyGeofenceEvent(s, 'enter', 'school:0', NOW);
    // The engine marks it delivered and records the pending notice.
    s.delivered.r1 = NOW;
    s.pending.school = [{ notificationId: 'n1', fireAt: NOW + 60_000, reminderId: 'r1', moment: null }];

    const left = applyGeofenceEvent(s, 'exit', 'school:0', NOW + 30_000);
    assert.equal(left.kind, 'leave');
    assert.deepEqual(left.kind === 'leave' && left.cancel.map((c) => c.notificationId), ['n1']);
    // Not delivered after all: it will fire on the next real arrival.
    assert.equal(s.delivered.r1, undefined);
    const back = applyGeofenceEvent(s, 'enter', 'school:0', NOW + 3_600_000);
    assert.deepEqual(back.kind === 'arrive' && back.reminders.map((r) => r.id), ['r1']);
  });

  it('leaves alone what already showed when you leave after the dwell', () => {
    const s = state([place('school', 'School')], [reminder('r1', 'school')]);
    applyGeofenceEvent(s, 'enter', 'school:0', NOW);
    s.delivered.r1 = NOW;
    s.pending.school = [{ notificationId: 'n1', fireAt: NOW + 60_000, reminderId: 'r1', moment: null }];
    const left = applyGeofenceEvent(s, 'exit', 'school:0', NOW + 3_600_000);
    assert.equal(left.kind === 'leave' && left.cancel.length, 0);
    assert.equal(s.delivered.r1, NOW);
  });

  it('gives back the Moment allowance when a Moment is cancelled', () => {
    const s = state([place('clinic', 'the clinic', 1, 30)]);
    s.momentDay = { day: localDay(NOW), count: 1 };
    s.lastMoment.clinic = NOW;
    s.pending.clinic = [{ notificationId: 'm1', fireAt: NOW + 180_000, reminderId: null, moment: { prevLastMoment: null } }];
    s.regionInside['clinic:0'] = true;
    applyGeofenceEvent(s, 'exit', 'clinic:0', NOW + 10_000);
    assert.equal(s.momentDay.count, 0);
    assert.equal(s.lastMoment.clinic, undefined);
  });
});

describe('Moments stay rare and personal', () => {
  it('never shows more than the daily allowance across places', () => {
    const s = state([place('clinic', 'the clinic', 1, 30)]);
    s.momentDay = { day: localDay(NOW), count: MAX_MOMENTS_PER_DAY };
    const out = applyGeofenceEvent(s, 'enter', 'clinic:0', NOW);
    assert.equal(out.kind === 'arrive' && out.moment, null);
  });

  it('comes back sooner for a starred place', () => {
    const days = Math.round((STARRED_MOMENT_AFTER_MS + MOMENT_AFTER_MS) / 2 / DAY); // between 7 and 14
    const plain = state([place('gym', 'the gym', 1, days)]);
    const starred = state([{ ...place('gym', 'the gym', 1, days), starred: true }]);
    assert.equal((applyGeofenceEvent(plain, 'enter', 'gym:0', NOW) as { moment: unknown }).moment, null);
    assert.ok((applyGeofenceEvent(starred, 'enter', 'gym:0', NOW) as { moment: unknown }).moment);
  });
});

describe('the visit log (device-only, for the monthly recap)', () => {
  it('records each stay with when you arrived and left', () => {
    const s = state([place('home', 'Home')]);
    applyGeofenceEvent(s, 'enter', 'home:0', NOW);
    assert.deepEqual(placesInside(s).map((p) => p.id), ['home']);
    applyGeofenceEvent(s, 'exit', 'home:0', NOW + 7_200_000);
    assert.deepEqual(s.visits.home, [{ a: NOW, l: NOW + 7_200_000 }]);
    assert.deepEqual(placesInside(s), []);
  });

  it('counts where you already were when watching started as a stay', () => {
    const s = state([place('home', 'Home')]);
    s.settleUntil = NOW + 120_000;
    applyGeofenceEvent(s, 'enter', 'home:0', NOW);
    assert.equal(s.visits.home?.length, 1);
  });
});

