import { router } from 'expo-router';

import { answerWhereAmI } from '@/features/places/whereAmI';
import { monthWindow } from '@/features/places/monthRecap';
import { searchPlaces } from '@/features/places/searchPlaces';
import {
  addMemoryToCapture,
  agentSearch,
  clearPlaceArea,
  createLibraryCategory,
  createLibraryNote,
  createManualCapture,
  createManualReminder,
  createPlace,
  deleteCaptureById,
  deleteMemoryById,
  deletePlace,
  deleteReminderById,
  fetchCaptureNote,
  fetchCaptureNotes,
  fetchGroupedReminders,
  fetchLibrary,
  fetchLibraryCategory,
  fetchMonthInsights,
  fetchPeople,
  fetchPerson,
  fetchPlace,
  fetchPhotos,
  fetchPlaces,
  isProRequired,
  mergePeople,
  mergePlaceInto,
  readDocument,
  researchTopic,
  setPlaceStarred,
  updateCaptureNote,
  updateMemory,
  updatePlace,
  updateReminder,
  userMessage,
  writeResearch,
  type CreatedReminder,
  type ResearchResult,
} from '@/services/interpretationService';
import { cancelReminder, scheduleReminder, snoozeRepeatingOnce } from '@/services/localNotifications';
import { PhotoPermissionError, pickPhoto } from '@/services/photos';
import { readTier } from '@/services/purchases';
import { isRepeating } from '@/utils/repeat';
import { requestPlaceResync } from '@/services/places/placeStore';
import { MIN_RADIUS_M, placeGeometry, type LatLng } from '@/utils/geo';
import * as Location from 'expo-location';

import { showPhotos } from './agentShown';

import {
  describeDraft,
  discardDraft,
  proposeDraft,
  saveDraft,
  type DraftCommit,
  type DraftField,
  type DraftShape,
} from './agentDrafts';

/**
 * Kandoo Agent's hands. Every tool is a thin wrapper over the SAME function the
 * app's own buttons call, plus what the button does next (schedule the
 * notification on the phone, re-sync watched places) — so the agent can do
 * anything the user can, through the app's own rules (AGENTS §3.1: the model
 * decides, Kandoo's code acts).
 *
 * Nothing is saved on the agent's word alone (AGENTS §3.3). Every change is
 * PROPOSED as a card the user sees and can edit (agentDrafts.ts); it saves on
 * the user's yes (save_draft) or their tap on Save. Reading stays instant.
 *
 * Rules enforced HERE, not only in the prompt:
 *   - save_draft only works after the user has spoken since the card appeared;
 *   - no purchases, account or permission changes exist as tools at all;
 *   - errors come back as plain words the agent can say, never internals.
 *
 * Every tool returns a short JSON string: the agent reads it, the user never
 * sees it. Ids go in so the agent can act on the right item; times go out as
 * ISO for it to phrase naturally.
 */

type Params = Record<string, unknown>;
type Tool = (params: Params) => Promise<string>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const iso = (v: unknown): string | null => {
  const s = str(v);
  return s && !Number.isNaN(Date.parse(s)) ? s : null;
};
const days = (v: unknown): number[] | null =>
  Array.isArray(v) && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) ? (v as number[]) : null;

const ok = (data: unknown) => JSON.stringify({ ok: true, ...(data as object) });
const fail = (message: string) => JSON.stringify({ ok: false, error: message });

/** Show a card; the agent asks, and saves only on the user's yes. */
function propose(
  tool: string,
  title: string,
  fields: (DraftField | null)[],
  commit: DraftCommit,
  opts: { destructive?: boolean; shape?: DraftShape | null } = {}
): string {
  const draft = proposeDraft({
    tool,
    title,
    destructive: opts.destructive ?? false,
    fields: fields.filter((f): f is DraftField => f !== null),
    shape: opts.shape ?? null,
    commit,
  });
  return ok({
    awaitingYes: true,
    ...describeDraft(draft),
    next: 'Not saved yet. The card is on screen: ask briefly if it looks right. Yes → save_draft. A change → discard_draft, then propose again.',
  });
}

const field = (key: string, label: string, value: string | null, kind: DraftField['kind'] = 'text', editable = true): DraftField => ({
  key,
  label,
  value,
  kind,
  editable,
});
const shown = (key: string, label: string, value: string | null): DraftField | null =>
  value ? field(key, label, value, 'text', false) : null;

/** Names the agent has already seen, so a card can say WHAT it will change. */
const seen = new Map<string, string>();
const remember = (id: string, label: string | null | undefined) => {
  if (id && label) seen.set(id, label);
};

