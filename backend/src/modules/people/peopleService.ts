import { createCapture } from '../captures/captureService';
import { linkMemoryToEntities, resolveEntity } from '../entities/entityService';
import { createManualMemory } from '../memories/memoryService';
import { supabase } from '../../services/supabase';

/**
 * People are `entities` of kind 'person'. What Kandoo knows about each comes
 * from the join tables: memories through memory_entities, reminders through
 * reminder_entities. Notes are the captures those rows came from.
 *
 * The reminder-link queries are isolated in try/catch so that, before migration
 * 004 is applied (the reminder_entities table), People still lists with just
 * memories rather than failing outright.
 */

type MemoryRow = {
  id: string;
  content: string;
  person: string | null;
  created_at: string;
  capture_id: string | null;
};
type ReminderRow = {
  id: string;
  task: string;
  status: string;
  due_at: string | null;
  created_at: string;
  capture_id: string | null;
};

export type PersonSummary = {
  id: string;
  name: string;
  summary: string | null;
  memoryCount: number;
  reminderCount: number;
  noteCount: number;
  hasActiveReminder: boolean;
  lastMentionedAt: string;
};

export type PersonDetail = {
  id: string;
  name: string;
  memories: MemoryRow[];
  reminders: ReminderRow[];
  notes: { id: string; title: string | null; created_at: string }[];
};

export async function memoriesForEntities(
  userId: string,
  entityIds: string[]
): Promise<Map<string, MemoryRow[]>> {
  const byEntity = new Map<string, MemoryRow[]>();
  if (entityIds.length === 0) return byEntity;

  // Scope through the joined memory's owner. `!inner` drops any link whose memory
  // isn't the caller's, so even a foreign entity id can never surface another
  // user's memory content — service-role bypasses RLS, so this filter is the guard.
  const { data, error } = await supabase
    .from('memory_entities')
    .select('entity_id, memories!inner(id, content, person, created_at, capture_id)')
    .eq('memories.user_id', userId)
    .in('entity_id', entityIds);

  if (error) {
    console.error('People memory-link query failed:', error);
    return byEntity;
  }

  const links = (data ?? []) as unknown as {
    entity_id: string;
    memories: MemoryRow | MemoryRow[] | null;
  }[];
  for (const row of links) {
    const mem = Array.isArray(row.memories) ? row.memories[0] : row.memories;
    if (!mem) continue;
    const list = byEntity.get(row.entity_id) ?? [];
    list.push(mem);
    byEntity.set(row.entity_id, list);
  }
  return byEntity;
}

async function remindersForEntities(
  userId: string,
  entityIds: string[]
): Promise<Map<string, ReminderRow[]>> {
  const byEntity = new Map<string, ReminderRow[]>();
  if (entityIds.length === 0) return byEntity;

  try {
    // Same ownership scoping as memoriesForEntities: `!inner` on the caller's
    // reminders so a foreign entity id can't pull in another user's reminders.
    const { data, error } = await supabase
      .from('reminder_entities')
      .select(
        'entity_id, reminders!inner(id, task, status, due_at, created_at, capture_id)'
      )
      .eq('reminders.user_id', userId)
      .in('entity_id', entityIds);
    if (error) throw error;

    const links = (data ?? []) as unknown as {
      entity_id: string;
      reminders: ReminderRow | ReminderRow[] | null;
    }[];
    for (const row of links) {
      const rem = Array.isArray(row.reminders) ? row.reminders[0] : row.reminders;
      if (!rem) continue;
      const list = byEntity.get(row.entity_id) ?? [];
      list.push(rem);
      byEntity.set(row.entity_id, list);
    }
  } catch (error) {
    // reminder_entities not migrated yet — degrade to memories only.
    console.warn('People reminder-link query unavailable (migration 004?):', error);
  }
  return byEntity;
}

function isActive(r: ReminderRow): boolean {
  return (
    r.status === 'confirmed' &&
    (!r.due_at || new Date(r.due_at).getTime() > Date.now())
  );
}

function latest(memories: MemoryRow[], reminders: ReminderRow[]): string {
  const times = [
    ...memories.map((m) => m.created_at),
    ...reminders.map((r) => r.created_at),
  ];
  return times.sort().at(-1) ?? new Date(0).toISOString();
}

