import { supabase } from '../../services/supabase';
import { aiProvider } from '../ai';
import {
  linkReminderToEntities,
  resolveEntities,
  resolveEntity,
} from '../entities/entityService';
import { normalizeReminderTime } from './timeNormalizer';

import type { ReminderAction } from '../ai/interpretationSchema';

export type ReminderStatus =
  | 'pending'
  | 'confirmed'
  | 'fired'
  | 'dismissed'
  | 'cancelled';

export type CreatedReminder = {
  id: string;
  task: string;
  person: string | null;
  due_at: string | null;
  place_hint: string | null;
  place_id: string | null;
  insistent: boolean;
  status: ReminderStatus;
  created_at: string;
  /** Present on the reminders-tab list; used to open the parent note. */
  capture_id?: string | null;
  /** Weekdays it repeats on (0 = Sunday … 6 = Saturday); null = once. */
  repeat_days?: number[] | null;
  /** Place reminders: fire on arriving (default) or leaving. */
  place_trigger?: PlaceTrigger;
  /** Place reminders: an arrival before this instant does not fire it. */
  not_before?: string | null;
};

export type PlaceTrigger = 'arrive' | 'leave';

/** Every column a reminder is returned with (migration 007 adds the last two). */
const REMINDER_BASE_COLUMNS =
  'id, task, person, due_at, place_hint, place_id, insistent, status, created_at, repeat_days, not_before, place_trigger';

