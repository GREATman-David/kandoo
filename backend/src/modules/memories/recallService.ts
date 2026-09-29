import { supabase } from '../../services/supabase';
import { aiProvider, withDeadline } from '../ai';
import { answerFromMatches } from '../ai/fallbackProvider';

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
    // Bounded: with the embedding model overloaded, lexical-only recall now
    // beats a semantic answer that arrives after the app has given up.
    const [vector] = await withDeadline(aiProvider.embed([query], 'query'), 4_000, 'Query embedding');
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

  // Without an embedding the RPC ranks on words alone, and ts_rank gives rows
  // that share NO words a vanishing non-zero score, so they'd pass `score > 0`
  // and answer with unrelated memories. Keep only real word matches; if that
  // leaves nothing, the per-word fallback (any salient word) does better.
  if (!queryEmbedding) {
    results = results.filter((m) => (m.score ?? 0) > LEXICAL_MIN_SCORE);
    if (results.length === 0) return fallbackRecall(userId, query, matchCount);
  }

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

/** Below this, a lexical-only match_context score means "no word in common". */
const LEXICAL_MIN_SCORE = 1e-6;

/**
 * Used when the RPC is unavailable, or with no embedding when the RPC finds no
 * real word match. Matches individual salient words across memories and
 * reminders, best first: the most query words matched, then the most recent.
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

  const hits = (text: string) => {
    const lower = text.toLowerCase();
    return terms.filter((term) => lower.includes(term)).length;
  };
  return items
    .map((item) => ({ item, score: hits(item.content) }))
    .sort((a, b) => b.score - a.score || Date.parse(b.item.created_at) - Date.parse(a.item.created_at))
    .map(({ item }) => item)
    .slice(0, limit);
}

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

/**
 * Kandoo's voice at the paywall boundary. Never a hard "upgrade now" — it
 * answers what it can, then names Pro as the way to reach further back.
 */
const PRO_MORE_LINE =
  'There’s more from further back, but memories older than ten days are part of Kandoo Pro.';
const PRO_ONLY_LINE =
  'That’s from more than ten days ago — older memories are part of Kandoo Pro.';

/**
 * Recall answer, gated by memory depth. Free users are answered from the last
 * 10 days; when the question genuinely reaches older memories, the answer says
 * so in Kandoo's voice and `proBoundaryHit` tells the device to raise the
 * paywall. Pro users are answered from everything. Enforcement is here, not on
 * the device — see entitlementService.
 *
 * When the window hides every relevant memory, the older-only branch skips the
 * answer-generation model call entirely: there is nothing in-window to answer
 * from, and spending a scarce Gemini call to say "I found nothing" would be
 * both wrong and wasteful.
 */
export async function answerRecall(
  userId: string,
  action: RecallAction,
  isPro: boolean,
  opts: { noModel?: boolean } = {}
): Promise<{ answer: string; memories: RecallMemory[]; proBoundaryHit: boolean }> {
  const all = await recallMemories(userId, action);
  // Every model is known to be down: answer from the matches directly rather
  // than spend the time budget failing again.
  const generate = (question: string, memories: RecallMemory[]) =>
    opts.noModel
      ? Promise.resolve(answerFromMatches(memories))
      : aiProvider.generateRecallAnswer(question, memories);

  if (isPro) {
    const answer = await generate(action.query, all);
    return { answer, memories: all, proBoundaryHit: false };
  }

  const cutoff = Date.now() - TEN_DAYS_MS;
  const isRecent = (memory: RecallMemory) => {
    const created = Date.parse(memory.created_at);
    return Number.isNaN(created) || created >= cutoff;
  };
  const recent = all.filter(isRecent);

  // `all` is ranked best-first, so array position IS relevance rank. The
  // boundary should fire ONLY when an older memory would have outranked the
  // recent ones we can show — i.e. the top match is older than the cutoff. If a
  // recent memory is the most relevant, it already answers the question and
  // nothing is being withheld, however many older rows also happened to match.
  const firstOlder = all.findIndex((m) => !isRecent(m));
  const firstRecent = all.findIndex(isRecent);
  const olderOutranks =
    firstOlder !== -1 && (firstRecent === -1 || firstOlder < firstRecent);

  if (!olderOutranks) {
    const answer = await generate(action.query, recent);
    return { answer, memories: recent, proBoundaryHit: false };
  }

  // The most relevant match is older than the cutoff — it is genuinely withheld.
  if (recent.length === 0) {
    return { answer: PRO_ONLY_LINE, memories: [], proBoundaryHit: true };
  }

  const answer = await generate(action.query, recent);
  return {
    answer: `${answer}\n\n${PRO_MORE_LINE}`,
    memories: recent,
    proBoundaryHit: true,
  };
}