/** People list — one per person, ordered by most recently mentioned. */
export async function listPeople(userId: string): Promise<PersonSummary[]> {
  const { data: entities, error } = await supabase
    .from('entities')
    .select('id, name, created_at')
    .eq('user_id', userId)
    .eq('kind', 'person');

  if (error) {
    console.error('List people failed:', error);
    throw new Error('Failed to load people.');
  }

  const rows = (entities ?? []) as { id: string; name: string; created_at: string }[];
  if (rows.length === 0) return [];

  const ids = rows.map((e) => e.id);
  const [mems, rems] = await Promise.all([
    memoriesForEntities(userId, ids),
    remindersForEntities(userId, ids),
  ]);

  // noteCount must mean "captures that actually have a note", the same thing
  // getPerson counts — so the list and detail never disagree. Resolve which of
  // the referenced captures are noted in one query.
  const captureIdsFor = (entityId: string): string[] =>
    Array.from(
      new Set(
        [
          ...(mems.get(entityId) ?? []).map((m) => m.capture_id),
          ...(rems.get(entityId) ?? []).map((r) => r.capture_id),
        ].filter((c): c is string => !!c)
      )
    );
  const allCaptureIds = Array.from(new Set(ids.flatMap(captureIdsFor)));
  const notedCaptures = new Set<string>();
  if (allCaptureIds.length > 0) {
    const { data: caps } = await supabase
      .from('captures')
      .select('id')
      .eq('user_id', userId)
      .in('id', allCaptureIds)
      .not('note', 'is', null);
    for (const c of (caps ?? []) as { id: string }[]) notedCaptures.add(c.id);
  }

  const people: PersonSummary[] = rows.map((e) => {
    const memories = mems.get(e.id) ?? [];
    const reminders = rems.get(e.id) ?? [];
    const recent = [...memories].sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    )[0];
    const noteCount = captureIdsFor(e.id).filter((c) => notedCaptures.has(c)).length;
    return {
      id: e.id,
      name: e.name,
      summary: recent?.content ?? null,
      memoryCount: memories.length,
      reminderCount: reminders.length,
      noteCount,
      hasActiveReminder: reminders.some(isActive),
      // Someone added by hand with nothing said yet sorts by when they were added.
      lastMentionedAt: memories.length || reminders.length ? latest(memories, reminders) : e.created_at,
    };
  });

  people.sort((a, b) => b.lastMentionedAt.localeCompare(a.lastMentionedAt));
  return people;
}

/** One person: their memories, reminders, and the notes they were mentioned in. */
export async function getPerson(
  userId: string,
  personId: string
): Promise<PersonDetail | null> {
  const { data: entity, error } = await supabase
    .from('entities')
    .select('id, name')
    .eq('user_id', userId)
    .eq('id', personId)
    .eq('kind', 'person')
    .maybeSingle();

  if (error) {
    console.error('Get person failed:', error);
    throw new Error('Failed to load that person.');
  }
  if (!entity) return null;

  const [mems, rems] = await Promise.all([
    memoriesForEntities(userId, [personId]),
    remindersForEntities(userId, [personId]),
  ]);
  const memories = (mems.get(personId) ?? []).sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );
  const reminders = (rems.get(personId) ?? []).sort((a, b) =>
    (a.due_at ?? a.created_at).localeCompare(b.due_at ?? b.created_at)
  );

  const captureIds = Array.from(
    new Set(
      [
        ...memories.map((m) => m.capture_id),
        ...reminders.map((r) => r.capture_id),
      ].filter((c): c is string => !!c)
    )
  );

  let notes: PersonDetail['notes'] = [];
  if (captureIds.length > 0) {
    const { data: caps } = await supabase
      .from('captures')
      .select('id, note, created_at')
      .eq('user_id', userId)
      .in('id', captureIds)
      .not('note', 'is', null)
      .order('created_at', { ascending: false });
    notes = ((caps ?? []) as { id: string; note: { title?: string } | null; created_at: string }[]).map(
      (c) => ({ id: c.id, title: c.note?.title ?? null, created_at: c.created_at })
    );
  }

  return {
    id: (entity as { id: string }).id,
    name: (entity as { name: string }).name,
    memories,
    reminders,
    notes,
  };
}

/**
 * Merge people. The survivor keeps everything; the others' memory and reminder
 * links move onto it and the other entities are deleted (which cascades away
 * their now-duplicate links). The legacy person text is updated to the
 * survivor's name so detail rows read consistently.
 */