/** A valid ISO instant, or null. Never lets a malformed value reach the DB. */
function safeInstant(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Reminders are created as `pending`. Nothing is scheduled until the device
 * confirms them through the review card. That boundary is the product: an
 * assistant that silently commits its own guesses to your day is one you stop
 * trusting the first time it is wrong.
 */
export async function createReminder(
  userId: string,
  captureId: string | null,
  action: ReminderAction,
  clientTime: string
): Promise<CreatedReminder> {
  const task = action.task.trim();
  if (!task) {
    throw new Error('Reminder task cannot be empty.');
  }

  // The model is instructed to return an absolute ISO instant. The normalizer
  // is now only a safety net for loose values like "4 PM".
  let dueAt: string | null = null;
  if (action.dueAt) {
    try {
      dueAt = normalizeReminderTime(action.dueAt, clientTime);
    } catch (error) {
      console.error('Time normalization failed:', error);
      dueAt = null;
    }
  }

  // A reminder anchored to neither a time nor a place can never fire.
  if (!dueAt && !action.placeHint) {
    throw new Error(
      'A reminder needs either a time or a place before it can be saved.'
    );
  }

  let placeId: string | null = null;
  if (action.placeHint) {
    const place = await resolveEntity(userId, 'place', action.placeHint);
    placeId = place?.id ?? null;
  }

  // Embed the task so a recall like "when did I say I'd call Mummy" can find
  // this reminder by meaning, not just keywords. 'document' — same task type as
  // memories, so both sides of match_context share one embedding space. A
  // failure must not lose the reminder: it saves without a vector and the
  // backfill fills it in later.
  let embedding: number[] | null = null;
  try {
    const [vector] = await aiProvider.embed([task], 'document');
    embedding = vector ?? null;
  } catch (error) {
    console.error('Embedding failed; saving reminder without vector:', error);
  }

  const { data, error } = await supabase
    .from('reminders')
    .insert({
      user_id: userId,
      capture_id: captureId,
      task,
      person: action.people[0] ?? null,
      due_at: dueAt,
      // Legacy column kept in sync until the old scheduler path is removed.
      reminder_time: dueAt,
      place_hint: action.placeHint,
      place_id: placeId,
      // Only meaningful for a place reminder (no time of its own). A timed
      // reminder that also names a place fires on its time, as before.
      place_trigger: !dueAt && action.placeHint ? action.placeTrigger : 'arrive',
      not_before: !dueAt && action.placeHint ? safeInstant(action.notBefore) : null,
      insistent: action.insistent,
      status: 'pending',
      embedding,
    })
    .select(
      REMINDER_BASE_COLUMNS
    )
    .single();

  if (error) {
    console.error('Database reminder error:', error);
    throw new Error('Failed to create reminder.');
  }

  const reminder = data as CreatedReminder;

  // Link the people the same way createMemory does, so a reminder shows under a
  // person's "What you promised" and moves across on a merge. Best-effort — a
  // linking failure must not fail the reminder write.
  try {
    const people = await resolveEntities(userId, 'person', action.people);
    await linkReminderToEntities(
      reminder.id,
      people.map((p) => p.id)
    );
  } catch (linkError) {
    console.error('Reminder entity linking failed:', linkError);
  }

  return reminder;
}

/**
 * One-off backfill for reminders created before they carried embeddings.
 * Mirrors backfillEmbeddings for memories; run from a script, not a handler.
 * Throws on a failed update rather than looping over the same rows forever.
 */
export async function backfillReminderEmbeddings(batchSize = 50): Promise<number> {
  const { data, error } = await supabase
    .from('reminders')
    .select('id, task')
    .is('embedding', null)
    .limit(batchSize);

  if (error) throw new Error(`Reminder backfill query failed: ${error.message}`);
  if (!data || data.length === 0) return 0;

  const vectors = await aiProvider.embed(
    data.map((row) => row.task as string),
    'document'
  );

  const results = await Promise.all(
    data.map((row, index) =>
      supabase
        .from('reminders')
        .update({ embedding: vectors[index] })
        .eq('id', row.id)
    )
  );

  const failed = results.find((result) => result.error);
  if (failed?.error) {
    throw new Error(`Reminder backfill update failed: ${failed.error.message}`);
  }

  return data.length;
}

/**
 * Called by the review card. Optionally corrects the task or time in the same
 * action, because the fastest fix is one the user makes at the moment of review.
 */
export async function confirmReminder(
  userId: string,
  reminderId: string,
  edits?: { task?: string; dueAt?: string | null }
): Promise<CreatedReminder> {
  const patch: Record<string, unknown> = { status: 'confirmed' };

  if (edits?.task !== undefined) patch.task = edits.task.trim();
  if (edits?.dueAt !== undefined) {
    patch.due_at = edits.dueAt;
    patch.reminder_time = edits.dueAt;
  }

  const { data, error } = await supabase
    .from('reminders')
    .update(patch)
    .eq('id', reminderId)
    .eq('user_id', userId)
    .select(
      REMINDER_BASE_COLUMNS
    )
    .single();

  if (error) {
    console.error('Confirm reminder failed:', error);
    throw new Error('Failed to confirm reminder.');
  }

  return data as CreatedReminder;
}

export async function setReminderStatus(
  userId: string,
  reminderId: string,
  status: ReminderStatus
): Promise<void> {
  const { error } = await supabase
    .from('reminders')
    .update({ status })
    .eq('id', reminderId)
    .eq('user_id', userId);

  if (error) {
    console.error('Reminder status update failed:', error);
    throw new Error('Failed to update reminder.');
  }
}

const REMINDER_COLUMNS = `${REMINDER_BASE_COLUMNS}, capture_id`;

/**
 * The Reminders tab. Returns three lists; the DEVICE splits `active` into Today
 * and Upcoming against its own local clock (§3.4 — time is a device fact, and a
 * server grouping by "today" would be wrong in another timezone).
 *   - needsReview: pending reminders (a dismissed review card left them unscheduled)
 *   - active: confirmed reminders, soonest first
 *   - history: fired / dismissed / cancelled, most recent first
 * Reminders are NEVER filtered by age — one set five weeks ago for next Friday
 * must still appear and fire.
 */
export async function listGroupedReminders(userId: string): Promise<{
  needsReview: CreatedReminder[];
  active: CreatedReminder[];
  history: CreatedReminder[];
}> {
  const { data, error } = await supabase
    .from('reminders')
    .select(REMINDER_COLUMNS)
    .eq('user_id', userId)
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(300);

  if (error) {
    console.error('List grouped reminders failed:', error);
    throw new Error('Failed to load reminders.');
  }

  const all = (data ?? []) as CreatedReminder[];
  const needsReview = all.filter((r) => r.status === 'pending');
  const active = all.filter((r) => r.status === 'confirmed');
  const history = all
    .filter(
      (r) =>
        r.status === 'fired' ||
        r.status === 'dismissed' ||
        r.status === 'cancelled'
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 25);

  return { needsReview, active, history };
}

/**
 * A reminder the user creates by hand from the + button. No capture, no
 * extraction: it is `confirmed` immediately and the device schedules it at once.
 */
export async function createManualReminder(
  userId: string,
  input: {
    task: string;
    dueAt: string | null;
    person: string | null;
    repeatDays?: number[] | null;
    /** Link to an existing capture ("Add a reminder" on a long-press). */
    captureId?: string | null;
  }
): Promise<CreatedReminder> {
  const task = input.task.trim();
  if (!task) throw new Error('Reminder task cannot be empty.');
  if (!input.dueAt) throw new Error('A manual reminder needs a time.');

  let embedding: number[] | null = null;
  try {
    const [vector] = await aiProvider.embed([task], 'document');
    embedding = vector ?? null;
  } catch (error) {
    console.error('Embedding failed; saving manual reminder without vector:', error);
  }

  const { data, error } = await supabase
    .from('reminders')
    .insert({
      user_id: userId,
      capture_id: input.captureId ?? null,
      task,
      person: input.person?.trim() || null,
      due_at: input.dueAt,
      reminder_time: input.dueAt,
      place_hint: null,
      place_id: null,
      insistent: false,
      status: 'confirmed',
      embedding,
      // Only sent when set, so a plain reminder never depends on the column.
      ...(input.repeatDays?.length ? { repeat_days: input.repeatDays } : {}),
    })
    .select(REMINDER_COLUMNS)
    .single();

  if (error) {
    console.error('Create manual reminder failed:', error);
    throw new Error('Failed to create reminder.');
  }

  const reminder = data as CreatedReminder;

  if (input.person?.trim()) {
    try {
      const entity = await resolveEntity(userId, 'person', input.person);
      if (entity) await linkReminderToEntities(reminder.id, [entity.id]);
    } catch (linkError) {
      console.error('Manual reminder entity linking failed:', linkError);
    }
  }

  return reminder;
}

/**
 * Edit a reminder (task, time, person) or change its status (done, snooze).
 * A task edit re-embeds so recall keeps finding it by its new wording. The
 * DEVICE reschedules/cancels the local notification after this returns — the
 * server never touches notifications.
 */
export async function updateReminder(
  userId: string,
  reminderId: string,
  patch: {
    task?: string;
    dueAt?: string | null;
    person?: string | null;
    status?: ReminderStatus;
    repeatDays?: number[] | null;
  }
): Promise<CreatedReminder> {
  const update: Record<string, unknown> = {};

  if (patch.task !== undefined) {
    const task = patch.task.trim();
    if (!task) throw new Error('Reminder task cannot be empty.');
    update.task = task;
    try {
      const [vector] = await aiProvider.embed([task], 'document');
      update.embedding = vector ?? null;
    } catch (error) {
      console.error('Re-embedding edited reminder failed:', error);
    }
  }
  if (patch.dueAt !== undefined) {
    update.due_at = patch.dueAt;
    update.reminder_time = patch.dueAt;
  }
  if (patch.person !== undefined) update.person = patch.person?.trim() || null;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.repeatDays !== undefined) {
    update.repeat_days = patch.repeatDays?.length ? patch.repeatDays : null;
  }

  if (Object.keys(update).length === 0) {
    throw new Error('Nothing to update.');
  }

  const { data, error } = await supabase
    .from('reminders')
    .update(update)
    .eq('id', reminderId)
    .eq('user_id', userId)
    .select(REMINDER_COLUMNS)
    .single();

  if (error) {
    console.error('Update reminder failed:', error);
    throw new Error('Failed to update reminder.');
  }

  return data as CreatedReminder;
}

/** Hard-delete a reminder. The device cancels its local notification after. */
export async function deleteReminder(
  userId: string,
  reminderId: string
): Promise<void> {
  const { error } = await supabase
    .from('reminders')
    .delete()
    .eq('id', reminderId)
    .eq('user_id', userId);

  if (error) {
    console.error('Delete reminder failed:', error);
    throw new Error('Failed to delete reminder.');
  }
}

/**
 * Everything the device needs in order to own scheduling: confirmed reminders
 * with a future time, plus every place-anchored reminder for geofencing.
 */
export async function listActiveReminders(userId: string) {
  const { data, error } = await supabase
    .from('reminders')
    .select(
      REMINDER_BASE_COLUMNS
    )
    .eq('user_id', userId)
    .in('status', ['pending', 'confirmed'])
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(200);

  if (error) {
    console.error('List reminders failed:', error);
    throw new Error('Failed to load reminders.');
  }

  return (data ?? []) as CreatedReminder[];
}
