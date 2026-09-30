import { router } from 'expo-router';

import { answerWhereAmI } from '@/features/places/whereAmI';
import { monthWindow } from '@/features/places/monthRecap';
import { searchPlaces } from '@/features/places/searchPlaces';
import {
  addMemoryToCapture,
  agentSearch,
  clearPlaceArea,
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
  fetchMonthInsights,
  fetchPeople,
  fetchPerson,
  fetchPlace,
  fetchPlaces,
  isProRequired,
  mergePeople,
  mergePlaceInto,
  setPlaceStarred,
  updateCaptureNote,
  updateMemory,
  updatePlace,
  updateReminder,
  userMessage,
  type CreatedReminder,
} from '@/services/interpretationService';
import { cancelReminder, scheduleReminder, snoozeRepeatingOnce } from '@/services/localNotifications';
import { isRepeating } from '@/utils/repeat';
import { requestPlaceResync } from '@/services/places/placeStore';
import { MIN_RADIUS_M, placeGeometry, type LatLng } from '@/utils/geo';
import * as Location from 'expo-location';

/**
 * Kandoo Agent's hands. Every tool is a thin wrapper over the SAME function the
 * app's own buttons call, plus what the button does next (schedule the
 * notification on the phone, re-sync watched places) — so the agent can do
 * anything the user can, through the app's own rules (AGENTS §3.1: the model
 * decides, Kandoo's code acts).
 *
 * Rules enforced HERE, not only in the prompt:
 *   - deleting / merging needs confirmed === true (a spoken yes);
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
const NEED_CONFIRM = fail(
  'Not done: ask the user to confirm first, then call again with confirmed=true only after they clearly say yes.'
);

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
  // ---------------------------------------------------------------- memory
  search_memory: guard(async (p) => {
    const query = str(p.query);
    if (!query) return fail('Say what to look for.');
    const matches = await agentSearch(query);
    return ok({ matches: matches.slice(0, 6) });
  }),

  add_memory: guard(async (p) => {
    const content = str(p.content);
    if (!content) return fail('Say what to remember.');
    const noteId = str(p.note_id);
    if (noteId) {
      await addMemoryToCapture(noteId, content);
      return ok({ saved: content, addedToNote: noteId });
    }
    const capture = await createManualCapture({ memory: { content } }, { clientTime: new Date().toISOString() });
    return ok({ saved: content, memoryId: capture?.memories?.[0]?.id ?? null });
  }),

  edit_memory: guard(async (p) => {
    const id = str(p.memory_id);
    const content = str(p.content);
    if (!id || !content) return fail('Need the memory and its new wording.');
    await updateMemory(id, content);
    return ok({ updated: id });
  }),

  delete_memory: guard(async (p) => {
    const id = str(p.memory_id);
    if (!id) return fail('Which memory?');
    if (p.confirmed !== true) return NEED_CONFIRM;
    await deleteMemoryById(id);
    return ok({ deleted: id });
  }),

  // ---------------------------------------------------------------- notes
  list_notes: guard(async (p) => {
    const limit = Math.min(Math.max(num(p.limit) ?? 8, 1), 20);
    const captures = await fetchCaptureNotes({ limit, requireContent: true });
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
    const title = str(p.title);
    const body = str(p.body);
    if (!body) return fail('Say what the note should say.');
    const capture = await createManualCapture(
      { note: { title: title ?? body.split(/[.!?]/)[0].slice(0, 60), body } },
      { clientTime: new Date().toISOString() }
    );
    return ok({ noteId: capture?.id ?? null });
  }),

  edit_note: guard(async (p) => {
    const id = str(p.note_id);
    if (!id) return fail('Which note?');
    const current = await fetchCaptureNote(id);
    if (!current) return fail('That note is no longer there.');
    const title = str(p.title) ?? current.note?.title ?? 'A note';
    const body = str(p.body) ?? current.note?.body ?? current.text;
    await updateCaptureNote(id, { title, body });
    return ok({ updated: id });
  }),

  delete_note: guard(async (p) => {
    const id = str(p.note_id);
    if (!id) return fail('Which note?');
    if (p.confirmed !== true) return NEED_CONFIRM;
    await deleteCaptureById(id);
    return ok({ deleted: id });
  }),

  // ---------------------------------------------------------------- reminders
  list_reminders: guard(async () => {
    const g = await fetchGroupedReminders();
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
    const placeName = str(p.place_name);
    if (!dueAt && !placeName) return fail('A reminder needs a time or a place.');
    const reminder = await createManualReminder({
      task,
      dueAt,
      person: str(p.person),
      repeatDays: days(p.repeat_days),
      placeName: dueAt ? null : placeName,
      placeTrigger: p.trigger === 'leave' ? 'leave' : 'arrive',
      notBefore: iso(p.not_before),
    });
    // The phone owns the trigger (§3.2): a time goes to the alarm, a place to the geofences.
    await scheduleReminder(reminder);
    return ok({ reminder: compactReminder(reminder) });
  }),

  update_reminder: guard(async (p) => {
    const id = str(p.reminder_id);
    if (!id) return fail('Which reminder?');
    const patch: Parameters<typeof updateReminder>[1] = {};
    if (str(p.task)) patch.task = str(p.task)!;
    if (iso(p.due_at)) patch.dueAt = iso(p.due_at);
    if (p.person !== undefined) patch.person = str(p.person);
    if (p.repeat_days !== undefined) patch.repeatDays = days(p.repeat_days);
    if (Object.keys(patch).length === 0) return fail('Nothing to change.');
    const updated = await updateReminder(id, patch);
    await scheduleReminder(updated);
    return ok({ reminder: compactReminder(updated) });
  }),

  complete_reminder: guard(async (p) => {
    const id = str(p.reminder_id);
    if (!id) return fail('Which reminder?');
    await updateReminder(id, { status: 'fired' });
    await cancelReminder(id);
    return ok({ done: id });
  }),

  snooze_reminder: guard(async (p) => {
    const id = str(p.reminder_id);
    const minutes = num(p.minutes) ?? 15;
    if (!id) return fail('Which reminder?');
    // A repeating reminder snoozes ONCE, as the app's own Snooze does — moving
    // due_at would shift every future repeat.
    const g = await fetchGroupedReminders();
    const current = [...g.active, ...g.needsReview].find((r) => r.id === id);
    if (current && isRepeating(current.repeat_days)) {
      await snoozeRepeatingOnce(
        { reminderId: id, title: current.task, body: current.person ? `With ${current.person}` : 'Kandoo reminder', insistent: current.insistent },
        minutes
      );
      return ok({ snoozedOnce: id, minutes });
    }
    const dueAt = new Date(Date.now() + minutes * 60_000).toISOString();
    const updated = await updateReminder(id, { dueAt, status: 'confirmed' });
    await scheduleReminder(updated);
    return ok({ reminder: compactReminder(updated) });
  }),

  delete_reminder: guard(async (p) => {
    const id = str(p.reminder_id);
    if (!id) return fail('Which reminder?');
    if (p.confirmed !== true) return NEED_CONFIRM;
    await deleteReminderById(id);
    await cancelReminder(id);
    return ok({ deleted: id });
  }),

  // ---------------------------------------------------------------- people
  list_people: guard(async () => {
    const people = await fetchPeople();
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
    return ok({
      id: person.id,
      name: person.name,
      memories: person.memories.slice(0, 12).map((m) => ({ id: m.id, content: m.content, savedAt: m.created_at })),
      reminders: person.reminders.slice(0, 10).map((r) => ({ id: r.id, task: r.task, dueAt: r.due_at, status: r.status })),
    });
  }),

  merge_people: guard(async (p) => {
    const keep = str(p.keep_person_id);
    const others = Array.isArray(p.merge_person_ids) ? (p.merge_person_ids as unknown[]).map(str).filter(Boolean) as string[] : [];
    if (!keep || others.length === 0) return fail('Say who to keep and who to fold in.');
    if (p.confirmed !== true) return NEED_CONFIRM;
    await mergePeople(keep, others);
    return ok({ kept: keep, merged: others });
  }),

  // ---------------------------------------------------------------- places
  list_places: guard(async () => {
    const places = await fetchPlaces();
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
    return ok({
      id: place.id,
      name: place.name,
      drawn: !!place.center,
      memories: place.memories.slice(0, 10).map((m) => ({ id: m.id, content: m.content, savedAt: m.created_at })),
      waiting: place.reminders.filter((r) => !r.due_at && (r.status === 'confirmed' || r.status === 'pending')).map((r) => ({ id: r.id, task: r.task })),
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
    let drawing: Parameters<typeof createPlace>[1];
    if (p.use_current_location === true) {
      const at = await here();
      if (!at) return fail('I can’t get your location. The user can allow location in the Places tab.');
      drawing = { center: at, radiusM: num(p.radius_m) ?? MIN_RADIUS_M };
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
      drawing =
        area && geometry && !('error' in geometry)
          ? { area }
          : { center: found.center, radiusM: num(p.radius_m) ?? 150 };
    }
    const saved = await createPlace(name, drawing, { replace: p.replace === true });
    requestPlaceResync();
    return ok({ placeId: saved.id, name: saved.name });
  }),

  star_place: guard(async (p) => {
    const id = str(p.place_id);
    if (!id) return fail('Which place?');
    await setPlaceStarred(id, p.starred !== false);
    requestPlaceResync();
    return ok({ starred: p.starred !== false });
  }),

  rename_place: guard(async (p) => {
    const id = str(p.place_id);
    const name = str(p.name);
    if (!id || !name) return fail('Which place, and its new name?');
    await updatePlace(id, { name });
    return ok({ renamed: name });
  }),

  merge_places: guard(async (p) => {
    const from = str(p.place_id);
    const into = str(p.into_place_id);
    if (!from || !into) return fail('Which place is the other name for which?');
    if (p.confirmed !== true) return NEED_CONFIRM;
    await mergePlaceInto(from, into);
    requestPlaceResync();
    return ok({ merged: from, into });
  }),

  stop_watching_place: guard(async (p) => {
    const id = str(p.place_id);
    if (!id) return fail('Which place?');
    await clearPlaceArea(id);
    requestPlaceResync();
    return ok({ stopped: id });
  }),

  delete_place: guard(async (p) => {
    const id = str(p.place_id);
    if (!id) return fail('Which place?');
    if (p.confirmed !== true) return NEED_CONFIRM;
    await deletePlace(id);
    requestPlaceResync();
    return ok({ deleted: id });
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
