import { supabase } from '../../services/supabase';

import type { KandooNote } from '../ai/interpretationSchema';

export type CaptureInput = {
  text: string;
  clientTime: string;
  timezone: string;
  source?: 'text' | 'voice' | 'manual';
  transcriptConfidence?: number | null;
};

export type Capture = {
  id: string;
  text: string;
  client_time: string | null;
  timezone: string | null;
  source: string | null;
  created_at: string;
};

/**
 * The raw utterance, stored verbatim and never overwritten.
 *
 * Previously /interpret discarded this entirely, which meant (a) the extraction
 * prompt could never be re-run over past input, and (b) "what did I actually
 * say?" could only be answered with the model's paraphrase. For a memory
 * product that is the wrong thing to lose.
 */
/**
 * A manual capture already saved with this exact text at this exact device
 * time — the same entry sent twice. The phone saves notes and memories
 * locally first and syncs them later (src/services/outbox.ts); if a sync
 * reached the server but its reply was lost, the retry must not duplicate it.
 */
export async function findManualCapture(
  userId: string,
  clientTime: string,
  text: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('captures')
    .select('id')
    .eq('user_id', userId)
    .eq('source', 'manual')
    .eq('client_time', clientTime)
    .eq('text', text.trim())
    .limit(1);

  if (error) {
    // Not fatal: without the check the save still happens, at worst twice.
    console.error('Duplicate check for a manual capture failed:', error);
    return null;
  }
  return (data?.[0]?.id as string | undefined) ?? null;
}

export async function createCapture(
  userId: string,
  input: CaptureInput
): Promise<Capture> {
  const text = input.text.trim();
  if (!text) {
    throw new Error('Capture text cannot be empty.');
  }

  const { data, error } = await supabase
    .from('captures')
    .insert({
      user_id: userId,
      text,
      client_time: input.clientTime,
      timezone: input.timezone,
      source: input.source ?? 'text',
      transcript_conf: input.transcriptConfidence ?? null,
    })
    .select('id, text, client_time, timezone, source, created_at')
    .single();

  if (error) {
    console.error('Database capture error:', error);
    throw new Error('Failed to save capture.');
  }

  return data as Capture;
}

/**
 * Attach the cleaned-up note to its capture. Best-effort: extraction and the
 * actions have already succeeded by the time this runs, so a note write failing
 * (or the column not existing yet) must never fail the whole /interpret call.
 * The caller logs; the capture keeps its verbatim text regardless.
 */
export async function attachNote(
  userId: string,
  captureId: string,
  note: KandooNote
): Promise<void> {
  const { error } = await supabase
    .from('captures')
    .update({ note })
    .eq('user_id', userId)
    .eq('id', captureId);

  if (error) {
    // Don't throw — see above. A missing `note` column (migration not applied)
    // lands here too, which is the intended graceful degradation.
    console.error('Attaching note to capture failed:', error);
  }
}

export type CaptureNote = {
  id: string;
  text: string;
  note: KandooNote | null;
  source: string | null;
  created_at: string;
  memories: {
    id: string;
    content: string;
    person: string | null;
    location: string | null;
    topics: string[];
    created_at: string;
  }[];
  reminders: {
    id: string;
    task: string;
    person: string | null;
    due_at: string | null;
    place_hint: string | null;
    place_trigger?: 'arrive' | 'leave';
    not_before?: string | null;
    status: string;
    created_at: string;
  }[];
};

/**
 * The Memory screen: captures that carry a note, newest first, each with the
 * memories and reminders it produced (joined by capture_id). Two grouped
 * queries rather than N+1 per capture.
 */
