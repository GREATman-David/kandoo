import { supabase } from '../../services/supabase';

/**
 * The monthly recap's server half: who was on the user's mind and what they
 * kept. Where they WENT is not here — visit history never leaves the phone
 * (AGENTS §3.5); the app adds it from its own records.
 *
 * Counts only. No memory content is returned or logged.
 */

export type MonthInsights = {
  from: string;
  to: string;
  memories: number;
  remindersSet: number;
  remindersDone: number;
  /** Most-mentioned people: memories and reminders linked to them in the window. */
  people: { id: string; name: string; count: number }[];
  /** Places talked about most (said, not visited). */
  placesMentioned: { id: string; name: string; count: number }[];
};

const MAX_ROWS = 2000;
const TOP = 5;

type Linked = { entity_id: string; entities: { id: string; name: string; kind: string; alias_of?: string | null } | null };

function rank(links: Linked[], kind: 'person' | 'place'): { id: string; name: string; count: number }[] {
  const counts = new Map<string, { id: string; name: string; count: number }>();
  for (const link of links) {
    const e = Array.isArray(link.entities) ? link.entities[0] : link.entities;
    if (!e || e.kind !== kind || e.alias_of) continue;
    const entry = counts.get(e.id) ?? { id: e.id, name: e.name, count: 0 };
    entry.count++;
    counts.set(e.id, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, TOP);
}

export async function monthInsights(userId: string, from: string, to: string): Promise<MonthInsights> {
  const [memRes, remRes] = await Promise.all([
    supabase
      .from('memories')
      .select('id')
      .eq('user_id', userId)
      .gte('created_at', from)
      .lt('created_at', to)
      .limit(MAX_ROWS),
    supabase
      .from('reminders')
      .select('id, status')
      .eq('user_id', userId)
      .gte('created_at', from)
      .lt('created_at', to)
      .limit(MAX_ROWS),
  ]);
  if (memRes.error) throw new Error(`Insights memories query failed: ${memRes.error.message}`);
  if (remRes.error) throw new Error(`Insights reminders query failed: ${remRes.error.message}`);

  const memoryIds = ((memRes.data ?? []) as { id: string }[]).map((m) => m.id);
  const reminders = (remRes.data ?? []) as { id: string; status: string }[];
  const reminderIds = reminders.map((r) => r.id);

  const [memLinks, remLinks] = await Promise.all([
    memoryIds.length
      ? supabase
          .from('memory_entities')
          .select('entity_id, entities!inner(id, name, kind, alias_of, user_id)')
          .eq('entities.user_id', userId)
          .in('memory_id', memoryIds)
      : Promise.resolve({ data: [], error: null }),
    reminderIds.length
      ? supabase
          .from('reminder_entities')
          .select('entity_id, entities!inner(id, name, kind, alias_of, user_id)')
          .eq('entities.user_id', userId)
          .in('reminder_id', reminderIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (memLinks.error) throw new Error(`Insights memory links failed: ${memLinks.error.message}`);
  // reminder_entities is optional (migration 004): degrade to memories only.
  if (remLinks.error) console.warn('Insights reminder links unavailable:', remLinks.error.message);

  const links = [
    ...((memLinks.data ?? []) as unknown as Linked[]),
    ...((remLinks.error ? [] : remLinks.data ?? []) as unknown as Linked[]),
  ];

  return {
    from,
    to,
    memories: memoryIds.length,
    remindersSet: reminders.length,
    remindersDone: reminders.filter((r) => r.status === 'fired').length,
    people: rank(links, 'person'),
    placesMentioned: rank((memLinks.data ?? []) as unknown as Linked[], 'place'),
  };
}
