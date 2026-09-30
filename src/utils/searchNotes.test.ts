import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CaptureNote } from '@/services/interpretationService';

import { searchNotes } from './searchNotes';

/** On-device Memory search: questions find the note they are about. */

const note = (id: string, title: string, body: string): CaptureNote =>
  ({
    id,
    text: body,
    note: { title, body },
    source: 'text',
    created_at: '2026-09-30T10:00:00Z',
    memories: [],
    reminders: [],
  }) as unknown as CaptureNote;

const NOTES = [
  note('passport', 'The passport is in the drawer', 'My passport is in the side bed drawer.'),
  note('window', 'The Window', 'Tomorrow’s speaking topic is titled The Window.'),
];

describe('searchNotes', () => {
  it('ignores question words, so a question finds the note it is about', () => {
    assert.deepEqual(searchNotes(NOTES, 'what is my speaking topic').map((n) => n.id), ['window']);
  });

  it('still searches filler words when the query has nothing else', () => {
    assert.deepEqual(searchNotes(NOTES, 'is').map((n) => n.id), ['passport', 'window']);
  });

  it('keeps prefix matching', () => {
    assert.deepEqual(searchNotes(NOTES, 'passp').map((n) => n.id), ['passport']);
  });
});