export async function listCaptureNotes(
  userId: string,
  opts: {
    limit?: number;
    notedOnly?: boolean;
    requireContent?: boolean;
    /** Home ▸ Recently: anything that produced a note, memory OR reminder. */
    requireActions?: boolean;
    /** Cursor for "load more": only captures created before this ISO instant. */
    before?: string;
  } = {}
): Promise<CaptureNote[]> {
  const {
    limit = 30,
    notedOnly = true,
    requireContent = false,
    requireActions = false,
    before,
  } = opts;
  let query = supabase
    .from('captures')
    .select('id, text, note, source, created_at')
    .eq('user_id', userId);
  // Memory lists only captures that produced a note; Home ▸ Recently lists the
  // most recent captures whether or not they did (a one-line reminder has none).
  if (notedOnly) query = query.not('note', 'is', null);
  if (before) query = query.lt('created_at', before);

  // The Memory screen wants everything with substance — a note OR memories —
  // but not bare recall queries. requireContent can't be a SQL filter (it
  // depends on the memory join below), so over-fetch and filter after.
  const filtered = requireContent || requireActions;
  const fetchLimit = filtered ? Math.min(limit * 3, 150) : limit;

  const { data: captures, error } = await query
    .order('created_at', { ascending: false })
    .limit(fetchLimit);

  if (error) {
    console.error('Listing capture notes failed:', error);
    throw new Error('Failed to load notes.');
  }

  const rows = (captures ?? []) as {
    id: string;
    text: string;
    note: KandooNote | null;
    source: string | null;
    created_at: string;
  }[];
  if (rows.length === 0) return [];

  const captureIds = rows.map((c) => c.id);

  const [memoriesRes, remindersRes] = await Promise.all([
    supabase
      .from('memories')
      .select('id, capture_id, content, person, location, topics, created_at')
      .eq('user_id', userId)
      .in('capture_id', captureIds),
    supabase
      .from('reminders')
      .select('id, capture_id, task, person, due_at, place_hint, place_trigger, not_before, status, created_at')
      .eq('user_id', userId)
      .in('capture_id', captureIds),
  ]);

  if (memoriesRes.error) console.error('Note memories query failed:', memoriesRes.error);
  if (remindersRes.error) console.error('Note reminders query failed:', remindersRes.error);

  const byCaptureMemories = new Map<string, CaptureNote['memories']>();
  for (const m of memoriesRes.data ?? []) {
    const list = byCaptureMemories.get(m.capture_id as string) ?? [];
    list.push({
      id: m.id as string,
      content: m.content as string,
      person: (m.person as string | null) ?? null,
      location: (m.location as string | null) ?? null,
      topics: (m.topics as string[]) ?? [],
      created_at: m.created_at as string,
    });
    byCaptureMemories.set(m.capture_id as string, list);
  }

  const byCaptureReminders = new Map<string, CaptureNote['reminders']>();
  for (const r of remindersRes.data ?? []) {
    const list = byCaptureReminders.get(r.capture_id as string) ?? [];
    list.push({
      id: r.id as string,
      task: r.task as string,
      person: (r.person as string | null) ?? null,
      due_at: (r.due_at as string | null) ?? null,
      place_hint: (r.place_hint as string | null) ?? null,
      place_trigger: r.place_trigger === 'leave' ? 'leave' : 'arrive',
      not_before: (r.not_before as string | null) ?? null,
      status: r.status as string,
      created_at: r.created_at as string,
    });
    byCaptureReminders.set(r.capture_id as string, list);
  }

  const mapped = rows.map((c) => ({
    id: c.id,
    text: c.text,
    note: c.note,
    source: c.source,
    created_at: c.created_at,
    memories: byCaptureMemories.get(c.id) ?? [],
    reminders: byCaptureReminders.get(c.id) ?? [],
  }));

  // Memory: keep only captures with a note or at least one memory (drop bare
  // recall queries), then re-apply the caller's limit after the over-fetch.
  if (requireContent) {
    return mapped
      .filter((c) => c.note !== null || c.memories.length > 0)
      .slice(0, limit);
  }
  // Recently: a question or an unparseable remark produced nothing to show, so
  // it would only clutter the list as "Saved what you said". Reminder-only
  // captures stay — unlike the Memory screen, Recently is about everything kept.
  if (requireActions) {
    return mapped
      .filter(
        (c) => c.note !== null || c.memories.length > 0 || c.reminders.length > 0
      )
      .slice(0, limit);
  }
  return mapped;
}

