/**
 * What the Library accepts from the phone. Pure functions, so the rules are
 * tested without a database; the limits mirror the checks in 011_library.sql.
 */

export const MAX_CATEGORY_NAME = 80;
export const MAX_NOTE_TITLE = 200;
export const MAX_NOTE_BODY = 20000;

export class LibraryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryInputError';
  }
}

/** Collapse runs of whitespace; a name is one line. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function cleanCategoryName(value: unknown): string {
  if (typeof value !== 'string') throw new LibraryInputError('Give the category a name.');
  const name = oneLine(value);
  if (!name) throw new LibraryInputError('Give the category a name.');
  if (name.length > MAX_CATEGORY_NAME) {
    throw new LibraryInputError(`Keep the name under ${MAX_CATEGORY_NAME} characters.`);
  }
  return name;
}

export type NoteInput = { title: string | null; body: string };

/**
 * A note needs words in its body; the title is optional. Line breaks in the
 * body are kept — a note is written, not a single line.
 */
export function cleanNote(value: { title?: unknown; body?: unknown }): NoteInput {
  const title =
    typeof value.title === 'string' && oneLine(value.title) ? oneLine(value.title) : null;
  if (title && title.length > MAX_NOTE_TITLE) {
    throw new LibraryInputError(`Keep the title under ${MAX_NOTE_TITLE} characters.`);
  }
  const body = typeof value.body === 'string' ? value.body.replace(/\r\n/g, '\n').trim() : '';
  if (!body) throw new LibraryInputError('Write something in the note first.');
  if (body.length > MAX_NOTE_BODY) {
    throw new LibraryInputError('That note is too long to keep in one piece. Split it in two.');
  }
  return { title, body };
}

/**
 * A search term safe to put inside a PostgREST `ilike` filter: the
 * characters that filter syntax treats specially (`,` `(` `)` `%` `_` `*`
 * and `\`) are removed rather than escaped, since a person searching their
 * notes never means them literally. Empty means "no filter".
 */
export function searchTerm(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = oneLine(value.replace(/[,()%_*\\]/g, ' ')).slice(0, 100);
  return cleaned || null;
}
