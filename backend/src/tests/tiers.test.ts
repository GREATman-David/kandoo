import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { tierAtLeast } from '../modules/entitlements/entitlementService';

describe('plan order', () => {
  it('each plan includes everything below it', () => {
    assert.equal(tierAtLeast('elite', 'pro'), true);
    assert.equal(tierAtLeast('pro', 'personal'), true);
    assert.equal(tierAtLeast('personal', 'personal'), true);
  });

  it('Personal has no work tools and Pro cannot lead a team', () => {
    assert.equal(tierAtLeast('personal', 'pro'), false);
    assert.equal(tierAtLeast('pro', 'elite'), false);
    assert.equal(tierAtLeast('free', 'personal'), false);
  });
});
