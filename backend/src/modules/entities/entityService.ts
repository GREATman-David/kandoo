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
  /** Places only: the traced shape, [[lat, lng], ...] (migration 007). */
  area?: [number, number][] | null;
  /** Places only: this name is another way of saying that place (migration 008). */
  alias_of?: string | null;
  starred?: boolean;
  created_at: string;
};

/**
 * A place name the user has said means another place ("school" → "UG Campus")
 * resolves to that place, so what they say lands where it can be watched. One
 * hop only: merging always points an alias at a place that is not one itself.
 */
async function followAlias(entity: Entity): Promise<Entity> {
  if (!entity.alias_of) return entity;
  const target = await supabase
    .from('entities')
    .select('*')
    .eq('user_id', entity.user_id)
    .eq('id', entity.alias_of)
    .maybeSingle();
  if (target.error) {
    // Still a valid place; only the alias hop is lost for this one save.
    console.error('Place alias lookup failed:', target.error);
    return entity;
  }
  return (target.data as Entity | null) ?? entity;
}

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

  if (existing.data) return followAlias(existing.data as Entity);

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

/** Link a reminder to people entities — the mirror of linkMemoryToEntities, so
 *  "What you promised" and merge move reminders across properly. */
export async function linkReminderToEntities(
  reminderId: string,
  entityIds: string[]
): Promise<void> {
  if (entityIds.length === 0) return;

  const { error } = await supabase
    .from('reminder_entities')
    .upsert(
      entityIds.map((entityId) => ({
        reminder_id: reminderId,
        entity_id: entityId,
      })),
      { onConflict: 'reminder_id,entity_id', ignoreDuplicates: true }
    );

  if (error) {
    console.error('Reminder/entity link failed:', error);
  }
}
