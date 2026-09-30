import { randomUUID } from 'node:crypto';

import { supabase } from '../../services/supabase';
import { resolveEntities, resolveEntity } from '../entities/entityService';

import type { KandooAction } from '../ai/interpretationSchema';

export { MAX_PHOTO_BYTES, PhotoInputError, decodeJpeg } from './photoInput';

/**
 * Show Kandoo's photo library. Photos live in the PRIVATE `photos` bucket, one
 * folder per user (migration 010). The service role writes them; the app only
 * ever sees short-lived signed URLs, so a leaked link stops working within the
 * hour and nothing in the bucket is public.
 *
 * Every query filters on user_id: the service role bypasses RLS, so that
 * filter is the only thing separating one user's photos from another's.
 */

const BUCKET = 'photos';
/** How long a photo link works. Long enough to scroll a page, short enough to expire. */
const SIGNED_URL_SECONDS = 60 * 60;
export type PhotoRow = {
  id: string;
  capture_id: string | null;
  storage_path: string;
  width: number | null;
  height: number | null;
  description: string | null;
  created_at: string;
};

/** A photo as the app sees it: a signed link, never the storage path. */
export type Photo = {
  id: string;
  captureId: string | null;
  url: string | null;
  width: number | null;
  height: number | null;
  description: string | null;
  createdAt: string;
  /** The people and places it belongs to. */
  people: { id: string; name: string }[];
  places: { id: string; name: string }[];
};

const PHOTO_COLUMNS = 'id, capture_id, storage_path, width, height, description, created_at';

/** Only the caller's own people and places, whatever ids the phone sent. */
export async function ownedEntityIds(userId: string, ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids)) return [];
  const wanted = Array.from(
    new Set(ids.filter((id): id is string => typeof id === 'string' && id.length <= 64))
  ).slice(0, 20);
  if (wanted.length === 0) return [];
  const { data, error } = await supabase
    .from('entities')
    .select('id')
    .eq('user_id', userId)
    .in('kind', ['person', 'place'])
    .in('id', wanted);
  if (error) {
    console.error('Checking photo links failed:', error);
    return [];
  }
  return (data ?? []).map((row) => row.id as string);
}

/**
 * The people and places a photo capture is about: everyone its actions name,
 * every place they mention, and the drawn places the phone says the user is
 * standing in. People and places only — topics would make every album noisy.
 */
export async function entitiesForActions(
  userId: string,
  actions: KandooAction[],
  currentPlaceIds: unknown
): Promise<string[]> {
  const people = new Set<string>();
  const places = new Set<string>();
  for (const action of actions) {
    if (action.kind === 'recall') continue;
    for (const person of action.people) people.add(person);
    if (action.placeHint) places.add(action.placeHint);
  }
  const [personRows, placeRows, here] = await Promise.all([
    resolveEntities(userId, 'person', [...people]),
    Promise.all([...places].map((name) => resolveEntity(userId, 'place', name))),
    ownedEntityIds(userId, currentPlaceIds),
  ]);
  return Array.from(
    new Set([
      ...personRows.map((e) => e.id),
      ...placeRows.flatMap((e) => (e ? [e.id] : [])),
      ...here,
    ])
  );
}

/**
 * Store a photo and its row, then link it. If the row can't be written the
 * uploaded file is removed again, so storage never holds an orphan.
 */
