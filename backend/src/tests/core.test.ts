import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NextFunction, Request, Response } from 'express';

import { aiRateLimit } from '../middleware/rateLimit';
import { kandooInterpretationSchema } from '../modules/ai/interpretationSchema';
import { resolveTimezone } from '../utils/timezone';

/**
 * Fast, offline checks for the rules the demo depends on. No database, no
 * model, no network: `npm test` runs in a second on a fresh clone.
 */

describe('interpretation contract (v2: one utterance → many actions)', () => {
  // Test B1's expected shape: two memories and two reminders in ONE response.
  const b1 = {
    summary: 'Meeting with Jed: migration moved, budget cut, two follow-ups.',
    confidence: 'high',
    note: null,
    actions: [
      {
        kind: 'memory',
        content: 'Jed is pushing the API migration to Q1 because of the vendor issue.',
        people: ['Jed'],
        placeHint: null,
        topics: ['API migration'],
      },
      {
        kind: 'memory',
        content: 'The budget was cut by fifteen percent.',
        people: [],
        placeHint: null,
        topics: ['budget'],
      },
      {
        kind: 'reminder',
        task: 'Send Michael the spec',
        dueAt: '2026-09-28T17:00:00+01:00',
        placeHint: null,
        people: ['Michael'],
        insistent: false,
      },
      {
        kind: 'reminder',
        task: 'Book the review room',
        dueAt: '2026-09-29T09:00:00+01:00',
        placeHint: null,
        people: [],
        insistent: false,
      },
    ],
  };

  it('accepts a multi-action capture', () => {
    const parsed = kandooInterpretationSchema.parse(b1);
    assert.equal(parsed.actions.filter((a) => a.kind === 'memory').length, 2);
    assert.equal(parsed.actions.filter((a) => a.kind === 'reminder').length, 2);
  });

  it('rejects the retired single-intent (v1) shape', () => {
    const v1 = { intent: 'reminder', task: 'Book the room', dueAt: null };
    assert.equal(kandooInterpretationSchema.safeParse(v1).success, false);
  });

  it('rejects a due time without a timezone offset', () => {
    const noOffset = structuredClone(b1);
    (noOffset.actions[2] as { dueAt: string }).dueAt = '2026-09-28T17:00:00';
    assert.equal(kandooInterpretationSchema.safeParse(noOffset).success, false);
  });

  it('rejects fields the contract does not define', () => {
    const extra = { ...b1, intent: 'reminder' };
    assert.equal(kandooInterpretationSchema.safeParse(extra).success, false);
  });
});

describe('resolveTimezone', () => {
  it('keeps a real IANA zone', () => {
    assert.equal(resolveTimezone('Africa/Accra'), 'Africa/Accra');
  });

  it('falls back to UTC for anything else', () => {
    assert.equal(resolveTimezone('Not/AZone'), 'UTC');
    assert.equal(resolveTimezone(''), 'UTC');
    assert.equal(resolveTimezone(42), 'UTC');
    assert.equal(resolveTimezone('x'.repeat(100)), 'UTC');
  });
});

describe('aiRateLimit', () => {
  function call(userId: string): { status: number | null; passed: boolean } {
    let status: number | null = null;
    let passed = false;
    const req = { user: { id: userId } } as unknown as Request;
    const res = {
      setHeader: () => res,
      status(code: number) {
        status = code;
        return res;
      },
      json: () => res,
    } as unknown as Response;
    const next: NextFunction = () => {
      passed = true;
    };
    aiRateLimit(req, res, next);
    return { status, passed };
  }

  it('lets a person through and stops a burst with 429', () => {
    const user = `test-${Date.now()}`;
    for (let i = 0; i < 12; i++) {
      assert.equal(call(user).passed, true, `request ${i + 1} should pass`);
    }
    const blocked = call(user);
    assert.equal(blocked.passed, false);
    assert.equal(blocked.status, 429);
  });

  it('counts each user separately', () => {
    const a = `a-${Date.now()}`;
    const b = `b-${Date.now()}`;
    for (let i = 0; i < 12; i++) call(a);
    assert.equal(call(b).passed, true);
  });
});
