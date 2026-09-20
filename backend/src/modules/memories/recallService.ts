import { supabase } from '../../services/supabase';
import { aiProvider } from '../ai';

import type { RecallMemory } from '../ai/aiProvider';
import type { RecallAction } from '../ai/interpretationSchema';

/**
 * The previous implementation did:
 *
 *   .or(`content.ilike.%${query}%`)
 *
 * with the user's whole natural-language question as the pattern. No memory
 * will ever literally contain the string "What I said about my pressure energy
 * generator", so it could only ever return zero rows. It was also unsafe:
 * a query containing a comma or parenthesis breaks PostgREST filter syntax.
 *
 * This version embeds the query and runs hybrid retrieval in Postgres.
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

  const { data, error } = await supabase.rpc('match_memories', {
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
 * Matches on individual salient words rather than the whole sentence.
 */
async function fallbackRecall(
  userId: string,
  query: string,
  limit: number
): Promise<RecallMemory[]> {
  const stopWords = new Set([
    'what','when','where','who','did','do','does','the','a','an','about','i',
    'me','my','you','said','say','tell','remember','was','were','is','are',
    'that','this','to','of','on','in','for','with','and','or','it','can',
  ]);

  const terms = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))
    .slice(0, 6);

  if (terms.length === 0) return [];

  const { data, error } = await supabase
    .from('memories')
    .select('id, content, person, location, created_at')
    .eq('user_id', userId)
    .or(terms.map((term) => `content.ilike.%${term}%`).join(','))
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Fallback recall failed:', error);
    return [];
  }

  return (data ?? []) as RecallMemory[];
}

export async function answerRecall(
  userId: string,
  action: RecallAction
): Promise<{ answer: string; memories: RecallMemory[] }> {
  const memories = await recallMemories(userId, action);
  const answer = await aiProvider.generateRecallAnswer(action.query, memories);
  return { answer, memories };
}