function shapeOf(p: { center: LatLng | null; radiusM: number | null; area: LatLng[] | null }): DraftShape | null {
  return p.center && p.radiusM ? { center: p.center, radiusM: p.radiusM, area: p.area } : null;
}

/** The drawn outline of a place the user named, for the card's map. */
async function placeShapeNamed(name: string | null): Promise<DraftShape | null> {
  if (!name) return null;
  const places = await fetchPlaces().catch(() => []);
  const n = name.toLowerCase();
  const hit = places.find((x) => x.name.toLowerCase() === n || x.aliases?.some((a) => a.toLowerCase() === n));
  return hit ? shapeOf(hit) : null;
}

/** Tool errors become one sentence the agent can say out loud. */
function guard(tool: Tool): Tool {
  return async (params) => {
    try {
      return await tool(params ?? {});
    } catch (error) {
      if (isProRequired(error)) return fail('That needs Kandoo Pro.');
      console.warn('Agent tool failed:', error);
      return fail(userMessage(error, 'That did not work just now. Please try again.'));
    }
  };
}

function compactReminder(r: CreatedReminder) {
  return {
    id: r.id,
    task: r.task,
    dueAt: r.due_at,
    person: r.person,
    place: r.place_hint,
    trigger: r.place_hint && !r.due_at ? r.place_trigger ?? 'arrive' : undefined,
    notBefore: r.not_before ?? undefined,
    repeatDays: r.repeat_days ?? undefined,
    status: r.status,
  };
}

// Cast: typed routes regenerate only when Metro runs.
const go = (pathname: string, params?: Record<string, string>) =>
  router.navigate({ pathname: pathname as never, params });

/** Research kept for this conversation, so a write-up quotes the exact sources. */
const research = new Map<string, ResearchResult>();
let researchCounter = 0;
let lastResearchId: string | null = null;

/** A Library category by name, ignoring case. */
async function findShelf(name: string) {
  const shelves = await fetchLibrary();
  return shelves.find((c) => c.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
}

/**
 * Save an approved note card into the Library: on the shelf its category field
 * names NOW (the user may have edited it), making that category only if it
 * doesn't exist yet.
 */
async function fileNote(
  v: Record<string, string | null>,
  source: 'manual' | 'document' | 'research'
): ReturnType<DraftCommit> {
  const body = v.body?.trim();
  const name = v.category?.trim();
  if (!body || !name) throw new Error('empty');
  const existing = await findShelf(name);
  const shelf = existing ?? (await createLibraryCategory(name));
  const note = await createLibraryNote(shelf.id, { title: v.title?.trim() || null, body }, source);
  return {
    result: { filedIn: shelf.name, newCategory: !existing, noteId: note.id },
    open: { pathname: '/memory', params: { view: 'library' } },
  };
}

/** Found by find_place, drawn by draw_place — kept between the two calls. */
let lastFound: { id: string; name: string; center: LatLng; bounds: [number, number, number, number] | null }[] = [];

async function here(): Promise<LatLng | null> {
  const permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) return null;
  const fix =
    (await Location.getLastKnownPositionAsync({ maxAge: 120_000 }).catch(() => null)) ??
    (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null));
  return fix ? { lat: fix.coords.latitude, lng: fix.coords.longitude } : null;
}

