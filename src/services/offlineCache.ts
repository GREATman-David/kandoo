import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

/**
 * Offline reading. Every successful read from the backend is kept on the phone,
 * per account, so that with no connection the app still shows what the user
 * has told Kandoo instead of an error. A saved copy is served ONLY when the
 * network is unreachable — a real server error still surfaces as an error.
 *
 * Privacy: copies are keyed by user id and wiped on sign-out (and when the
 * server rejects the session), so a shared phone never shows the previous
 * person's memories.
 */

const PREFIX = 'kandoo.cache.v1:';
const LAST_USER_KEY = `${PREFIX}lastUser`;

// ------------------------------------------------------------ offline flag

let offline = false;
const listeners = new Set<() => void>();

export function setOffline(next: boolean): void {
  if (next === offline) return;
  offline = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while the screens are showing saved copies because the network is down. */
export function useOffline(): boolean {
  return useSyncExternalStore(subscribe, () => offline);
}

// ------------------------------------------------------------ whose cache

let currentUser: string | null = null;

/** Called with the signed-in user's id whenever a session is read. */
export async function rememberUser(userId: string): Promise<void> {
  if (currentUser === userId) return;
  currentUser = userId;
  try {
    await AsyncStorage.setItem(LAST_USER_KEY, userId);
  } catch (error) {
    console.error('Saving the cache owner failed:', error);
  }
}

async function cacheOwner(): Promise<string | null> {
  if (currentUser) return currentUser;
  try {
    currentUser = await AsyncStorage.getItem(LAST_USER_KEY);
  } catch (error) {
    console.error('Reading the cache owner failed:', error);
  }
  return currentUser;
}

// ------------------------------------------------------------ read / write

type Entry<T> = { savedAt: string; value: T };

async function writeCache<T>(name: string, value: T): Promise<void> {
  const owner = await cacheOwner();
  if (!owner) return;
  try {
    const entry: Entry<T> = { savedAt: new Date().toISOString(), value };
    await AsyncStorage.setItem(`${PREFIX}${owner}:${name}`, JSON.stringify(entry));
  } catch (error) {
    console.error(`Saving ${name} for offline failed:`, error);
  }
}

export async function readCache<T>(name: string): Promise<T | null> {
  const owner = await cacheOwner();
  if (!owner) return null;
  try {
    const raw = await AsyncStorage.getItem(`${PREFIX}${owner}:${name}`);
    return raw ? (JSON.parse(raw) as Entry<T>).value : null;
  } catch (error) {
    console.error(`Reading ${name} from the offline copy failed:`, error);
    return null;
  }
}

/** Every saved value whose name starts with `prefix` (e.g. all capture lists). */
export async function readAllCached<T>(prefix: string): Promise<T[]> {
  const owner = await cacheOwner();
  if (!owner) return [];
  const start = `${PREFIX}${owner}:${prefix}`;
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(start));
    const pairs = await AsyncStorage.multiGet(keys);
    return pairs.flatMap(([, raw]) => (raw ? [(JSON.parse(raw) as Entry<T>).value] : []));
  } catch (error) {
    console.error(`Reading saved ${prefix} failed:`, error);
    return [];
  }
}

/** Remove every saved copy on this phone. Called on sign-out. */
export async function clearOfflineCache(): Promise<void> {
  currentUser = null;
  setOffline(false);
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(PREFIX));
    await AsyncStorage.multiRemove(keys);
  } catch (error) {
    console.error('Clearing the offline copies failed:', error);
  }
}

/**
 * Run a backend read; keep a copy when it succeeds, fall back to the copy when
 * the network is unreachable. `isNetworkError` comes from the caller so this
 * module does not import the service it serves.
 */
export async function withOfflineCache<T>(
  name: string,
  load: () => Promise<T>,
  isNetworkError: (error: unknown) => boolean
): Promise<T> {
  try {
    const value = await load();
    void writeCache(name, value);
    return value;
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    const saved = await readCache<T>(name);
    if (saved === null) throw error;
    setOffline(true);
    return saved;
  }
}
