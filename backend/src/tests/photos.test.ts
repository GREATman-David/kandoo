import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withoutRecall } from '../modules/ai/geminiProvider';
import { photoInterpretationSchema } from '../modules/ai/interpretationSchema';
import { MAX_PHOTO_BYTES, PhotoInputError, decodeJpeg } from '../modules/photos/photoInput';

/** Show Kandoo: what the server accepts from the phone and from the model. */

const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('decodeJpeg', () => {
  it('accepts a JPEG', () => {
    assert.deepEqual(decodeJpeg(JPEG_HEAD.toString('base64')), JPEG_HEAD);
  });

  it('refuses anything that is not a JPEG (e.g. a PNG)', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString('base64');
    assert.throws(() => decodeJpeg(png), PhotoInputError);
  });

  it('refuses a missing or empty photo', () => {
    assert.throws(() => decodeJpeg(undefined), PhotoInputError);
    assert.throws(() => decodeJpeg(''), PhotoInputError);
  });

  it('refuses a photo over the limit before decoding it', () => {
    const huge = 'A'.repeat(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 100);
    assert.throws(() => decodeJpeg(huge), /too large/);
  });
});

describe('photo interpretation', () => {
  const base = {
    summary: 'Outreach on Saturday.',
    confidence: 'high' as const,
    note: null,
    description: 'Flyer for the outreach',
  };

  it('requires the one-line description', () => {
    const { description: _omit, ...rest } = base;
    assert.equal(photoInterpretationSchema.safeParse({ ...rest, actions: [] }).success, false);
    assert.equal(photoInterpretationSchema.safeParse({ ...base, actions: [] }).success, true);
  });

  it('never keeps a recall from a photo — it was shown, not asked', () => {
    const parsed = photoInterpretationSchema.parse({
      ...base,
      actions: [
        { kind: 'recall', query: 'outreach', scopePerson: null, scopePlace: null },
        { kind: 'memory', content: 'Bring 50 exercise books.', people: [], placeHint: null, topics: [] },
      ],
    });
    const kept = withoutRecall(parsed);
    assert.deepEqual(kept.actions.map((a) => a.kind), ['memory']);
  });
});
