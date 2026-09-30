import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LibraryInputError,
  MAX_CATEGORY_NAME,
  MAX_NOTE_BODY,
  cleanCategoryName,
  cleanNote,
  searchTerm,
} from '../modules/library/libraryInput';

/** The Library: what the server accepts from the phone. */

describe('category names', () => {
  it('keeps a name as one tidy line', () => {
    assert.equal(cleanCategoryName('  Kandoo \n  Project '), 'Kandoo Project');
  });

  it('refuses a missing, blank or over-long name', () => {
    assert.throws(() => cleanCategoryName(undefined), LibraryInputError);
    assert.throws(() => cleanCategoryName('   '), LibraryInputError);
    assert.throws(() => cleanCategoryName('x'.repeat(MAX_CATEGORY_NAME + 1)), LibraryInputError);
  });
});

describe('notes', () => {
  it('keeps the body’s line breaks and makes the title optional', () => {
    assert.deepEqual(cleanNote({ body: ' First line\r\nSecond line \n' }), {
      title: null,
      body: 'First line\nSecond line',
    });
    assert.deepEqual(cleanNote({ title: '  Launch  plan ', body: 'Ship Friday.' }), {
      title: 'Launch plan',
      body: 'Ship Friday.',
    });
  });

  it('refuses an empty or over-long body', () => {
    assert.throws(() => cleanNote({ title: 'Only a title' }), LibraryInputError);
    assert.throws(() => cleanNote({ body: '   ' }), LibraryInputError);
    assert.throws(() => cleanNote({ body: 'x'.repeat(MAX_NOTE_BODY + 1) }), LibraryInputError);
  });
});

describe('search terms', () => {
  it('strips what would break or widen a PostgREST filter', () => {
    assert.equal(searchTerm('kandoo,title.eq.x'), 'kandoo title.eq.x');
    assert.equal(searchTerm('100% (done)'), '100 done');
    assert.equal(searchTerm('a_b*c\\d'), 'a b c d');
  });

  it('treats nothing useful as no filter', () => {
    assert.equal(searchTerm(undefined), null);
    assert.equal(searchTerm('  %%  '), null);
  });
});
