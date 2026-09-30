import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatDuration, monthWindow, nextRecapTime, previousMonth, timeByPlace } from './monthRecap';

const H = 60 * 60 * 1000;

describe('monthly recap', () => {
  it('uses the local calendar month', () => {
    const sept = monthWindow(new Date(2026, 8, 17, 15, 0));
    assert.equal(sept.key, '2026-09');
    assert.equal(sept.label, 'September');
    assert.equal(sept.from.getDate(), 1);
    assert.equal(sept.to.getMonth(), 9);
    assert.equal(previousMonth(new Date(2026, 0, 3)).key, '2025-12');
    const at = nextRecapTime(new Date(2026, 8, 30, 23, 0));
    assert.deepEqual([at.getMonth(), at.getDate(), at.getHours()], [9, 1, 10]);
  });

  it('adds up time and visits per place, longest first', () => {
    const { from, to } = monthWindow(new Date(2026, 8, 10));
    const d = (day: number, hour: number) => new Date(2026, 8, day, hour).getTime();
    const rows = timeByPlace(
      {
        school: [{ a: d(2, 8), l: d(2, 14) }, { a: d(3, 8), l: d(3, 12) }],
        gym: [{ a: d(4, 18), l: d(4, 19) }],
      },
      { school: 'School', gym: 'Gym' },
      from,
      to,
      d(20, 0)
    );
    assert.deepEqual(rows.map((r) => [r.name, r.visits, r.ms / H]), [
      ['School', 2, 10],
      ['Gym', 1, 1],
    ]);
  });

  it('counts only the part of a stay inside the month, and caps a missed exit', () => {
    const { from, to } = monthWindow(new Date(2026, 8, 10));
    const rows = timeByPlace(
      {
        // Arrived on 31 Aug 22:00, left 1 Sep 02:00: 2 h in September, not a visit in it.
        home: [{ a: new Date(2026, 7, 31, 22).getTime(), l: new Date(2026, 8, 1, 2).getTime() }],
        // Never recorded leaving: capped, not a whole month.
        gym: [{ a: new Date(2026, 8, 5, 18).getTime(), l: null }],
      },
      { home: 'Home', gym: 'Gym' },
      from,
      to,
      new Date(2026, 8, 25).getTime()
    );
    const home = rows.find((r) => r.id === 'home')!;
    assert.equal(home.ms / H, 2);
    assert.equal(home.visits, 0);
    assert.equal(rows.find((r) => r.id === 'gym')!.ms / H, 16);
  });

  it('says durations the way a person would', () => {
    assert.equal(formatDuration(20 * 60_000), '20 min');
    assert.equal(formatDuration(3 * H), '3 h');
    assert.equal(formatDuration(72 * H), '3 days');
  });
});