export const kandooTools: Record<string, Tool> = {
  // ---------------------------------------------------------------- drafts
  save_draft: guard(async (p) => {
    const id = str(p.draft_id);
    if (!id) return fail('Which card? Use its draft_id.');
    const outcome = await saveDraft(id, 'agent');
    if (!outcome.ok) return fail(outcome.error);
    return ok({ saved: true, alreadySavedByUser: outcome.alreadySaved ?? false, ...outcome.result });
  }),

  discard_draft: guard(async (p) => {
    const id = str(p.draft_id);
    if (!id) return fail('Which card? Use its draft_id.');
    return discardDraft(id) ? ok({ discarded: id }) : fail('That card is already saved or gone.');
  }),

  // ---------------------------------------------------------------- memory
  search_memory: guard(async (p) => {
    const query = str(p.query);
    if (!query) return fail('Say what to look for.');
    const matches = await agentSearch(query);
    matches.forEach((m) => remember(m.id, m.content));
    return ok({ matches: matches.slice(0, 6) });
  }),

  add_memory: guard(async (p) => {
    const content = str(p.content);
    if (!content) return fail('Say what to remember.');
    const noteId = str(p.note_id);
    return propose('add_memory', 'Remember', [field('content', 'Memory', content, 'long')], async (v) => {
      const text = v.content?.trim();
      if (!text) throw new Error('empty');
      if (noteId) {
        await addMemoryToCapture(noteId, text);
        return { result: { remembered: text }, open: { pathname: '/memory' } };
      }
      const capture = await createManualCapture({ memory: { content: text } }, { clientTime: new Date().toISOString() });
      return { result: { remembered: text, memoryId: capture?.memories?.[0]?.id ?? null }, open: { pathname: '/memory' } };
    });
  }),

  edit_memory: guard(async (p) => {
    const id = str(p.memory_id);
    const content = str(p.content);
    if (!id || !content) return fail('Need the memory and its new wording.');
    return propose(
      'edit_memory',
      'Change memory',
      [shown('was', 'Was', seen.get(id) ?? null), field('content', 'Now', content, 'long')],
      async (v) => {
        const text = v.content?.trim();
        if (!text) throw new Error('empty');
        await updateMemory(id, text);
        remember(id, text);
        return { result: { updated: id, content: text }, open: { pathname: '/memory' } };
      }
    );
  }),

  delete_memory: guard(async (p) => {
    const id = str(p.memory_id);
    if (!id) return fail('Which memory?');
    return propose(
      'delete_memory',
      'Delete memory',
      [shown('memory', 'Memory', seen.get(id) ?? 'This memory')],
      async () => {
        await deleteMemoryById(id);
        return { result: { deleted: id } };
      },
      { destructive: true }
    );
  }),

  // ---------------------------------------------------------------- notes
  list_notes: guard(async (p) => {
    const limit = Math.min(Math.max(num(p.limit) ?? 8, 1), 20);
    const captures = await fetchCaptureNotes({ limit, requireContent: true });
    captures.forEach((c) => remember(c.id, c.note?.title ?? c.text.slice(0, 60)));
    return ok({
      notes: captures.map((c) => ({
        id: c.id,
        title: c.note?.title ?? null,
        preview: (c.note?.body ?? c.text).slice(0, 140),
        memories: c.memories.length,
        reminders: c.reminders.length,
        createdAt: c.created_at,
      })),
    });
  }),

  read_note: guard(async (p) => {
    const id = str(p.note_id);
    if (!id) return fail('Which note?');
    const note = await fetchCaptureNote(id);
    if (!note) return fail('That note is no longer there.');
    remember(note.id, note.note?.title ?? note.text.slice(0, 60));
    note.memories.forEach((m) => remember(m.id, m.content));
    note.reminders.forEach((r) => remember(r.id, r.task));
    return ok({
      id: note.id,
      title: note.note?.title ?? null,
      body: note.note?.body ?? note.text,
      memories: note.memories.map((m) => ({ id: m.id, content: m.content })),
      reminders: note.reminders.map((r) => ({ id: r.id, task: r.task, dueAt: r.due_at, status: r.status })),
      createdAt: note.created_at,
    });
  }),

  create_note: guard(async (p) => {
    const body = str(p.body);
    if (!body) return fail('Say what the note should say.');
    const title = str(p.title) ?? body.split(/[.!?]/)[0].slice(0, 60);
    return propose(
      'create_note',
      'New note',
      [field('title', 'Title', title), field('body', 'Note', body, 'long')],
      async (v) => {
        const text = v.body?.trim();
        if (!text) throw new Error('empty');
        const capture = await createManualCapture(
          { note: { title: v.title?.trim() || text.split(/[.!?]/)[0].slice(0, 60), body: text } },
          { clientTime: new Date().toISOString() }
        );
        return { result: { noteId: capture?.id ?? null }, open: { pathname: '/memory' } };
      }
    );
  }),

  edit_note: guard(async (p) => {
    const id = str(p.note_id);
    if (!id) return fail('Which note?');
    const current = await fetchCaptureNote(id);
    if (!current) return fail('That note is no longer there.');
    const title = str(p.title) ?? current.note?.title ?? 'A note';
    const body = str(p.body) ?? current.note?.body ?? current.text;
    return propose(
      'edit_note',
      'Edit note',
      [field('title', 'Title', title), field('body', 'Note', body, 'long')],
      async (v) => {
        await updateCaptureNote(id, { title: v.title?.trim() || title, body: v.body?.trim() || body });
        return { result: { updated: id }, open: { pathname: '/memory' } };
      }
    );
  }),

  delete_note: guard(async (p) => {
    const id = str(p.note_id);
    if (!id) return fail('Which note?');
    const note = await fetchCaptureNote(id).catch(() => null);
    return propose(
      'delete_note',
      'Delete note',
      [shown('note', 'Note', note?.note?.title ?? note?.text.slice(0, 80) ?? seen.get(id) ?? 'This note')],
      async () => {
        await deleteCaptureById(id);
        return { result: { deleted: id } };
      },
      { destructive: true }
    );
  }),

  // ---------------------------------------------------------------- reminders
  list_reminders: guard(async () => {
    const g = await fetchGroupedReminders();
    [...g.needsReview, ...g.active, ...g.history].forEach((r) => remember(r.id, r.task));
    return ok({
      needsReview: g.needsReview.slice(0, 10).map(compactReminder),
      active: g.active.slice(0, 20).map(compactReminder),
      recentlyDone: g.history.slice(0, 5).map(compactReminder),
    });
  }),

  create_reminder: guard(async (p) => {
    const task = str(p.task);
    if (!task) return fail('Say what the reminder is for.');
    const dueAt = iso(p.due_at);
    const placeName = dueAt ? null : str(p.place_name);
    if (!dueAt && !placeName) return fail('A reminder needs a time or a place.');
    const trigger = p.trigger === 'leave' ? 'leave' : 'arrive';
    const notBefore = iso(p.not_before);
    const repeatDays = days(p.repeat_days);
    return propose(
      'create_reminder',
      'New reminder',
      [
        field('task', 'Reminder', task),
        dueAt ? field('dueAt', 'When', dueAt, 'time') : null,
        placeName ? field('place', trigger === 'leave' ? 'When you leave' : 'When you arrive at', placeName) : null,
        placeName && notBefore ? field('notBefore', 'Not before', notBefore, 'time', false) : null,
        field('person', 'With', str(p.person)),
      ],
      async (v) => {
        const reminder = await createManualReminder({
          task: v.task?.trim() || task,
          dueAt: dueAt ? v.dueAt ?? dueAt : null,
          person: v.person?.trim() || null,
          repeatDays,
          placeName: placeName ? v.place?.trim() || placeName : null,
          placeTrigger: trigger,
          notBefore,
        });
        // The phone owns the trigger (§3.2): a time goes to the alarm, a place to the geofences.
        await scheduleReminder(reminder);
        remember(reminder.id, reminder.task);
        return { result: { reminder: compactReminder(reminder) }, open: { pathname: '/reminders' } };
      },
      { shape: await placeShapeNamed(placeName) }
    );
  }),

  update_reminder: guard(async (p) => {
    const id = str(p.reminder_id);
    if (!id) return fail('Which reminder?');
    const g = await fetchGroupedReminders();
    const current = [...g.active, ...g.needsReview, ...g.history].find((r) => r.id === id);
    if (!current) return fail('That reminder is no longer there.');
    const newDue = iso(p.due_at);
    const repeat = p.repeat_days !== undefined ? days(p.repeat_days) : undefined;
    if (!str(p.task) && !newDue && p.person === undefined && repeat === undefined) return fail('Nothing to change.');
    return propose(
      'update_reminder',
      'Change reminder',
      [
        field('task', 'Reminder', str(p.task) ?? current.task),
        newDue || current.due_at ? field('dueAt', 'When', newDue ?? current.due_at, 'time') : null,
        field('person', 'With', p.person !== undefined ? str(p.person) : current.person),
      ],
      async (v) => {
        const patch: Parameters<typeof updateReminder>[1] = {};
        if (v.task && v.task.trim() !== current.task) patch.task = v.task.trim();
        if (v.dueAt && v.dueAt !== current.due_at) patch.dueAt = v.dueAt;
        if ((v.person?.trim() || null) !== (current.person ?? null)) patch.person = v.person?.trim() || null;
        if (repeat !== undefined) patch.repeatDays = repeat;
        const updated = Object.keys(patch).length ? await updateReminder(id, patch) : current;
        await scheduleReminder(updated);
        return { result: { reminder: compactReminder(updated) }, open: { pathname: '/reminders' } };
      }
    );
  }),

  complete_reminder: guard(async (p) => {
    const id = str(p.reminder_id);
    if (!id) return fail('Which reminder?');
    return propose('complete_reminder', 'Mark done', [shown('task', 'Reminder', seen.get(id) ?? 'This reminder')], async () => {
      await updateReminder(id, { status: 'fired' });
      await cancelReminder(id);
      return { result: { done: id }, open: { pathname: '/reminders' } };
    });
  }),

  snooze_reminder: guard(async (p) => {
    const id = str(p.reminder_id);
    const minutes = num(p.minutes) ?? 15;
    if (!id) return fail('Which reminder?');
    return propose(
      'snooze_reminder',
      'Snooze',
      [shown('task', 'Reminder', seen.get(id) ?? 'This reminder'), shown('for', 'For', `${minutes} minutes`)],
      async () => {
        // A repeating reminder snoozes ONCE, as the app's own Snooze does — moving
        // due_at would shift every future repeat.
        const g = await fetchGroupedReminders();
        const current = [...g.active, ...g.needsReview].find((r) => r.id === id);
        if (current && isRepeating(current.repeat_days)) {
          await snoozeRepeatingOnce(
            { reminderId: id, title: current.task, body: current.person ? `With ${current.person}` : 'Kandoo reminder', insistent: current.insistent },
            minutes
          );
          return { result: { snoozedOnce: id, minutes } };
        }
        const dueAt = new Date(Date.now() + minutes * 60_000).toISOString();
        const updated = await updateReminder(id, { dueAt, status: 'confirmed' });
        await scheduleReminder(updated);
        return { result: { reminder: compactReminder(updated) }, open: { pathname: '/reminders' } };
      }
    );
  }),

  delete_reminder: guard(async (p) => {
    const id = str(p.reminder_id);
    if (!id) return fail('Which reminder?');
    return propose(
      'delete_reminder',
      'Delete reminder',
      [shown('task', 'Reminder', seen.get(id) ?? 'This reminder')],
      async () => {
        await deleteReminderById(id);
        await cancelReminder(id);
        return { result: { deleted: id } };
      },
      { destructive: true }
    );
  }),

  // ---------------------------------------------------------------- people
  list_people: guard(async () => {
    const people = await fetchPeople();
    people.forEach((x) => remember(x.id, x.name));
    return ok({
      people: people.slice(0, 30).map((x) => ({
        id: x.id,
        name: x.name,
        memories: x.memoryCount,
        reminders: x.reminderCount,
        latest: x.summary,
      })),
    });
  }),

  get_person: guard(async (p) => {
    const id = str(p.person_id);
    if (!id) return fail('Which person?');
    const person = await fetchPerson(id);
    if (!person) return fail('That person is no longer there.');
    remember(person.id, person.name);
    person.memories.forEach((m) => remember(m.id, m.content));
    person.reminders.forEach((r) => remember(r.id, r.task));
    return ok({
      id: person.id,
      name: person.name,
      memories: person.memories.slice(0, 12).map((m) => ({ id: m.id, content: m.content, savedAt: m.created_at })),
      reminders: person.reminders.slice(0, 10).map((r) => ({ id: r.id, task: r.task, dueAt: r.due_at, status: r.status })),
    });
  }),

  merge_people: guard(async (p) => {
    const keep = str(p.keep_person_id);
    const others = Array.isArray(p.merge_person_ids) ? ((p.merge_person_ids as unknown[]).map(str).filter(Boolean) as string[]) : [];
    if (!keep || others.length === 0) return fail('Say who to keep and who to fold in.');
    return propose(
      'merge_people',
      'Merge people',
      [
        shown('keep', 'Keep', seen.get(keep) ?? 'This person'),
        shown('fold', 'Fold in', others.map((o) => seen.get(o) ?? 'another person').join(', ')),
      ],
      async () => {
        await mergePeople(keep, others);
        return { result: { kept: keep, merged: others }, open: { pathname: '/people' } };
      },
      { destructive: true }
    );
  }),

  // ---------------------------------------------------------------- photos
  /**
   * Show Kandoo's photo library: find photos by what they are ("the flyer"),
   * or everyone/everywhere they belong to. The photos appear in the
   * conversation, where the user can open and share them.
   */
  find_photos: guard(async (p) => {
    const entityId = str(p.person_id) ?? str(p.place_id);
    const query = str(p.query);
    let photos = await fetchPhotos({ entityId: entityId ?? undefined, query: query ?? undefined, limit: 8 });
    // A description rarely uses the user's exact words: with nothing matched
    // for a search, show the newest photos and let Kandoo say so.
    let matched = true;
    if (photos.length === 0 && query && !entityId) {
      photos = await fetchPhotos({ limit: 6 });
      matched = false;
    }
    const shown = photos.filter((photo) => photo.url);
    showPhotos(shown);
    shown.forEach((photo) => remember(photo.id, photo.description ?? 'a photo'));
    return ok({
      matched,
      shownOnScreen: shown.length,
      photos: shown.map((photo) => ({
        id: photo.id,
        description: photo.description,
        people: photo.people.map((x) => x.name),
        places: photo.places.map((x) => x.name),
        keptAt: photo.createdAt,
      })),
    });
  }),

  // ---------------------------------------------------------------- library
  /**
   * Elite: photograph a page (notes, a document, slides, a whiteboard) and
   * propose it as ONE Library note — the insights organised, filed in the
   * category the user named or the one the page belongs in. Nothing is saved
   * until the user says yes (or taps Save); a new category is made only then.
   */
  read_document: guard(async (p) => {
    // A quick check on the phone so nobody photographs a page for nothing;
    // the server enforces Elite either way (402), and an unknown tier (offline)
    // is left to it.
    const tier = await readTier().catch(() => null);
    if (tier === 'free' || tier === 'pro') {
      return fail('Reading pages into the Library is part of Kandoo Elite.');
    }

    const source = str(p.source) === 'gallery' ? 'library' : 'camera';
    const asked = str(p.category_name);
    let photo;
    try {
      photo = await pickPhoto(source);
    } catch (error) {
      if (error instanceof PhotoPermissionError) {
        return fail('The camera is off for Kandoo. They can allow it in Settings, or choose the photo from the gallery instead.');
      }
      throw error;
    }
    if (!photo) return fail('No photo was taken, so there is nothing to read yet.');

    let reading;
    try {
      reading = await readDocument(photo, asked);
    } catch (error) {
      if (isProRequired(error)) return fail('Reading pages into the Library is part of Kandoo Elite.');
      throw error;
    }

    const isNew = !reading.categoryId;
    return propose(
      'read_document',
      'New library note',
      [
        field('category', isNew ? 'Category (new)' : 'Category', reading.categoryName),
        field('title', 'Title', reading.title),
        field('body', 'Note', reading.body, 'long'),
      ],
      async (v) => {
        const body = v.body?.trim();
        const name = v.category?.trim();
        if (!body || !name) throw new Error('empty');
        // The user may have renamed the category on the card: file it on the
        // shelf that name matches now, making it only if it doesn't exist.
        const shelves = await fetchLibrary();
        const shelf =
          shelves.find((c) => c.name.toLowerCase() === name.toLowerCase()) ??
          (await createLibraryCategory(name));
        const note = await createLibraryNote(
          shelf.id,
          { title: v.title?.trim() || null, body },
          'document'
        );
        return {
          result: { filedIn: shelf.name, newCategory: !shelves.some((c) => c.id === shelf.id), noteId: note.id },
          open: { pathname: '/memory', params: { view: 'library' } },
        };
      }
    );
  }),

  /** The user's Library categories, so Mr. Kandoo can talk about their projects. */
  list_library: guard(async () => {
    const shelves = await fetchLibrary();
    return ok({
      categories: shelves.map((c) => ({ name: c.name, notes: c.noteCount, updatedAt: c.updated_at })),
    });
  }),

  /** What is in one category: its notes (trimmed), newest first. */
  read_library_category: guard(async (p) => {
    const name = str(p.category_name);
    if (!name) return fail('Which category?');
    const shelf = await findShelf(name);
    if (!shelf) return fail(`There is no category called ${name}. list_library shows the ones they have.`);
    const { notes } = await fetchLibraryCategory(shelf.id);
    return ok({
      category: shelf.name,
      notes: notes.slice(0, 15).map((n) => ({
        title: n.title,
        text: n.body.length > 1200 ? `${n.body.slice(0, 1200)}…` : n.body,
        kind: n.source,
        updatedAt: n.updated_at,
      })),
      more: Math.max(0, notes.length - 15),
    });
  }),

  /**
   * Elite: research a question from real sources (Wikipedia, scholarly papers),
   * optionally in the light of one category's notes. Nothing is written until
   * the user asks (write_research_note).
   */
  research_topic: guard(async (p) => {
    const question = str(p.question);
    if (!question) return fail('What should I research?');
    const tier = await readTier().catch(() => null);
    if (tier === 'free' || tier === 'pro') return fail('Research with Mr. Kandoo is part of Kandoo Elite.');
    let result: ResearchResult;
    try {
      result = await researchTopic(question, str(p.category_name));
    } catch (error) {
      if (isProRequired(error)) return fail('Research with Mr. Kandoo is part of Kandoo Elite.');
      throw error;
    }
    const id = `r${++researchCounter}`;
    research.set(id, result);
    lastResearchId = id;
    return ok({
      research_id: id,
      grounded: result.grounded,
      say: result.spoken,
      forCategory: result.category,
      findings: result.findings,
      sources: result.sources.map((s, i) => `[${i + 1}] ${s.title}${s.year ? ` (${s.year})` : ''} — ${s.publisher ?? s.kind}`),
      next: result.grounded
        ? 'Tell them the gist in your own words. When they ask, write_research_note with this research_id and the format they want.'
        : 'No sources were found: say so. Do not answer from your own knowledge as if it were research.',
    });
  }),

  /** Elite: write the research up as a Library note, in the format asked for, with references. */
  write_research_note: guard(async (p) => {
    const id = str(p.research_id) ?? lastResearchId;
    const result = id ? research.get(id) : undefined;
    if (!result) return fail('There is no research to write up yet. Use research_topic first.');
    if (!result.grounded) return fail('That research found no sources, so there is nothing reliable to write up.');
    const format = (['points', 'structured', 'summary', 'report'] as const).find((f) => f === str(p.format)) ?? 'structured';
    let note: { title: string; body: string };
    try {
      note = await writeResearch(result, format);
    } catch (error) {
      if (isProRequired(error)) return fail('Research with Mr. Kandoo is part of Kandoo Elite.');
      throw error;
    }
    const shelfName = str(p.category_name) ?? result.category ?? 'Research';
    const existing = await findShelf(shelfName);
    return propose(
      'write_research_note',
      'Write up research',
      [
        field('category', existing ? 'Category' : 'Category (new)', existing?.name ?? shelfName),
        field('title', 'Title', note.title),
        field('body', 'Note', note.body, 'long'),
      ],
      (v) => fileNote(v, 'research')
    );
  }),

  /** Write something down in the Library (dictated, or Mr. Kandoo's own answer). */
  write_library_note: guard(async (p) => {
    const body = str(p.body);
    const name = str(p.category_name);
    if (!body || !name) return fail('Need the category and what to write.');
    const existing = await findShelf(name);
    return propose(
      'write_library_note',
      'New library note',
      [
        field('category', existing ? 'Category' : 'Category (new)', existing?.name ?? name),
        field('title', 'Title', str(p.title)),
        field('body', 'Note', body, 'long'),
      ],
      (v) => fileNote(v, 'manual')
    );
  }),

  // ---------------------------------------------------------------- places
  list_places: guard(async () => {
    const places = await fetchPlaces();
    places.forEach((x) => remember(x.id, x.name));
    return ok({
      places: places.map((x) => ({
        id: x.id,
        name: x.name,
        drawn: !!x.center,
        starred: !!x.starred,
        alsoCalled: x.aliases ?? [],
        memories: x.memoryCount,
        waiting: x.waitingCount,
      })),
    });
  }),

  get_place: guard(async (p) => {
    const id = str(p.place_id);
    if (!id) return fail('Which place?');
    const place = await fetchPlace(id);
    if (!place) return fail('That place is no longer there.');
    remember(place.id, place.name);
    place.memories.forEach((m) => remember(m.id, m.content));
    return ok({
      id: place.id,
      name: place.name,
      drawn: !!place.center,
      memories: place.memories.slice(0, 10).map((m) => ({ id: m.id, content: m.content, savedAt: m.created_at })),
      waiting: place.reminders
        .filter((r) => !r.due_at && (r.status === 'confirmed' || r.status === 'pending'))
        .map((r) => ({ id: r.id, task: r.task })),
    });
  }),

  where_am_i: guard(async () => {
    const answer = await answerWhereAmI('where am I');
    return ok({ answer: answer ?? 'Location is not available.' });
  }),

  find_place: guard(async (p) => {
    const query = str(p.query);
    if (!query) return fail('Say which place to look for.');
    const results = await searchPlaces(query, await here());
    lastFound = results.slice(0, 5).map((r) => ({ id: r.id, name: r.name, center: r.center, bounds: r.bounds }));
    return ok({ results: results.slice(0, 5).map((r) => ({ result_id: r.id, name: r.name, where: r.detail })) });
  }),

  draw_place: guard(async (p) => {
    const name = str(p.name);
    if (!name) return fail('What should the place be called?');
    let shape: DraftShape;
    if (p.use_current_location === true) {
      const at = await here();
      if (!at) return fail('I can’t get your location. The user can allow location in the Places tab.');
      shape = { center: at, radiusM: num(p.radius_m) ?? MIN_RADIUS_M, area: null };
    } else {
      const found = lastFound.find((r) => r.id === str(p.result_id));
      if (!found) return fail('Call find_place first and use one of its result_id values.');
      const b = found.bounds;
      // An area result (a campus, a market) becomes its outline; a point becomes a circle.
      const area = b
        ? [
            { lat: b[1], lng: b[0] },
            { lat: b[1], lng: b[2] },
            { lat: b[3], lng: b[2] },
            { lat: b[3], lng: b[0] },
          ]
        : null;
      const geometry = area ? placeGeometry({ area }) : null;
      shape =
        area && geometry && !('error' in geometry)
          ? { center: geometry.center, radiusM: geometry.radiusM, area }
          : { center: found.center, radiusM: num(p.radius_m) ?? 150, area: null };
    }
    const replace = p.replace === true;
    return propose(
      'draw_place',
      replace ? 'Redraw place' : 'New place',
      [field('name', 'Name', name)],
      async (v, finalShape) => {
        const s = finalShape ?? shape;
        const drawing = s.area ? { area: s.area } : { center: s.center, radiusM: s.radiusM };
        const saved = await createPlace(v.name?.trim() || name, drawing, { replace });
        requestPlaceResync();
        remember(saved.id, saved.name);
        return { result: { placeId: saved.id, name: saved.name }, open: { pathname: '/places', params: { open: saved.id } } };
      },
      { shape }
    );
  }),

  star_place: guard(async (p) => {
    const id = str(p.place_id);
    if (!id) return fail('Which place?');
    const star = p.starred !== false;
    return propose('star_place', star ? 'Star place' : 'Unstar place', [shown('place', 'Place', seen.get(id) ?? 'This place')], async () => {
      await setPlaceStarred(id, star);
      requestPlaceResync();
      return { result: { starred: star }, open: { pathname: '/places', params: { open: id } } };
    });
  }),

  rename_place: guard(async (p) => {
    const id = str(p.place_id);
    const name = str(p.name);
    if (!id || !name) return fail('Which place, and its new name?');
    return propose(
      'rename_place',
      'Rename place',
      [shown('was', 'Was', seen.get(id) ?? null), field('name', 'New name', name)],
      async (v) => {
        const next = v.name?.trim() || name;
        await updatePlace(id, { name: next });
        remember(id, next);
        return { result: { renamed: next }, open: { pathname: '/places', params: { open: id } } };
      }
    );
  }),

  merge_places: guard(async (p) => {
    const from = str(p.place_id);
    const into = str(p.into_place_id);
    if (!from || !into) return fail('Which place is the other name for which?');
    return propose(
      'merge_places',
      'Join places',
      [shown('from', 'Other name', seen.get(from) ?? 'This place'), shown('into', 'Is really', seen.get(into) ?? 'that place')],
      async () => {
        await mergePlaceInto(from, into);
        requestPlaceResync();
        return { result: { merged: from, into }, open: { pathname: '/places', params: { open: into } } };
      },
      { destructive: true }
    );
  }),

  stop_watching_place: guard(async (p) => {
    const id = str(p.place_id);
    if (!id) return fail('Which place?');
    return propose('stop_watching_place', 'Stop watching', [shown('place', 'Place', seen.get(id) ?? 'This place')], async () => {
      await clearPlaceArea(id);
      requestPlaceResync();
      return { result: { stopped: id }, open: { pathname: '/places', params: { open: id } } };
    });
  }),

  delete_place: guard(async (p) => {
    const id = str(p.place_id);
    if (!id) return fail('Which place?');
    return propose(
      'delete_place',
      'Delete place',
      [shown('place', 'Place', seen.get(id) ?? 'This place')],
      async () => {
        await deletePlace(id);
        requestPlaceResync();
        return { result: { deleted: id } };
      },
      { destructive: true }
    );
  }),

  // ---------------------------------------------------------------- app
  month_recap: guard(async () => {
    const month = monthWindow(new Date());
    const i = await fetchMonthInsights(month.from, month.to);
    return ok({
      month: month.label,
      memories: i.memories,
      remindersSet: i.remindersSet,
      remindersDone: i.remindersDone,
      topPeople: i.people.slice(0, 3).map((x) => x.name),
    });
  }),

  open_screen: guard(async (p) => {
    const screen = str(p.screen);
    const id = str(p.item_id);
    switch (screen) {
      case 'home': go('/'); break;
      case 'memory': go('/memory'); break;
      case 'people': go('/people'); break;
      case 'reminders': go('/reminders'); break;
      case 'places': go('/places', id ? { open: id } : undefined); break;
      case 'draw_place': go('/places', { draw: str(p.place_name) ?? '' }); break;
      case 'recap': go('/places', { recap: monthWindow(new Date()).key }); break;
      default: return fail('Screens: home, memory, people, reminders, places, draw_place, recap.');
    }
    return ok({ opened: screen });
  }),
};
