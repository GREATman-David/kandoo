import { supabase } from '../../services/supabase';
import { aiProvider } from '../ai';

import type { RecallMemory } from '../ai/aiProvider';
import type { RecallAction } from '../ai/interpretationSchema';

/**
 * Recall searches everything the user has told Kandoo — saved memories AND
 * scheduled reminders — because "when did I say I'd call Mummy" is a question
 * about a reminder, not a memory. The `match_context` RPC unions both tables,
 * hybrid-scored (pgvector cosine fused with full-text ts_rank), and tags each
 * row with its `source`.
 *
 * The previous `match_memories` searched memories only, so a reminder could
 * never be recalled. And the version before that ran
 *   .or(`content.ilike.%${query}%`)
 * with the whole natural-language question as the pattern — no row ever
 * literally contains "when did I say I would call Mummy", so it always
 * returned zero rows.
 */
export async function recallMemories(
  userId: string,
  action: RecallAction,
  matchCount = 8
): Promise<RecallMemory[]> {
  const query = action.query.trim();
  if (!query) {
    throw new Error('Recall query cannot be empty.');
  }

  let queryEmbedding: number[] | null = null;
  try {
    const [vector] = await aiProvider.embed([query], 'query');
    queryEmbedding = vector ?? null;
  } catch (error) {
    console.error('Query embedding failed; using lexical only:', error);
  }

  const { data, error } = await supabase.rpc('match_context', {
    p_user_id: userId,
    p_query_embedding: queryEmbedding,
    p_query_text: query,
    p_match_count: matchCount,
  });

  if (error) {
    console.error('Hybrid recall failed:', error);
    return fallbackRecall(userId, query, matchCount);
  }

  let results = (data ?? []) as RecallMemory[];

  // Scope filters are a narrowing pass, never a widening one: if scoping
  // removes everything, fall back to the unscoped ranking rather than
  // telling the user we have nothing.
  if (action.scopePerson) {
    const needle = action.scopePerson.toLowerCase();
    const scoped = results.filter((m) =>
      m.person?.toLowerCase().includes(needle)
    );
    if (scoped.length > 0) results = scoped;
  }

  if (action.scopePlace) {
    const needle = action.scopePlace.toLowerCase();
    const scoped = results.filter((m) =>
      m.location?.toLowerCase().includes(needle)
    );
    if (scoped.length > 0) results = scoped;
  }

  return results;
}

/**
 * Used only when the RPC is unavailable (e.g. migration not yet applied).
 * Lexical match on individual salient words across memories and reminders.
 */
async function fallbackRecall(
  userId: string,
  query: string,
  limit: number
): Promise<RecallMemory[]> {
  const stopWords = new Set([
    'what','when','where','who','did','do','does','the','a','an','about','i',
    'me','my','you','said','say','tell','remember','was','were','is','are',
    'that','this','to','of','on','in','for','with','and','or','it','can','would',
  ]);

  const terms = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))
    .slice(0, 6);

  if (terms.length === 0) return [];

  const [memories, reminders] = await Promise.all([
    supabase
      .from('memories')
      .select('id, content, person, location, created_at')
      .eq('user_id', userId)
      .or(terms.map((term) => `content.ilike.%${term}%`).join(','))
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('reminders')
      .select('id, task, person, place_hint, due_at, created_at')
      .eq('user_id', userId)
      .or(terms.map((term) => `task.ilike.%${term}%`).join(','))
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  if (memories.error) console.error('Fallback memory recall failed:', memories.error);
  if (reminders.error) console.error('Fallback reminder recall failed:', reminders.error);

  const items: RecallMemory[] = [
    ...(memories.data ?? []).map((m) => ({
      id: m.id as string,
      source: 'memory' as const,
      content: m.content as string,
      person: (m.person as string | null) ?? null,
      location: (m.location as string | null) ?? null,
      due_at: null,
      created_at: m.created_at as string,
    })),
    ...(reminders.data ?? []).map((r) => ({
      id: r.id as string,
      source: 'reminder' as const,
      content: r.task as string,
      person: (r.person as string | null) ?? null,
      location: (r.place_hint as string | null) ?? null,
      due_at: (r.due_at as string | null) ?? null,
      created_at: r.created_at as string,
    })),
  ];

  return items.slice(0, limit);
}

export async function answerRecall(
  userId: string,
  action: RecallAction
): Promise<{ answer: string; memories: RecallMemory[] }> {
  const memories = await recallMemories(userId, action);
  const answer = await aiProvider.generateRecallAnswer(action.query, memories);
  return { answer, memories };
}
