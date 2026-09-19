import { supabase } from '../../services/supabase';

export type EntityKind = 'person' | 'place' | 'topic';

export type Entity = {
  id: string;
  user_id: string;
  kind: EntityKind;
  name: string;
  normalized: string;
  lat: number | null;
  lng: number | null;
  radius_m: number | null;
  created_at: string;
};

/**
 * Resolve a spoken name to a stable entity row.
 *
 * Select-then-insert rather than upsert: `normalized` is a GENERATED column, so
 * it cannot appear in an INSERT payload, and inferring the conflict target
 * through it is fragile across client versions. The unique constraint still
 * protects us — on a race we catch 23505 and re-select.
 */
export async function resolveEntity(
  userId: string,
  kind: EntityKind,
  rawName: string
): Promise<Entity | null> {
  const name = rawName.trim();
  if (!name) return null;

  const normalized = name.toLowerCase();

  const existing = await supabase
    .from('entities')
    .select('*')
    .eq('user_id', userId)
    .eq('kind', kind)
    .eq('normalized', normalized)
    .maybeSingle();

  if (existing.data) return existing.data as Entity;

  const inserted = await supabase
    .from('entities')
    .insert({ user_id: userId, kind, name })
    .select()
    .single();

  if (!inserted.error) return inserted.data as Entity;

  // Unique violation: another request created it between our select and insert.
  if (inserted.error.code === '23505') {
    const retry = await supabase
      .from('entities')
      .select('*')
      .eq('user_id', userId)
      .eq('kind', kind)
      .eq('normalized', normalized)
      .maybeSingle();

    if (retry.data) return retry.data as Entity;
  }

  console.error('Entity resolve failed:', inserted.error);
  return null;
}

export async function resolveEntities(
  userId: string,
  kind: EntityKind,
  names: string[]
): Promise<Entity[]> {
  const unique = Array.from(
    new Set(names.map((n) => n.trim()).filter(Boolean))
  );

  const resolved = await Promise.all(
    unique.map((name) => resolveEntity(userId, kind, name))
  );

  return resolved.filter((entity): entity is Entity => entity !== null);
}

export async function linkMemoryToEntities(
  memoryId: string,
  entityIds: string[]
): Promise<void> {
  if (entityIds.length === 0) return;

  const { error } = await supabase
    .from('memory_entities')
    .upsert(
      entityIds.map((entityId) => ({
        memory_id: memoryId,
        entity_id: entityId,
      })),
      { onConflict: 'memory_id,entity_id', ignoreDuplicates: true }
    );

  if (error) {
    console.error('Memory/entity link failed:', error);
  }
}

/**
 * Attach coordinates to a place entity. Called once the device has geocoded a
 * placeHint, or when the user confirms "yes, this is the place I meant".
 */
export async function setPlaceCoordinates(
  userId: string,
  entityId: string,
  lat: number,
  lng: number,
  radiusMetres = 120
): Promise<void> {
  const { error } = await supabase
    .from('entities')
    .update({ lat, lng, radius_m: radiusMetres })
    .eq('id', entityId)
    .eq('user_id', userId)
    .eq('kind', 'place');

  if (error) {
    console.error('Place coordinate update failed:', error);
  }
}