/** One capture with everything it produced — for the note-detail screen. */
export async function getCaptureNote(
  userId: string,
  captureId: string
): Promise<CaptureNote | null> {
  const { data: capture, error } = await supabase
    .from('captures')
    .select('id, text, note, source, created_at')
    .eq('user_id', userId)
    .eq('id', captureId)
    .maybeSingle();

  if (error) {
    console.error('Get capture failed:', error);
    throw new Error('Failed to load that note.');
  }
  if (!capture) return null;

  const [memoriesRes, remindersRes] = await Promise.all([
    supabase
      .from('memories')
      .select('id, content, person, location, topics, created_at')
      .eq('user_id', userId)
      .eq('capture_id', captureId),
    supabase
      .from('reminders')
      .select('id, task, person, due_at, place_hint, place_trigger, not_before, status, created_at')
      .eq('user_id', userId)
      .eq('capture_id', captureId),
  ]);

  if (memoriesRes.error) console.error('Capture memories query failed:', memoriesRes.error);
  if (remindersRes.error) console.error('Capture reminders query failed:', remindersRes.error);

  return {
    id: capture.id as string,
    text: capture.text as string,
    note: (capture.note as CaptureNote['note']) ?? null,
    source: (capture.source as string | null) ?? null,
    created_at: capture.created_at as string,
    memories: (memoriesRes.data ?? []) as CaptureNote['memories'],
    reminders: (remindersRes.data ?? []) as CaptureNote['reminders'],
  };
}

/**
 * Edit a capture's note (title + body only). Unlike attachNote — which is
 * best-effort during /interpret — an explicit edit must report failure, and it
 * filters on user_id so a client can only ever touch its own capture. The
 * memories the note was extracted into are deliberately untouched: editing the
 * summary must not silently rewrite what Kandoo understood.
 */
export async function updateCaptureNote(
  userId: string,
  captureId: string,
  note: KandooNote
): Promise<void> {
  const { data, error } = await supabase
    .from('captures')
    .update({ note })
    .eq('user_id', userId)
    .eq('id', captureId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Update capture note failed:', error);
    throw new Error('Failed to update that note.');
  }
  if (!data) throw new Error('Note not found.');
}

/**
 * Delete a capture and the memories it produced — the "whole item" a Memory row
 * stands for. Reminders are detached (capture_id → null) rather than deleted:
 * they own local notifications and their own lifecycle, so a note being removed
 * must not silently cancel a reminder the user still relies on. Ordering the
 * child writes first keeps this correct whether the FK cascades or restricts.
 */
export async function deleteCapture(
  userId: string,
  captureId: string
): Promise<void> {
  // Detach reminders so they survive and no FK is violated on delete.
  const { error: detachError } = await supabase
    .from('reminders')
    .update({ capture_id: null })
    .eq('user_id', userId)
    .eq('capture_id', captureId);
  if (detachError) {
    console.error('Detaching reminders from capture failed:', detachError);
    throw new Error('Failed to delete that note.');
  }

  // Remove the memories extracted from this capture (their entity links cascade).
  const { error: memError } = await supabase
    .from('memories')
    .delete()
    .eq('user_id', userId)
    .eq('capture_id', captureId);
  if (memError) {
    console.error('Deleting capture memories failed:', memError);
    throw new Error('Failed to delete that note.');
  }

  const { error } = await supabase
    .from('captures')
    .delete()
    .eq('user_id', userId)
    .eq('id', captureId);
  if (error) {
    console.error('Delete capture failed:', error);
    throw new Error('Failed to delete that note.');
  }
}
