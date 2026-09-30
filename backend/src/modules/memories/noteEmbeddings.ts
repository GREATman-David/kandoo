import { supabase } from '../../services/supabase';
import { aiProvider, withDeadline } from '../ai';

/**
 * Embeddings for the notes recall searches beside memories (012): the note
 * Kandoo wrote up on a capture, and the user's Library notes. Without one a
 * note is still found by its words, but not by its meaning — so every write
 * embeds, and anything that slipped through is backfilled the next time that
 * user asks something.
 */

/** gemini-embedding-001 reads ~2048 tokens; the words past this still match lexically. */
const MAX_EMBED_CHARS = 6000;
const EMBED_DEADLINE_MS = 8_000;

export function noteText(title: string | null | undefined, body: string): string {
  return `${title ? `${title}\n` : ''}${body}`.slice(0, MAX_EMBED_CHARS);
}

async function embedOne(text: string): Promise<number[]> {
  const [vector] = await withDeadline(aiProvider.embed([text], 'document'), EMBED_DEADLINE_MS, 'Note embedding');
  if (!vector) throw new Error('The embedding model returned no vector.');
  return vector;
}

/**
 * Best-effort: the note is already saved, so a failure here only delays its
 * semantic recall (the backfill retries). Returns false — and says why in the
 * log — rather than failing the save (AGENTS §3.7: report, don't swallow).
 */
export async function embedCaptureNote(
  userId: string,
  captureId: string,
  note: { title: string; body: string }
): Promise<boolean> {
  try {
    const embedding = await embedOne(noteText(note.title, note.body));
    const { error } = await supabase
      .from('captures')
      .update({ note_embedding: embedding })
      .eq('user_id', userId)
      .eq('id', captureId);
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Embedding a capture note failed (backfill will retry):', error);
    return false;
  }
}

export async function embedLibraryNote(
  userId: string,
  noteId: string,
  note: { title: string | null; body: string }
): Promise<boolean> {
  try {
    const embedding = await embedOne(noteText(note.title, note.body));
    const { error } = await supabase
      .from('library_notes')
      .update({ embedding })
      .eq('user_id', userId)
      .eq('id', noteId);
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Embedding a library note failed (backfill will retry):', error);
    return false;
  }
}

/** One backfill per user at a time, and at most once per cooldown. */
const BACKFILL_COOLDOWN_MS = 10 * 60 * 1000;
const lastBackfill = new Map<string, number>();

/**
 * Embed a small batch of this user's notes that have none yet (written before
 * 012, or whose embed failed). Called without awaiting from recall. Guarded so
 * a failing embedding model can never loop and burn the day's quota: one
 * attempt per user per cooldown, however many questions they ask.
 */
export async function backfillNoteEmbeddings(userId: string, batch = 20): Promise<number> {
  const last = lastBackfill.get(userId) ?? 0;
  if (Date.now() - last < BACKFILL_COOLDOWN_MS) return 0;
  lastBackfill.set(userId, Date.now());

  const [captures, library] = await Promise.all([
    supabase
      .from('captures')
      .select('id, note')
      .eq('user_id', userId)
      .not('note', 'is', null)
      .is('note_embedding', null)
      .limit(batch),
    supabase
      .from('library_notes')
      .select('id, title, body')
      .eq('user_id', userId)
      .is('embedding', null)
      .limit(batch),
  ]);
  // Before 012 runs these columns don't exist: nothing to do, and say so once.
  if (captures.error) throw new Error(`Note backfill (captures) failed: ${captures.error.message}`);
  if (library.error) throw new Error(`Note backfill (library) failed: ${library.error.message}`);

  const jobs = [
    ...(captures.data ?? [])
      .filter((c) => c.note && typeof c.note.body === 'string')
      .map((c) => ({ table: 'captures' as const, column: 'note_embedding', id: c.id as string, text: noteText(c.note.title, c.note.body) })),
    ...(library.data ?? []).map((n) => ({
      table: 'library_notes' as const,
      column: 'embedding',
      id: n.id as string,
      text: noteText(n.title as string | null, n.body as string),
    })),
  ].slice(0, batch);
  if (jobs.length === 0) return 0;

  const vectors = await withDeadline(
    aiProvider.embed(jobs.map((j) => j.text), 'document'),
    15_000,
    'Note backfill embedding'
  );
  const results = await Promise.all(
    jobs.map((job, i) =>
      supabase.from(job.table).update({ [job.column]: vectors[i] }).eq('user_id', userId).eq('id', job.id)
    )
  );
  // A silently failed write would leave the rows NULL for the next pass to
  // re-embed (the 2026 quota incident): fail loudly instead.
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(`Note backfill update failed: ${failed.error.message}`);
  return jobs.length;
}
