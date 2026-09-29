import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ApiError,
  type CaptureNote,
  createManualCapture,
  isNetworkError,
  updateCaptureNote,
  updateMemory,
} from './interpretationService';
import { cacheOwner } from './offlineCache';

/**
 * Notes and memories save on the phone first.
 *
 * Writing something down must never depend on the network. A new note or
 * memory, or an edit to one, goes into this outbox straight away — the screen
 * closes and the item shows in the lists at once — and the outbox sends it to
 * the server in the background, in order, whenever there is a connection:
 * right after saving, when the app comes back to the foreground, and whenever
 * a list reloads.
 *
 *   - An item the server rejects outright (a 4xx such as "too long") is
 *     dropped and logged: retrying could never succeed.
 *   - Anything else (offline, timeout, server busy, rate limit) stays queued
 *     and the flush stops, to try again later in the same order.
 *   - A create carries its original phone time, and the server treats "same
 *     text, same phone time" as the same entry, so a retry after a lost reply
 *     never saves it twice.
 *
 * The queue lives under the offline-cache prefix, keyed by user, so it is
 * wiped with the rest of this account's data on sign-out.
 */

type Draft = { note?: { title: string; body: string }; memory?: { content: string } };

type CreateItem = { kind: 'create'; localId: string; createdAt: string; draft: Draft };
type NoteEditItem = { kind: 'editNote'; captureId: string; note: { title: string; body: string } };
type MemoryEditItem = { kind: 'editMemory'; memoryId: string; content: string };
type OutboxItem = CreateItem | NoteEditItem | MemoryEditItem;

const LOCAL_PREFIX = 'local:';

/** Ids of items that exist only on this phone so far. */
export const isLocalId = (id: string | null | undefined): boolean =>
  !!id && id.startsWith(LOCAL_PREFIX);

// ------------------------------------------------------------ storage

async function key(): Promise<string | null> {
  const owner = await cacheOwner();
  return owner ? `kandoo.cache.v1:${owner}:outbox` : null;
}

async function readItems(): Promise<OutboxItem[]> {
  const k = await key();
  if (!k) return [];
  try {
    const raw = await AsyncStorage.getItem(k);
    return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  } catch (error) {
    console.error('Reading the outbox failed:', error);
    return [];
  }
}

async function writeItems(items: OutboxItem[]): Promise<void> {
  const k = await key();
  if (!k) throw new Error('No signed-in user to save for.');
  await AsyncStorage.setItem(k, JSON.stringify(items));
}

// ------------------------------------------------------------ listeners

const listeners = new Set<() => void>();

/** Called when the outbox changes (queued or synced), so lists can refresh. */
export function onOutboxChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  listeners.forEach((listener) => listener());
}

// ------------------------------------------------------------ saving

let seq = 0;

/** A new note and/or memory, saved on the phone now and synced later. */
export async function saveManual(draft: Draft): Promise<void> {
  const localId = `${LOCAL_PREFIX}${Date.now().toString(36)}${(seq++).toString(36)}`;
  const items = await readItems();
  items.push({ kind: 'create', localId, createdAt: new Date().toISOString(), draft });
  await writeItems(items);
  notify();
  void flushOutbox();
}

/** A note's new title/body. An unsynced note is simply updated in place. */
export async function saveNoteEdit(
  captureId: string,
  note: { title: string; body: string }
): Promise<void> {
  const items = await readItems();
  if (isLocalId(captureId)) {
    const create = items.find((i): i is CreateItem => i.kind === 'create' && i.localId === captureId);
    if (create) create.draft = { ...create.draft, note };
  } else {
    // Only the latest edit matters: replace any older unsent one.
    const rest = items.filter((i) => !(i.kind === 'editNote' && i.captureId === captureId));
    rest.push({ kind: 'editNote', captureId, note });
    items.splice(0, items.length, ...rest);
  }
  await writeItems(items);
  notify();
  void flushOutbox();
}

/** A memory's new wording. An unsynced memory is simply updated in place. */
export async function saveMemoryEdit(memoryId: string, content: string): Promise<void> {
  const items = await readItems();
  if (isLocalId(memoryId)) {
    const localId = memoryId.replace(/:m$/, '');
    const create = items.find((i): i is CreateItem => i.kind === 'create' && i.localId === localId);
    if (create) create.draft = { ...create.draft, memory: { content } };
  } else {
    const rest = items.filter((i) => !(i.kind === 'editMemory' && i.memoryId === memoryId));
    rest.push({ kind: 'editMemory', memoryId, content });
    items.splice(0, items.length, ...rest);
  }
  await writeItems(items);
  notify();
  void flushOutbox();
}

/** Delete an item that never reached the server. */
export async function discardLocal(localId: string): Promise<void> {
  const items = await readItems();
  await writeItems(items.filter((i) => !(i.kind === 'create' && i.localId === localId)));
  notify();
}

// ------------------------------------------------------------ syncing

let flushing: Promise<void> | null = null;

