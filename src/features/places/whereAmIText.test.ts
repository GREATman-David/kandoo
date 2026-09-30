import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { composeWhereAnswer, formatDistance, parseWhereQuestion } from './whereAmIText';

describe('"where am I?" questions', () => {
  it('recognises the ways people ask', () => {
    for (const q of ['Where am I?', 'where am i now', 'What place is this?', "What's here?", 'where are we', 'Show my location']) {
      assert.deepEqual(parseWhereQuestion(q), { kind: 'where' }, q);
    }
    assert.deepEqual(parseWhereQuestion('Am I at school?'), { kind: 'at', place: 'school' });
    assert.deepEqual(parseWhereQuestion('am I in the library'), { kind: 'at', place: 'library' });
  });

  it('leaves everything else to Kandoo', () => {
    for (const q of ['Where did I leave my keys?', 'Remind me to call Ama when I get to school', 'Where should I get lunch?']) {
      assert.equal(parseWhereQuestion(q), null, q);
    }
  });
});

describe('the answer', () => {
  const balme = { name: 'Balme', waitingCount: 1, latestMemory: 'Kofi said the maths test moved to Friday.' };
  const school = { name: 'School', waitingCount: 2, latestMemory: null };

  it('names the most specific place, what waits there, and the last memory', () => {
    assert.equal(
      composeWhereAnswer({ kind: 'where' }, { inside: [balme, school], nearest: null, area: null }),
      "You're at Balme, inside School. 1 thing is waiting for you here. Last time: Kofi said the maths test moved to Friday."
    );
  });

  it('says where you are in plain words when you are at none of your places', () => {
    assert.equal(
      composeWhereAnswer({ kind: 'where' }, { inside: [], nearest: { name: 'School', distanceM: 1234 }, area: 'East Legon, Accra' }),
      "You're around East Legon, Accra — not at any of your places. School is about 1.2 km away."
    );
  });

  it('answers "am I at …?" directly', () => {
    assert.equal(composeWhereAnswer({ kind: 'at', place: 'school' }, { inside: [balme, school], nearest: null, area: null }), "Yes — you're at School.");
    assert.equal(composeWhereAnswer({ kind: 'at', place: 'the gym' }, { inside: [balme], nearest: null, area: null }), "No — you're at Balme, not the gym.");
  });

  it('rounds distances the way a person would', () => {
    assert.equal(formatDistance(12), 'about 50 m');
    assert.equal(formatDistance(320), 'about 300 m');
    assert.equal(formatDistance(15_400), 'about 15 km');
  });
});
