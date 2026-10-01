import { supabase } from '../../services/supabase';

import { aggregateUsage, type Usage, type UsageRows } from './usageAggregate';

/**
 * Fetch one user's activity in a window and aggregate it for Insights. Every
 * query filters `user_id` (the service role bypasses RLS — AGENTS §4). Only
 * counts and short labels leave here: no memory text, no note bodies.
 */

const LIMIT = 5000;

export async function usageInsights(
  userId: string,
  window: { from: string; to: string; timeZone: string }
): Promise<Usage> {
  const { from, to } = window;
  const inWindow = <T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(q: T) =>
    q.gte('created_at', from).lte('created_at', to);

  const [captures, memories, reminders, notes, photos] = await Promise.all([
    inWindow(supabase.from('captures').select('created_at, source').eq('user_id', userId)).limit(LIMIT),
    inWindow(supabase.from('memories').select('created_at, person, location').eq('user_id', userId)).limit(LIMIT),
    inWindow(supabase.from('reminders').select('created_at, due_at, status, person').eq('user_id', userId)).limit(LIMIT),
    inWindow(
      supabase.from('library_notes').select('created_at, source, library_categories(name)').eq('user_id', userId)
    ).limit(LIMIT),
    inWindow(supabase.from('photos').select('created_at').eq('user_id', userId)).limit(LIMIT),
  ]);

  for (const [name, result] of Object.entries({ captures, memories, reminders, notes, photos })) {
    if (result.error) throw new Error(`Insights: reading ${name} failed: ${result.error.message}`);
  }

  const rows: UsageRows = {
    captures: (captures.data ?? []) as UsageRows['captures'],
    memories: (memories.data ?? []) as UsageRows['memories'],
    reminders: (reminders.data ?? []) as UsageRows['reminders'],
    libraryNotes: (notes.data ?? []).map((n) => {
      const shelf = n.library_categories as unknown as { name: string } | { name: string }[] | null;
      return {
        created_at: n.created_at as string,
        source: n.source as string,
        category: (Array.isArray(shelf) ? shelf[0]?.name : shelf?.name) ?? null,
      };
    }),
    photos: (photos.data ?? []) as UsageRows['photos'],
  };
  return aggregateUsage(rows, window);
}
