import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aggregateUsage, localDate, type UsageRows } from '../modules/insights/usageAggregate';

/** Insights: counts land on the user's own days, and nothing is double-counted. */

const empty: UsageRows = { captures: [], memories: [], reminders: [], libraryNotes: [], photos: [] };

describe('usage insights', () => {
  it('buckets by the user’s local day, not UTC', () => {
    // 23:30 UTC on the 29th is already the 30th in Lagos (UTC+1).
    assert.equal(localDate('2026-09-29T23:30:00Z', 'Africa/Lagos'), '2026-09-30');
    assert.equal(localDate('2026-09-29T23:30:00Z', 'Africa/Accra'), '2026-09-29');
  });

  it('builds one bar per day of the week, and counts captures by source', () => {
    const usage = aggregateUsage(
      {
        ...empty,
        captures: [
          { created_at: '2026-09-28T09:00:00Z', source: 'voice' },
          { created_at: '2026-09-28T10:00:00Z', source: 'photo' },
          { created_at: '2026-09-30T10:00:00Z', source: null },
        ],
      },
      { from: '2026-09-24T00:00:00Z', to: '2026-09-30T23:59:59Z', timeZone: 'Africa/Accra' }
    );
    assert.equal(usage.days.length, 7);
    assert.equal(usage.days.find((d) => d.date === '2026-09-28')?.captures, 2);
    assert.equal(usage.busiestDay, '2026-09-28');
    assert.deepEqual(usage.sources.map((s) => s.name).sort(), ['Photo', 'Typed', 'Voice']);
  });

  it('sorts reminders into done, missed, upcoming and awaiting review', () => {
    const now = Date.parse('2026-09-30T12:00:00Z');
    const r = (status: string, due_at: string | null) => ({ created_at: '2026-09-29T08:00:00Z', due_at, status, person: null });
    const usage = aggregateUsage(
      {
        ...empty,
        reminders: [
          r('fired', '2026-09-29T09:00:00Z'),
          r('dismissed', '2026-09-29T10:00:00Z'),
          r('confirmed', '2026-09-30T09:00:00Z'),
          r('confirmed', '2026-10-01T09:00:00Z'),
          r('pending', null),
        ],
      },
      { from: '2026-09-24T00:00:00Z', to: '2026-09-30T23:59:59Z', timeZone: 'Africa/Accra', now }
    );
    assert.deepEqual(usage.reminders, { done: 2, missed: 1, upcoming: 1, awaitingReview: 1, cancelled: 0 });
  });

  it('merges people regardless of case, keeping the first spelling', () => {
    const usage = aggregateUsage(
      {
        ...empty,
        memories: [
          { created_at: '2026-09-29T08:00:00Z', person: 'Jed', location: null },
          { created_at: '2026-09-29T09:00:00Z', person: 'jed', location: null },
        ],
      },
      { from: '2026-09-24T00:00:00Z', to: '2026-09-30T23:59:59Z', timeZone: 'Africa/Accra' }
    );
    assert.deepEqual(usage.people, [{ name: 'Jed', value: 2 }]);
  });
});
