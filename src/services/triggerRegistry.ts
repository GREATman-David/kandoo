import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The device's trigger registry (AGENTS.md §3.2: the DEVICE owns triggers).
 *
 * Maps a reminder id to the OS notification id we scheduled for it, plus the
 * due time we scheduled against so reconcile can tell when the server's copy
 * has moved and needs rescheduling. This is device-local on purpose: a
 * notification id is an OS handle, meaningless on any other device and gone if
 * the OS clears it, so it must never live on the shared server row.
 */

const KEY = 'kandoo.trigger.registry.v1';

export type TriggerEntry = {
  notificationId: string;
  /** Every OS notification for this reminder — one per weekday when it
   *  repeats. Absent on entries written before repeat existed. */
  notificationIds?: string[];
  /** The reminder's due_at at schedule time, ISO. Detects a moved time. */
  dueAt: string;
  /** Its repeat days at schedule time ("1,3,5"; "" = once). Detects a change. */
  repeat?: string;
};

/** All OS notification ids an entry owns. */
export function entryIds(entry: TriggerEntry): string[] {
  return entry.notificationIds?.length ? entry.notificationIds : [entry.notificationId];
}

type Registry = Record<string, TriggerEntry>;

async function read(): Promise<Registry> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Registry) : {};
  } catch (error) {
    console.warn('Trigger registry read failed; treating as empty:', error);
    return {};
  }
}

async function write(registry: Registry): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(registry));
  } catch (error) {
    console.warn('Trigger registry write failed:', error);
  }
}

export async function getAllTriggers(): Promise<Registry> {
  return read();
}

export async function getTrigger(
  reminderId: string
): Promise<TriggerEntry | null> {
  const registry = await read();
  return registry[reminderId] ?? null;
}

export async function setTrigger(
  reminderId: string,
  entry: TriggerEntry
): Promise<void> {
  const registry = await read();
  registry[reminderId] = entry;
  await write(registry);
}

export async function removeTrigger(reminderId: string): Promise<void> {
  const registry = await read();
  if (reminderId in registry) {
    delete registry[reminderId];
    await write(registry);
  }
}

/** Forget every trigger (sign-out). */
export async function clearTriggers(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (error) {
    console.warn('Trigger registry clear failed:', error);
  }
}