export async function mergePeople(
  userId: string,
  survivorId: string,
  otherIds: string[]
): Promise<void> {
  const others = otherIds.filter((id) => id && id !== survivorId);
  if (others.length === 0) return;

  const { data: survivor } = await supabase
    .from('entities')
    .select('id, name')
    .eq('user_id', userId)
    .eq('id', survivorId)
    .eq('kind', 'person')
    .maybeSingle();
  if (!survivor) throw new Error('Survivor person not found.');
  const survivorName = (survivor as { name: string }).name;

  // Validate EVERY other id belongs to the caller before any read or write —
  // not just the final delete. Otherwise a request could pass another user's
  // entity ids and have their memory links moved onto, and content exposed
  // under, the caller's survivor (service-role bypasses RLS). If any id isn't
  // the caller's, reject the whole merge rather than operate on a subset.
  const { data: ownedRows } = await supabase
    .from('entities')
    .select('id')
    .eq('user_id', userId)
    .eq('kind', 'person')
    .in('id', others);
  const owned = new Set(((ownedRows ?? []) as { id: string }[]).map((r) => r.id));
  if (owned.size !== others.length) {
    throw new Error('Those people are not yours to merge.');
  }

  // Every link must land on the survivor BEFORE the merged-away entities are
  // deleted: that delete cascades to their links, so a move that failed
  // silently would lose them for good (AGENTS §3.7). Supabase returns errors
  // rather than throwing, so each result is checked and any failure aborts the
  // merge with nothing deleted.
  const fail = (step: string, error: unknown): never => {
    console.error(`Merge ${step} failed:`, error);
    throw new Error('Failed to merge people.');
  };

  // Move memory links.
  const { data: mLinks, error: mLinksError } = await supabase
    .from('memory_entities')
    .select('memory_id')
    .in('entity_id', others);
  if (mLinksError) fail('reading memory links', mLinksError);
  const memoryIds = Array.from(
    new Set(((mLinks ?? []) as { memory_id: string }[]).map((r) => r.memory_id))
  );
  if (memoryIds.length > 0) {
    const { error: linkError } = await supabase
      .from('memory_entities')
      .upsert(
        memoryIds.map((memory_id) => ({ memory_id, entity_id: survivorId })),
        { onConflict: 'memory_id,entity_id', ignoreDuplicates: true }
      );
    if (linkError) fail('moving memory links', linkError);

    const { error: nameError } = await supabase
      .from('memories')
      .update({ person: survivorName })
      .eq('user_id', userId)
      .in('id', memoryIds);
    if (nameError) fail('renaming on memories', nameError);
  }

  // Move reminder links. Only a missing table (migration 004 not applied) is
  // skipped; any other error aborts like the memory links above.
  const { data: rLinks, error: rLinksError } = await supabase
    .from('reminder_entities')
    .select('reminder_id')
    .in('entity_id', others);
  if (rLinksError && rLinksError.code === '42P01') {
    console.warn('Merge reminder links skipped (migration 004 not applied).');
  } else {
    if (rLinksError) fail('reading reminder links', rLinksError);
    const reminderIds = Array.from(
      new Set(((rLinks ?? []) as { reminder_id: string }[]).map((r) => r.reminder_id))
    );
    if (reminderIds.length > 0) {
      const { error: linkError } = await supabase
        .from('reminder_entities')
        .upsert(
          reminderIds.map((reminder_id) => ({ reminder_id, entity_id: survivorId })),
          { onConflict: 'reminder_id,entity_id', ignoreDuplicates: true }
        );
      if (linkError) fail('moving reminder links', linkError);

      const { error: nameError } = await supabase
        .from('reminders')
        .update({ person: survivorName })
        .eq('user_id', userId)
        .in('id', reminderIds);
      if (nameError) fail('renaming on reminders', nameError);
    }
  }

  // Delete the merged-away entities; cascade removes their old links.
  const { error: delError } = await supabase
    .from('entities')
    .delete()
    .eq('user_id', userId)
    .eq('kind', 'person')
    .in('id', others);
  if (delError) {
    console.error('Merge delete failed:', delError);
    throw new Error('Failed to merge people.');
  }
}

/** Delete a person entity. Cascade drops the links; the memories/reminders
 *  themselves survive, just no longer attributed to anyone. */
export async function deletePerson(userId: string, personId: string): Promise<void> {
  const { error } = await supabase
    .from('entities')
    .delete()
    .eq('user_id', userId)
    .eq('id', personId)
    .eq('kind', 'person');

  if (error) {
    console.error('Delete person failed:', error);
    throw new Error('Failed to delete that person.');
  }
}

/**
 * Add a person by hand from People, with optional things to remember about
 * them. A name Kandoo already knows returns that person (people are deduped
 * per user), so adding "Kofi" twice never makes two Kofis. Each fact becomes a
 * memory linked to the person — embedded, so recall finds it.
 */
export async function addPerson(
  userId: string,
  name: string,
  facts: string[],
  opts: { clientTime: string; timezone: string }
): Promise<{ id: string; name: string; existed: boolean; memoriesAdded: number }> {
  const before = await supabase
    .from('entities')
    .select('id')
    .eq('user_id', userId)
    .eq('kind', 'person')
    .ilike('name', name.trim());
  const existed = (before.data ?? []).length > 0;

  const person = await resolveEntity(userId, 'person', name);
  if (!person) throw new Error('A person needs a name.');

  let memoriesAdded = 0;
  if (facts.length > 0) {
    const capture = await createCapture(userId, {
      // Recently shows this line: say who it's about ("Esi — likes jollof").
      text: `${person.name} — ${facts.join('; ')}`,
      clientTime: opts.clientTime,
      timezone: opts.timezone,
      source: 'manual',
    });
    const first = person.name.split(/\s+/)[0].toLowerCase();
    for (const fact of facts) {
      // Keep each memory meaningful on its own: "likes tea" → "Kofi likes tea",
      // "Birthday is 12 May" → "Kofi: Birthday is 12 May".
      const content = fact.toLowerCase().includes(first)
        ? fact
        : /^[a-z]/.test(fact)
          ? `${person.name} ${fact}`
          : `${person.name}: ${fact}`;
      const memory = await createManualMemory(userId, capture.id, content, person.name);
      await linkMemoryToEntities(memory.id, [person.id]);
      memoriesAdded += 1;
    }
  }
  return { id: person.id, name: person.name, existed, memoriesAdded };
}
