import { supabase } from '../../services/supabase';
import { aiProvider } from '../ai';
import {
  linkMemoryToEntities,
  resolveEntities,
  resolveEntity,
} from '../entities/entityService';

import type { MemoryAction } from '../ai/interpretationSchema';

export type CreatedMemory = {
  id: string;
  content: string;
  person: string | null;
  location: string | null;
  topics: string[];
  created_at: string;
};

/**
 * Persist one atomic memory.
 *
 * Embedding happens on write, not on read. If the embedding call fails we still
 * save the memory — hybrid retrieval falls back to the lexical branch, and a
 * backfill job can fill the vector in later. Losing the user's memory because
 * an embedding API was slow would be indefensible.
 */
export async function createMemory(
  userId: string,
  captureId: string | null,
  action: MemoryAction
): Promise<CreatedMemory> {
  const content = action.content.trim();
  if (!content) {
    throw new Error('Memory content cannot be empty.');
  }

  let embedding: number[] | null = null;
  try {
    const [vector] = await aiProvider.embed([content], 'document');
    embedding = vector ?? null;
  } catch (error) {
    console.error('Embedding failed; saving memory without vector:', error);
  }

  const { data, error } = await supabase
    .from('memories')
    .insert({
      user_id: userId,
      capture_id: captureId,
      content,
      // Legacy single-value columns, kept populated for backward compatibility
      // while the entities tables become the source of truth.
      person: action.people[0] ?? null,
      location: action.placeHint,
      topics: action.topics,
      embedding,
    })
    .select('id, content, person, location, topics, created_at')
    .single();

  if (error) {
    console.error('Database memory error:', error);
    throw new Error('Failed to save memory.');
  }

  const memory = data as CreatedMemory;

  // Entity links are best-effort: a failure here must not fail the write.
  try {
    const people = await resolveEntities(userId, 'person', action.people);
    const topics = await resolveEntities(userId, 'topic', action.topics);
    const place = action.placeHint
      ? await resolveEntity(userId, 'place', action.placeHint)
      : null;

    const ids = [
      ...people.map((entity) => entity.id),
      ...topics.map((entity) => entity.id),
      ...(place ? [place.id] : []),
    ];

    await linkMemoryToEntities(memory.id, ids);
  } catch (error) {
    console.error('Entity linking failed:', error);
  }

  return memory;
}

/**
 * One-off backfill for memories written before embeddings existed.
 * Run from a script, not from a request handler.
 */
export async function backfillEmbeddings(batchSize = 50): Promise<number> {
  const { data, error } = await supabase
    .from('memories')
    .select('id, content')
    .is('embedding', null)
    .limit(batchSize);

  if (error) throw new Error(`Backfill query failed: ${error.message}`);
  if (!data || data.length === 0) return 0;

  const vectors = await aiProvider.embed(
    data.map((row) => row.content),
    'document'
  );

  const results = await Promise.all(
    data.map((row, index) =>
      supabase
        .from('memories')
        .update({ embedding: vectors[index] })
        .eq('id', row.id)
    )
  );

  // A silently failed update here is worse than a thrown one: the rows stay
  // NULL, the next batch re-fetches and re-embeds the same rows, and a naive
  // caller loops until the embedding quota is gone.
  const failed = results.find((result) => result.error);
  if (failed?.error) {
    throw new Error(`Backfill update failed: ${failed.error.message}`);
  }

  return data.length;
}
