import { supabase } from '../../services/supabase';

import type { KandooNote } from '../ai/interpretationSchema';

export type CaptureInput = {
  text: string;
  clientTime: string;
  timezone: string;
  source?: 'text' | 'voice';
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
  captureId: string,
  note: KandooNote
): Promise<void> {
  const { error } = await supabase
    .from('captures')
    .update({ note })
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
  limit = 30
): Promise<CaptureNote[]> {
  const { data: captures, error } = await supabase
    .from('captures')
    .select('id, text, note, created_at')
    .eq('user_id', userId)
    .not('note', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Listing capture notes failed:', error);
    throw new Error('Failed to load notes.');
  }

  const rows = (captures ?? []) as {
    id: string;
    text: string;
    note: KandooNote | null;
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
      .select('id, capture_id, task, person, due_at, place_hint, status, created_at')
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
      status: r.status as string,
      created_at: r.created_at as string,
    });
    byCaptureReminders.set(r.capture_id as string, list);
  }

  return rows.map((c) => ({
    id: c.id,
    text: c.text,
    note: c.note,
    created_at: c.created_at,
    memories: byCaptureMemories.get(c.id) ?? [],
    reminders: byCaptureReminders.get(c.id) ?? [],
  }));
}
