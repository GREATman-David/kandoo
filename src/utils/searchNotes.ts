import type { CaptureNote } from '@/services/interpretationService';

/**
 * Instant, on-device search over the Memory list — separate from asking
 * Kandoo (which answers in words). Finds a capture by its title, its note, the
 * facts it holds or its reminders, so typing a note's name brings that card up.
 *
 * Words match by prefix, so "pott" finds "pottery" and "remind" finds
 * "reminder". Every typed word must appear somewhere in a card; if none does,
 * cards matching SOME of the words are shown instead, best first. A word found
 * in the title counts more than one found in the body.
 */

const MIN_WORD = 2;

function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).map((word) =>
    word.replace(/'s$/, '')
  );
}

function matches(haystack: string[], term: string): boolean {
  return haystack.some((word) => word.startsWith(term));
}

export function searchNotes(notes: CaptureNote[], query: string): CaptureNote[] {
  const terms = [...new Set(words(query))].filter((term) => term.length >= MIN_WORD);
  if (terms.length === 0) return notes;

  const scored = notes.map((note, index) => {
    const title = words(note.note?.title ?? note.memories[0]?.content ?? note.text);
    const body = words(
      [
        note.note?.body ?? '',
        note.text,
        ...note.memories.map((m) => m.content),
        ...note.reminders.map((r) => r.task),
        ...note.memories.flatMap((m) => [m.person ?? '', ...m.topics]),
      ].join(' ')
    );

    let hits = 0;
    let score = 0;
    for (const term of terms) {
      if (matches(title, term)) {
        hits++;
        score += 3;
      } else if (matches(body, term)) {
        hits++;
        score += 1;
      }
    }
    return { note, index, hits, score };
  });

  const all = scored.filter((s) => s.hits === terms.length);
  const pool = all.length > 0 ? all : scored.filter((s) => s.hits > 0);

  // Best score first; ties keep the list's own (newest-first) order.
  return pool
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((s) => s.note);
}
