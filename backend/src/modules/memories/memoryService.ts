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
  action: MemoryAction,
  /**
   * A vector already computed in a batch with the capture's other memories
   * (one embedding call per capture, not one per memory). Omitted → embed here.
   */
  precomputed?: number[]
): Promise<CreatedMemory> {
  const content = action.content.trim();
  if (!content) {
    throw new Error('Memory content cannot be empty.');
  }

  let embedding: number[] | null = precomputed ?? null;
  if (!precomputed) {
    try {
      const [vector] = await aiProvider.embed([content], 'document');
      embedding = vector ?? null;
    } catch (error) {
      console.error('Embedding failed; saving memory without vector:', error);
    }
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
 * Edit a memory's text. Re-embeds on save — without that, recall keeps matching
 * the old wording while the screen shows the new one (the app quietly wrong,
 * per the design doc). If the embedding call fails we still persist the new
 * text and null the stale vector, so hybrid retrieval falls back to lexical
 * rather than returning the OLD meaning; a backfill can refill the vector later.
 */
export async function updateMemory(
  userId: string,
  memoryId: string,
  content: string
): Promise<CreatedMemory> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Memory content cannot be empty.');
  }

  let embedding: number[] | null = null;
  try {
    const [vector] = await aiProvider.embed([trimmed], 'document');
    embedding = vector ?? null;
  } catch (error) {
    console.error('Re-embedding failed; clearing stale vector:', error);
  }

  const { data, error } = await supabase
    .from('memories')
    .update({ content: trimmed, embedding })
    .eq('user_id', userId)
    .eq('id', memoryId)
    .select('id, content, person, location, topics, created_at')
    .maybeSingle();

  if (error) {
    console.error('Memory update failed:', error);
    throw new Error('Failed to update memory.');
  }
  if (!data) {
    throw new Error('Memory not found.');
  }

  return data as CreatedMemory;
}

/**
 * Delete one memory. Removes its entity links first (best-effort) so People
 * counts stay honest, then the row itself. Filtered by user_id — service_role
 * bypasses RLS, so that filter is the only thing scoping it to the owner.
 */
export async function deleteMemory(
  userId: string,
  memoryId: string
): Promise<void> {
  // Delete the memory scoped to its owner FIRST, and only touch its links once
  // that has proved the memory is the caller's. memory_entities has no user_id
  // column, so ownership can only be established through the memories row — and
  // since service-role bypasses RLS, that scoping is the one thing stopping a
  // request from stripping another user's links by guessing a memory id.
  const { data: deleted, error } = await supabase
    .from('memories')
    .delete()
    .eq('user_id', userId)
    .eq('id', memoryId)
    .select('id');

  if (error) {
    console.error('Memory delete failed:', error);
    throw new Error('Failed to delete memory.');
  }
  // Not the caller's (or already gone): never touch links we don't own.
  if (!deleted || deleted.length === 0) return;

  const linkResult = await supabase
    .from('memory_entities')
    .delete()
    .eq('memory_id', memoryId);
  if (linkResult.error) {
    console.error('Removing memory entity links failed:', linkResult.error);
  }
}

/**
 * A memory typed by the user, not extracted. Still embedded (extraction off ≠
 * embedding off) so recall can find it. `capture_id` ties it to its manual
 * capture; `person`/`topics`/`location` are left null — the user gave prose,
 * not structure.
 */
export async function createManualMemory(
  userId: string,
  captureId: string,
  content: string
): Promise<CreatedMemory> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Memory content cannot be empty.');
  }

  let embedding: number[] | null = null;
  try {
    const [vector] = await aiProvider.embed([trimmed], 'document');
    embedding = vector ?? null;
  } catch (error) {
    console.error('Embedding manual memory failed; saving without vector:', error);
  }

  const { data, error } = await supabase
    .from('memories')
    .insert({
      user_id: userId,
      capture_id: captureId,
      content: trimmed,
      person: null,
      location: null,
      topics: [],
      embedding,
    })
    .select('id, content, person, location, topics, created_at')
    .single();

  if (error) {
    console.error('Manual memory insert failed:', error);
    throw new Error('Failed to save memory.');
  }

  return data as CreatedMemory;
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
