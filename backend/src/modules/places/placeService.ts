import { supabase } from '../../services/supabase';
import { resolveEntity } from '../entities/entityService';
import { memoriesForEntities } from '../people/peopleService';
import { areaFromRows, areaToRows, type LatLng, type PlaceGeometry } from './geo';

/**
 * Places are `entities` of kind 'place' — the same rows a spoken placeHint
 * ("school") resolves to. Kandoo already knows the places you talk about; a
 * place becomes WATCHABLE once the user draws its area.
 *
 * The server stores places and never watches anyone (AGENTS §3.2, §3.5): the
 * phone registers the geofences, decides when you arrived, and keeps your visit
 * history to itself. Nothing here knows or stores where the user has been.
 */

type ReminderRow = {
  id: string;
  task: string;
  person: string | null;
  status: string;
  due_at: string | null;
  not_before: string | null;
  place_trigger: 'arrive' | 'leave';
  insistent: boolean;
  created_at: string;
  capture_id: string | null;
};

type PlaceRow = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  radius_m: number | null;
  area: unknown;
  starred: boolean | null;
  created_at: string;
};

export type PlaceSummary = {
  id: string;
  name: string;
  /** Null until the user draws the place — it is known but not yet watched. */
  center: LatLng | null;
  radiusM: number | null;
  /** The traced shape; null = the area is the circle itself. */
  area: LatLng[] | null;
  memoryCount: number;
  /** Place reminders still to come: pending or confirmed, with no time of their own. */
  waitingCount: number;
  /** The newest memory here — what a Kandoo Moment says on arrival. */
  latestMemory: { id: string; content: string; created_at: string } | null;
  lastMentionedAt: string;
  starred: boolean;
  /** Other names the user has said mean this place ("school" for "UG Campus"). */
  aliases: string[];
};

export type PlaceDetail = PlaceSummary & {
  memories: { id: string; content: string; created_at: string; capture_id: string | null }[];
  reminders: ReminderRow[];
};

/** A write the user can fix, with the line to show them. */
export class PlaceInputError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'name_taken' | 'invalid'
  ) {
    super(message);
    this.name = 'PlaceInputError';
  }
}

const PLACE_COLUMNS = 'id, name, lat, lng, radius_m, area, starred, created_at';
const PLACE_REMINDER_COLUMNS =
  'id, task, person, status, due_at, not_before, place_trigger, insistent, created_at, capture_id, place_id';

function isWaiting(r: ReminderRow): boolean {
  return (r.status === 'pending' || r.status === 'confirmed') && !r.due_at;
}

async function remindersForPlaces(
  userId: string,
  placeIds: string[]
): Promise<Map<string, ReminderRow[]>> {
  const byPlace = new Map<string, ReminderRow[]>();
  if (placeIds.length === 0) return byPlace;

  const { data, error } = await supabase
    .from('reminders')
    .select(PLACE_REMINDER_COLUMNS)
    .eq('user_id', userId)
    .in('place_id', placeIds)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Place reminders query failed:', error);
    throw new Error('Failed to load place reminders.');
  }

  for (const row of (data ?? []) as (ReminderRow & { place_id: string })[]) {
    const list = byPlace.get(row.place_id) ?? [];
    list.push(row);
    byPlace.set(row.place_id, list);
  }
  return byPlace;
}

/** Alias names pointing at each place: "school" → UG Campus. */
async function aliasesFor(userId: string, placeIds: string[]): Promise<Map<string, string[]>> {
  const byPlace = new Map<string, string[]>();
  if (placeIds.length === 0) return byPlace;
  const { data, error } = await supabase
    .from('entities')
    .select('name, alias_of')
    .eq('user_id', userId)
    .eq('kind', 'place')
    .in('alias_of', placeIds);
  if (error) {
    // Places still list; only the "also called" line is missing.
    console.error('Place aliases query failed:', error);
    return byPlace;
  }
  for (const row of (data ?? []) as { name: string; alias_of: string }[]) {
    byPlace.set(row.alias_of, [...(byPlace.get(row.alias_of) ?? []), row.name]);
  }
  return byPlace;
}

