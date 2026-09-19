import { supabase } from '../../services/supabase';
import { resolveEntity } from '../entities/entityService';
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
};

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
      insistent: action.insistent,
      status: 'pending',
    })
    .select(
      'id, task, person, due_at, place_hint, place_id, insistent, status, created_at'
    )
    .single();

  if (error) {
    console.error('Database reminder error:', error);
    throw new Error('Failed to create reminder.');
  }

  return data as CreatedReminder;
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
      'id, task, person, due_at, place_hint, place_id, insistent, status, created_at'
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

/**
 * Everything the device needs in order to own scheduling: confirmed reminders
 * with a future time, plus every place-anchored reminder for geofencing.
 */
export async function listActiveReminders(userId: string) {
  const { data, error } = await supabase
    .from('reminders')
    .select(
      'id, task, person, due_at, place_hint, place_id, insistent, status, created_at'
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