/** Send everything queued, in order. Safe to call at any time and often. */
export function flushOutbox(): Promise<void> {
  if (!flushing) {
    flushing = flush().finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

/** Upper bound on one flush, so nothing can ever spin the sync in a loop. */
const MAX_PER_FLUSH = 50;

async function flush(): Promise<void> {
  let sent = false;
  for (let round = 0; round < MAX_PER_FLUSH; round++) {
    const items = await readItems();
    const next = items[0];
    if (!next) break;
    let created: CaptureNote | null = null;
    try {
      created = await send(next);
    } catch (error) {
      const rejected =
        error instanceof ApiError &&
        error.status !== undefined &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429;
      if (!rejected) {
        // Offline, slow or busy: keep it, in order, for the next flush.
        if (!isNetworkError(error)) console.warn('Syncing a saved item failed; will retry:', error);
        break;
      }
      console.error('The server rejected a saved item; dropping it:', error);
    }
    // Sent (or dropped): remove exactly that item — it may have been edited
    // or new items added while the request was in flight.
    const latest = await readItems();
    const index = latest.findIndex((i) => sameItem(i, next));
    if (index !== -1) {
      const current = latest[index];
      if (JSON.stringify(current) === JSON.stringify(next)) {
        latest.splice(index, 1);
      } else if (current.kind === 'create' && next.kind === 'create' && created) {
        // Edited while it was being sent: the original is on the server now,
        // so the change goes up as an edit to it — never as a second entry.
        latest.splice(index, 1, ...editsFor(created, next.draft, current.draft));
      }
      // (An edit changed mid-send simply stays queued with its newer text.)
      await writeItems(latest);
    }
    sent = true;
  }
  if (sent) notify();
}

function sameItem(a: OutboxItem, b: OutboxItem): boolean {
  if (a.kind === 'create' && b.kind === 'create') return a.localId === b.localId;
  if (a.kind === 'editNote' && b.kind === 'editNote') return a.captureId === b.captureId;
  if (a.kind === 'editMemory' && b.kind === 'editMemory') return a.memoryId === b.memoryId;
  return false;
}

/** Send one item; a create returns what the server saved. */
async function send(item: OutboxItem): Promise<CaptureNote | null> {
  switch (item.kind) {
    case 'create':
      return createManualCapture(item.draft, { clientTime: item.createdAt });
    case 'editNote':
      await updateCaptureNote(item.captureId, item.note);
      return null;
    case 'editMemory':
      await updateMemory(item.memoryId, item.content);
      return null;
  }
}

/** The changes between what was sent and what the user has since typed. */
function editsFor(saved: CaptureNote, sentDraft: Draft, nowDraft: Draft): OutboxItem[] {
  const out: OutboxItem[] = [];
  if (nowDraft.note && JSON.stringify(nowDraft.note) !== JSON.stringify(sentDraft.note)) {
    out.push({ kind: 'editNote', captureId: saved.id, note: nowDraft.note });
  }
  const memoryId = saved.memories[0]?.id;
  if (
    memoryId &&
    nowDraft.memory &&
    nowDraft.memory.content !== sentDraft.memory?.content
  ) {
    out.push({ kind: 'editMemory', memoryId, content: nowDraft.memory.content });
  }
  return out;
}

// ------------------------------------------------------------ reading

/** Unsynced new items, shaped like the server's, newest first. */
export async function pendingCaptures(): Promise<CaptureNote[]> {
  const items = await readItems();
  return items
    .filter((i): i is CreateItem => i.kind === 'create')
    .map(toCapture)
    .reverse();
}

function toCapture(item: CreateItem): CaptureNote {
  const { note, memory } = item.draft;
  return {
    id: item.localId,
    text: note?.body ?? memory?.content ?? '',
    note: note ?? null,
    source: 'manual',
    created_at: item.createdAt,
    memories: memory
      ? [
          {
            id: `${item.localId}:m`,
            content: memory.content,
            person: null,
            location: null,
            topics: [],
            created_at: item.createdAt,
          },
        ]
      : [],
    reminders: [],
    pending: true,
  };
}

/**
 * Server captures with this phone's unsent edits laid over them, followed by
 * nothing else — so an edit made offline shows at once, everywhere.
 */
export async function withPendingEdits(captures: CaptureNote[]): Promise<CaptureNote[]> {
  const items = await readItems();
  const notes = new Map<string, { title: string; body: string }>();
  const memories = new Map<string, string>();
  for (const i of items) {
    if (i.kind === 'editNote') notes.set(i.captureId, i.note);
    if (i.kind === 'editMemory') memories.set(i.memoryId, i.content);
  }
  if (notes.size === 0 && memories.size === 0) return captures;
  return captures.map((c) => ({
    ...c,
    note: notes.get(c.id) ?? c.note,
    memories: c.memories.map((m) =>
      memories.has(m.id) ? { ...m, content: memories.get(m.id) as string } : m
    ),
    pending: c.pending || notes.has(c.id) || c.memories.some((m) => memories.has(m.id)),
  }));
}

/** One unsynced capture by its local id, for opening it before it syncs. */
export async function pendingCapture(localId: string): Promise<CaptureNote | null> {
  const items = await readItems();
  const create = items.find((i): i is CreateItem => i.kind === 'create' && i.localId === localId);
  return create ? toCapture(create) : null;
}