/** % and _ are wildcards to ILIKE; a place name must match literally. */
function literal(name: string): string {
  return name.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Re-attach reminders that name this place but lost (or never had) their link
 * — a place deleted and drawn again, or a name resolved before the place
 * existed. Without this they wait forever on a place that can never fire.
 * Best-effort: reported, never fatal to the draw that triggered it.
 */
async function reattachReminders(userId: string, placeId: string, names: string[]): Promise<void> {
  for (const name of new Set(names.map((n) => n.trim()).filter(Boolean))) {
    const { error } = await supabase
      .from('reminders')
      .update({ place_id: placeId })
      .eq('user_id', userId)
      .is('place_id', null)
      .in('status', ['pending', 'confirmed'])
      .ilike('place_hint', literal(name));
    if (error) console.error('Re-attaching place reminders failed:', error);
  }
}

function summarize(
  row: PlaceRow,
  memories: { id: string; content: string; created_at: string }[],
  reminders: ReminderRow[],
  aliases: string[] = []
): PlaceSummary {
  const newest = [...memories].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const drawn = row.lat !== null && row.lng !== null && row.radius_m !== null;
  const times = [
    row.created_at,
    ...memories.map((m) => m.created_at),
    ...reminders.map((r) => r.created_at),
  ].sort();

  return {
    id: row.id,
    name: row.name,
    center: drawn ? { lat: row.lat as number, lng: row.lng as number } : null,
    radiusM: drawn ? row.radius_m : null,
    area: drawn ? areaFromRows(row.area) : null,
    memoryCount: memories.length,
    waitingCount: reminders.filter(isWaiting).length,
    latestMemory: newest
      ? { id: newest.id, content: newest.content, created_at: newest.created_at }
      : null,
    lastMentionedAt: times.at(-1) ?? row.created_at,
    starred: row.starred === true,
    aliases,
  };
}

/** The Places tab: every place the user has named or drawn, newest activity first. */
export async function listPlaces(userId: string): Promise<PlaceSummary[]> {
  const { data, error } = await supabase
    .from('entities')
    .select(PLACE_COLUMNS)
    .eq('user_id', userId)
    .eq('kind', 'place')
    .is('alias_of', null);

  if (error) {
    console.error('List places failed:', error);
    throw new Error('Failed to load places.');
  }

  const rows = (data ?? []) as PlaceRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [mems, rems, aliases] = await Promise.all([
    memoriesForEntities(userId, ids),
    remindersForPlaces(userId, ids),
    aliasesFor(userId, ids),
  ]);

  return rows
    .map((row) => summarize(row, mems.get(row.id) ?? [], rems.get(row.id) ?? [], aliases.get(row.id) ?? []))
    .sort((a, b) => b.lastMentionedAt.localeCompare(a.lastMentionedAt));
}

async function getPlaceRow(userId: string, placeId: string): Promise<PlaceRow | null> {
  const { data, error } = await supabase
    .from('entities')
    .select(PLACE_COLUMNS)
    .eq('user_id', userId)
    .eq('id', placeId)
    .eq('kind', 'place')
    .maybeSingle();

  if (error) {
    console.error('Get place failed:', error);
    throw new Error('Failed to load that place.');
  }
  return (data as PlaceRow | null) ?? null;
}

export async function getPlace(userId: string, placeId: string): Promise<PlaceDetail | null> {
  const row = await getPlaceRow(userId, placeId);
  if (!row) return null;

  const [mems, rems, aliases] = await Promise.all([
    memoriesForEntities(userId, [row.id]),
    remindersForPlaces(userId, [row.id]),
    aliasesFor(userId, [row.id]),
  ]);
  const memories = (mems.get(row.id) ?? [])
    .map((m) => ({ id: m.id, content: m.content, created_at: m.created_at, capture_id: m.capture_id }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const reminders = rems.get(row.id) ?? [];

  return { ...summarize(row, memories, reminders, aliases.get(row.id) ?? []), memories, reminders };
}

function geometryColumns(geometry: PlaceGeometry) {
  return {
    lat: geometry.center.lat,
    lng: geometry.center.lng,
    radius_m: Math.round(geometry.radiusM),
    area: areaToRows(geometry.area),
  };
}

/**
 * Draw a place. If the user has already SPOKEN about a place with this name
 * ("remind me … when I get to school"), that same row gets the area — so every
 * memory and reminder already waiting on "school" becomes watchable at once.
 * A place that already has an area is only redrawn with `replace`.
 */
export async function createPlace(
  userId: string,
  name: string,
  geometry: PlaceGeometry,
  opts: { replace?: boolean } = {}
): Promise<PlaceSummary> {
  const trimmed = name.trim();
  if (!trimmed) throw new PlaceInputError('Give the place a name.', 'invalid');

  const entity = await resolveEntity(userId, 'place', trimmed);
  if (!entity) throw new Error('Failed to create that place.');

  if (entity.lat !== null && entity.lng !== null && !opts.replace) {
    throw new PlaceInputError(
      `You already have a place called ${entity.name}.`,
      'name_taken'
    );
  }

  return setPlaceArea(userId, entity.id, geometry);
}

/** Draw or redraw a place's area. */
export async function setPlaceArea(
  userId: string,
  placeId: string,
  geometry: PlaceGeometry
): Promise<PlaceSummary> {
  const { error } = await supabase
    .from('entities')
    .update(geometryColumns(geometry))
    .eq('user_id', userId)
    .eq('id', placeId)
    .eq('kind', 'place');

  if (error) {
    console.error('Set place area failed:', error);
    throw new Error('Failed to save that place.');
  }

  const drawnRow = await getPlaceRow(userId, placeId);
  if (!drawnRow) throw new PlaceInputError('That place no longer exists.', 'not_found');
  const aliasNames = (await aliasesFor(userId, [placeId])).get(placeId) ?? [];
  await reattachReminders(userId, placeId, [drawnRow.name, ...aliasNames]);

  const detail = await getPlace(userId, placeId);
  if (!detail) throw new PlaceInputError('That place no longer exists.', 'not_found');
  const { memories: _m, reminders: _r, ...summary } = detail;
  return summary;
}

/** Stop watching a place, keeping everything said about it. */
export async function clearPlaceArea(userId: string, placeId: string): Promise<void> {
  const { error } = await supabase
    .from('entities')
    .update({ lat: null, lng: null, radius_m: null, area: null })
    .eq('user_id', userId)
    .eq('id', placeId)
    .eq('kind', 'place');

  if (error) {
    console.error('Clear place area failed:', error);
    throw new Error('Failed to update that place.');
  }
}

export async function renamePlace(
  userId: string,
  placeId: string,
  name: string
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new PlaceInputError('Give the place a name.', 'invalid');

  const { error } = await supabase
    .from('entities')
    .update({ name: trimmed })
    .eq('user_id', userId)
    .eq('id', placeId)
    .eq('kind', 'place');

  if (error) {
    // The per-user unique name: another place already has it.
    if (error.code === '23505') {
      throw new PlaceInputError(`You already have a place called ${trimmed}.`, 'name_taken');
    }
    console.error('Rename place failed:', error);
    throw new Error('Failed to rename that place.');
  }
}

/**
 * Forget a place entirely. Memories stay (their link to the place goes with the
 * join rows); a reminder that was waiting here loses its place and is shown as
 * needing one.
 */
export async function deletePlace(userId: string, placeId: string): Promise<void> {
  // Detach reminders first, whatever the FK's delete rule is: they keep their
  // spoken place_hint, so the user can see what it was and re-draw it.
  const detach = await supabase
    .from('reminders')
    .update({ place_id: null })
    .eq('user_id', userId)
    .eq('place_id', placeId);

  if (detach.error) {
    console.error('Detach place reminders failed:', detach.error);
    throw new Error('Failed to delete that place.');
  }

  const { error } = await supabase
    .from('entities')
    .delete()
    .eq('user_id', userId)
    .eq('id', placeId)
    .eq('kind', 'place');

  if (error) {
    console.error('Delete place failed:', error);
    throw new Error('Failed to delete that place.');
  }
}

export async function setPlaceStarred(userId: string, placeId: string, starred: boolean): Promise<void> {
  const { error } = await supabase
    .from('entities')
    .update({ starred })
    .eq('user_id', userId)
    .eq('id', placeId)
    .eq('kind', 'place');
  if (error) {
    console.error('Star place failed:', error);
    throw new Error('Failed to update that place.');
  }
}

/**
 * "school" is my "UG Campus": fold a place into another. Everything said about
 * the source moves to the target, and the source's name stays behind as an
 * alias, so the next "when I get to school" lands on UG Campus by itself.
 *
 * Every move is checked before the next step (AGENTS §3.7): a link that failed
 * to move must not be followed by the change that orphans it.
 */
export async function mergePlaceInto(userId: string, sourceId: string, targetId: string): Promise<void> {
  if (sourceId === targetId) throw new PlaceInputError('That is the same place.', 'invalid');

  const [source, target] = await Promise.all([getPlaceRow(userId, sourceId), getPlaceRow(userId, targetId)]);
  if (!source || !target) throw new PlaceInputError('That place no longer exists.', 'not_found');

  const fail = (step: string, error: unknown): never => {
    console.error(`Merge place ${step} failed:`, error);
    throw new Error('Failed to merge those places.');
  };

  const { data: targetRow, error: targetError } = await supabase
    .from('entities')
    .select('alias_of')
    .eq('user_id', userId)
    .eq('id', targetId)
    .single();
  if (targetError) fail('checking the target', targetError);
  if ((targetRow as { alias_of: string | null }).alias_of) {
    throw new PlaceInputError('Choose the place itself, not another name for it.', 'invalid');
  }

  // 1. Memory links -> target (scoped through the caller's own memories).
  const { data: links, error: linksError } = await supabase
    .from('memory_entities')
    .select('memory_id, memories!inner(user_id)')
    .eq('memories.user_id', userId)
    .eq('entity_id', sourceId);
  if (linksError) fail('reading memory links', linksError);
  const memoryIds = ((links ?? []) as { memory_id: string }[]).map((l) => l.memory_id);
  if (memoryIds.length > 0) {
    const { error } = await supabase
      .from('memory_entities')
      .upsert(memoryIds.map((memory_id) => ({ memory_id, entity_id: targetId })), {
        onConflict: 'memory_id,entity_id',
        ignoreDuplicates: true,
      });
    if (error) fail('moving memory links', error);
    const { error: dropError } = await supabase
      .from('memory_entities')
      .delete()
      .eq('entity_id', sourceId)
      .in('memory_id', memoryIds);
    if (dropError) fail('clearing old memory links', dropError);
  }

  // 2. Reminders waiting on the source now wait on the target.
  const { error: remError } = await supabase
    .from('reminders')
    .update({ place_id: targetId })
    .eq('user_id', userId)
    .eq('place_id', sourceId);
  if (remError) fail('moving reminders', remError);

  // 3. Names that already meant the source now mean the target (one hop).
  const { error: chainError } = await supabase
    .from('entities')
    .update({ alias_of: targetId })
    .eq('user_id', userId)
    .eq('alias_of', sourceId);
  if (chainError) fail('moving aliases', chainError);

  // 4. The source becomes a name for the target: no shape, no star of its own.
  const { error: aliasError } = await supabase
    .from('entities')
    .update({ alias_of: targetId, lat: null, lng: null, radius_m: null, area: null, starred: false })
    .eq('user_id', userId)
    .eq('id', sourceId)
    .eq('kind', 'place');
  if (aliasError) fail('marking the alias', aliasError);
}
