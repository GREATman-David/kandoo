import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { noteParagraphs } from '../modules/teams/docxExport';
import {
  MAX_FILE_BYTES,
  TeamInputError,
  cleanTeamName,
  decodeUpload,
  newInviteCode,
  normaliseInviteCode,
  safeFileName,
} from '../modules/teams/teamInput';

/** Teams: what the server accepts, and notes turned into Word documents. */

describe('invite codes', () => {
  it('are 8 characters with no look-alikes, and survive being typed loosely', () => {
    for (let i = 0; i < 50; i++) {
      const code = newInviteCode();
      assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/);
    }
    assert.equal(normaliseInviteCode(' abcd-2345 '), 'ABCD2345');
    assert.equal(normaliseInviteCode('short'), null);
  });
});

describe('team input', () => {
  it('needs a team name', () => {
    assert.throws(() => cleanTeamName('  '), TeamInputError);
    assert.equal(cleanTeamName('  Grace   Foundation '), 'Grace Foundation');
  });

  it('accepts documents it can handle and refuses the rest', () => {
    const pdf = decodeUpload(Buffer.from('%PDF-1.7').toString('base64'), 'application/pdf');
    assert.equal(pdf.ext, 'pdf');
    assert.throws(() => decodeUpload('AAAA', 'application/x-msdownload'), TeamInputError);
    assert.throws(() => decodeUpload('A'.repeat(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 100), 'application/pdf'), /15 MB/);
  });

  it('makes file names safe for storage and downloads', () => {
    assert.equal(safeFileName('../../Budget 2026 (final).PDF', 'pdf'), 'Budget 2026 (final).pdf');
    assert.equal(safeFileName('<script>', 'txt'), 'script.txt');
  });
});

describe('Word export', () => {
  it('turns headings, bullets and references into Word paragraphs', () => {
    const paragraphs = noteParagraphs('Key points:\n• Freemium works [1].\n\nReferences:\n[1] Freemium — Wikipedia. https://en.wikipedia.org/wiki/Freemium');
    assert.equal(paragraphs.length, 4);
  });
});