export async function savePhoto(
  userId: string,
  input: {
    bytes: Buffer;
    width: number | null;
    height: number | null;
    description: string | null;
    captureId: string | null;
    entityIds: string[];
  }
): Promise<PhotoRow> {
  const path = `${userId}/${randomUUID()}.jpg`;
  const upload = await supabase.storage.from(BUCKET).upload(path, input.bytes, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (upload.error) {
    console.error('Photo upload failed:', upload.error);
    throw new Error('Failed to store photo.');
  }

  const inserted = await supabase
    .from('photos')
    .insert({
      user_id: userId,
      capture_id: input.captureId,
      storage_path: path,
      width: input.width,
      height: input.height,
      description: input.description,
    })
    .select(PHOTO_COLUMNS)
    .single();

  if (inserted.error) {
    console.error('Photo row insert failed:', inserted.error);
    const removed = await supabase.storage.from(BUCKET).remove([path]);
    if (removed.error) console.error('Removing the orphaned photo failed:', removed.error);
    throw new Error('Failed to save photo.');
  }

  const photo = inserted.data as PhotoRow;
  await linkPhoto(photo.id, input.entityIds);
  return photo;
}

/** Best-effort, like memory links: the photo is saved either way, and a failure is logged. */
export async function linkPhoto(photoId: string, entityIds: string[]): Promise<void> {
  if (entityIds.length === 0) return;
  const { error } = await supabase
    .from('photo_entities')
    .upsert(
      entityIds.map((entityId) => ({ photo_id: photoId, entity_id: entityId })),
      { onConflict: 'photo_id,entity_id', ignoreDuplicates: true }
    );
  if (error) console.error('Photo/entity link failed:', error);
}

/** Rows → what the app sees: signed links and the people/places each belongs to. */
async function present(userId: string, rows: PhotoRow[]): Promise<Photo[]> {
  if (rows.length === 0) return [];

  const [signed, links] = await Promise.all([
    supabase.storage.from(BUCKET).createSignedUrls(
      rows.map((r) => r.storage_path),
      SIGNED_URL_SECONDS
    ),
    supabase
      .from('photo_entities')
      .select('photo_id, entities!inner(id, name, kind, user_id)')
      .in('photo_id', rows.map((r) => r.id))
      .eq('entities.user_id', userId),
  ]);

  if (signed.error) console.error('Signing photo links failed:', signed.error);
  if (links.error) console.error('Reading photo links failed:', links.error);

  const urlByPath = new Map<string, string | null>();
  for (const item of signed.data ?? []) {
    if (item.path) urlByPath.set(item.path, item.signedUrl ?? null);
  }

  type Link = { photo_id: string; entities: { id: string; name: string; kind: string } };
  const byPhoto = new Map<string, Link['entities'][]>();
  for (const link of (links.data ?? []) as unknown as Link[]) {
    const list = byPhoto.get(link.photo_id) ?? [];
    list.push(link.entities);
    byPhoto.set(link.photo_id, list);
  }

  return rows.map((row) => {
    const linked = byPhoto.get(row.id) ?? [];
    return {
      id: row.id,
      captureId: row.capture_id,
      url: urlByPath.get(row.storage_path) ?? null,
      width: row.width,
      height: row.height,
      description: row.description,
      createdAt: row.created_at,
      people: linked.filter((e) => e.kind === 'person').map(({ id, name }) => ({ id, name })),
      places: linked.filter((e) => e.kind === 'place').map(({ id, name }) => ({ id, name })),
    };
  });
}

export async function presentPhoto(userId: string, row: PhotoRow): Promise<Photo> {
  const [photo] = await present(userId, [row]);
  return photo;
}

/**
 * The user's photos, newest first: all of them, one person's or place's
 * album, the ones from given captures, or those whose description matches.
 */
export async function listPhotos(
  userId: string,
  filter: { entityId?: string; captureIds?: string[]; query?: string; limit?: number } = {}
): Promise<Photo[]> {
  const limit = Math.min(Math.max(filter.limit ?? 30, 1), 60);

  let photoIds: string[] | null = null;
  if (filter.entityId) {
    const { data, error } = await supabase
      .from('photo_entities')
      .select('photo_id')
      .eq('entity_id', filter.entityId);
    if (error) {
      console.error('Reading an album failed:', error);
      throw new Error('Failed to load photos.');
    }
    photoIds = (data ?? []).map((row) => row.photo_id as string);
    if (photoIds.length === 0) return [];
  }

  let query = supabase
    .from('photos')
    .select(PHOTO_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (photoIds) query = query.in('id', photoIds);
  if (filter.captureIds) {
    if (filter.captureIds.length === 0) return [];
    query = query.in('capture_id', filter.captureIds);
  }
  if (filter.query) {
    // Escape LIKE wildcards so a user's "%" is a character, not a pattern.
    const safe = filter.query.replace(/[\\%_]/g, (c) => `\\${c}`).slice(0, 80);
    query = query.ilike('description', `%${safe}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Listing photos failed:', error);
    throw new Error('Failed to load photos.');
  }
  return present(userId, (data ?? []) as PhotoRow[]);
}

/**
 * The photos behind a set of memories (recall shows "from this flyer"):
 * memory → its capture → that capture's photo.
 */
export async function photosForMemories(userId: string, memoryIds: string[]): Promise<Photo[]> {
  if (memoryIds.length === 0) return [];
  const { data, error } = await supabase
    .from('memories')
    .select('capture_id')
    .eq('user_id', userId)
    .in('id', memoryIds)
    .not('capture_id', 'is', null);
  if (error) {
    console.error('Finding photos for memories failed:', error);
    return [];
  }
  const captureIds = Array.from(new Set((data ?? []).map((row) => row.capture_id as string)));
  try {
    return await listPhotos(userId, { captureIds, limit: 4 });
  } catch (error) {
    console.error('Loading photos for memories failed:', error);
    return [];
  }
}

/** Latest photo per capture — the thumbnails on Home's Recently list. */
export async function photoUrlsForCaptures(
  userId: string,
  captureIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (captureIds.length === 0) return out;
  try {
    const photos = await listPhotos(userId, { captureIds, limit: 60 });
    for (const photo of photos) {
      if (photo.captureId && photo.url && !out.has(photo.captureId)) out.set(photo.captureId, photo.url);
    }
  } catch (error) {
    console.error('Loading capture thumbnails failed:', error);
  }
  return out;
}

/** Link an existing photo to more of the user's people or places. */
export async function addPhotoLinks(userId: string, photoId: string, entityIds: unknown): Promise<boolean> {
  const own = await supabase.from('photos').select('id').eq('user_id', userId).eq('id', photoId).maybeSingle();
  if (own.error) {
    console.error('Reading a photo failed:', own.error);
    throw new Error('Failed to update photo.');
  }
  if (!own.data) return false;
  await linkPhoto(photoId, await ownedEntityIds(userId, entityIds));
  return true;
}

export async function getPhotoRow(userId: string, photoId: string): Promise<PhotoRow | null> {
  const { data, error } = await supabase
    .from('photos')
    .select(PHOTO_COLUMNS)
    .eq('user_id', userId)
    .eq('id', photoId)
    .maybeSingle();
  if (error) {
    console.error('Reading a photo failed:', error);
    throw new Error('Failed to load photo.');
  }
  return (data as PhotoRow | null) ?? null;
}

/** Delete the row, then the file. A file left behind is logged, never silent. */
export async function deletePhoto(userId: string, photoId: string): Promise<boolean> {
  const row = await getPhotoRow(userId, photoId);
  if (!row) return false;
  const { error } = await supabase.from('photos').delete().eq('user_id', userId).eq('id', photoId);
  if (error) {
    console.error('Deleting a photo row failed:', error);
    throw new Error('Failed to delete photo.');
  }
  const removed = await supabase.storage.from(BUCKET).remove([row.storage_path]);
  if (removed.error) console.error('Removing a deleted photo’s file failed:', removed.error);
  return true;
}

