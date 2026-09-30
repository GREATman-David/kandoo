import { supabase } from '../../services/supabase';

import { embedLibraryNote } from '../memories/noteEmbeddings';

import { LibraryInputError, type NoteInput } from './libraryInput';

/**
 * The Library: categories the user names, each holding notes. Every query
 * filters `user_id` — the service role bypasses RLS, so that filter is the
 * only thing between one user's notes and another's (AGENTS §4).
 */

export type LibraryCategory = {
  id: string;
  name: string;
  noteCount: number;
  created_at: string;
  updated_at: string;
};

export type LibraryNote = {
  id: string;
  category_id: string;
  title: string | null;
  body: string;
  source: 'manual' | 'document';
  created_at: string;
  updated_at: string;
};

const NOTE_COLUMNS = 'id, category_id, title, body, source, created_at, updated_at';

/** Postgres unique_violation: a category with that name already exists. */
const UNIQUE_VIOLATION = '23505';

type CategoryRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  library_notes: { count: number }[] | null;
};

function presentCategory(row: CategoryRow): LibraryCategory {
  return {
    id: row.id,
    name: row.name,
    noteCount: row.library_notes?.[0]?.count ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const CATEGORY_COLUMNS = 'id, name, created_at, updated_at, library_notes(count)';

/** Every category, most recently touched first, optionally matching a name. */
export async function listCategories(
  userId: string,
  opts: { query?: string | null } = {}
): Promise<LibraryCategory[]> {
  let request = supabase
    .from('library_categories')
    .select(CATEGORY_COLUMNS)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (opts.query) request = request.ilike('name', `%${opts.query}%`);
  const { data, error } = await request;
  if (error) throw error;
  return ((data ?? []) as unknown as CategoryRow[]).map(presentCategory);
}

export async function getCategory(userId: string, id: string): Promise<LibraryCategory | null> {
  const { data, error } = await supabase
    .from('library_categories')
    .select(CATEGORY_COLUMNS)
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? presentCategory(data as unknown as CategoryRow) : null;
}

/** The category with this name (ignoring case), if the user has one. */
export async function findCategoryByName(
  userId: string,
  name: string
): Promise<LibraryCategory | null> {
  const { data, error } = await supabase
    .from('library_categories')
    .select(CATEGORY_COLUMNS)
    .eq('user_id', userId)
    .ilike('name', name.replace(/[%_\\]/g, (c) => `\\${c}`))
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as unknown as CategoryRow | undefined;
  return row ? presentCategory(row) : null;
}

export class DuplicateCategoryError extends LibraryInputError {
  constructor(name: string) {
    super(`You already have a category called “${name}”.`);
    this.name = 'DuplicateCategoryError';
  }
}

export async function createCategory(userId: string, name: string): Promise<LibraryCategory> {
  const { data, error } = await supabase
    .from('library_categories')
    .insert({ user_id: userId, name })
    .select('id, name, created_at, updated_at')
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new DuplicateCategoryError(name);
    throw error;
  }
  return { ...data, noteCount: 0 };
}

/** Rename. Returns null when the category isn't the user's. */
export async function renameCategory(
  userId: string,
  id: string,
  name: string
): Promise<LibraryCategory | null> {
  const { data, error } = await supabase
    .from('library_categories')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new DuplicateCategoryError(name);
    throw error;
  }
  return data ? getCategory(userId, id) : null;
}

/** Delete a category and (by cascade) its notes. False when not the user's. */
export async function deleteCategory(userId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('library_categories')
    .delete()
    .eq('user_id', userId)
    .eq('id', id)
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** A category is "touched" when a note in it changes, so it rises to the top. */
async function touchCategory(userId: string, categoryId: string): Promise<void> {
  const { error } = await supabase
    .from('library_categories')
    .update({ updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', categoryId);
  // Only ordering depends on this: report it, never fail the note for it.
  if (error) console.error('Touching a library category failed:', error);
}

export async function listNotes(
  userId: string,
  categoryId: string,
  opts: { query?: string | null } = {}
): Promise<LibraryNote[]> {
  let request = supabase
    .from('library_notes')
    .select(NOTE_COLUMNS)
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .order('updated_at', { ascending: false })
    .limit(500);
  if (opts.query) {
    request = request.or(`title.ilike.%${opts.query}%,body.ilike.%${opts.query}%`);
  }
  const { data, error } = await request;
  if (error) throw error;
  return (data ?? []) as LibraryNote[];
}

/** Add a note to one of the user's categories. Null when the category isn't theirs. */
export async function createNote(
  userId: string,
  categoryId: string,
  note: NoteInput,
  source: LibraryNote['source'] = 'manual'
): Promise<LibraryNote | null> {
  const category = await getCategory(userId, categoryId);
  if (!category) return null;
  const { data, error } = await supabase
    .from('library_notes')
    .insert({ user_id: userId, category_id: categoryId, title: note.title, body: note.body, source })
    .select(NOTE_COLUMNS)
    .single();
  if (error) throw error;
  await touchCategory(userId, categoryId);
  // Recall reaches the Library by meaning too (012). In the background: it
  // logs its own failure and the recall backfill retries.
  void embedLibraryNote(userId, (data as LibraryNote).id, note);
  return data as LibraryNote;
}

/**
 * Edit a note, and optionally move it to another of the user's categories.
 * Null when the note (or the destination) isn't theirs.
 */
export async function updateNote(
  userId: string,
  id: string,
  note: NoteInput,
  moveTo?: string | null
): Promise<LibraryNote | null> {
  if (moveTo && !(await getCategory(userId, moveTo))) return null;
  const changes: Record<string, unknown> = {
    title: note.title,
    body: note.body,
    updated_at: new Date().toISOString(),
  };
  if (moveTo) changes.category_id = moveTo;
  const { data, error } = await supabase
    .from('library_notes')
    .update(changes)
    .eq('user_id', userId)
    .eq('id', id)
    .select(NOTE_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  await touchCategory(userId, (data as LibraryNote).category_id);
  void embedLibraryNote(userId, id, note);
  return data as LibraryNote;
}

export async function deleteNote(userId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('library_notes')
    .delete()
    .eq('user_id', userId)
    .eq('id', id)
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}
