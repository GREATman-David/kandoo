import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * Kandoo's app lock: an optional passcode the user chooses. Kandoo holds
 * sensitive memories, so opening it can require the passcode — but only if
 * the user wants that; it is never forced.
 *
 * The passcode never leaves the phone and is never stored as itself: only a
 * salted, stretched SHA-256 of it, in Android's encrypted storage
 * (expo-secure-store), per account. Forgetting it is safe — signing out clears
 * the lock, and everything the user saved is on the server.
 */

export const PASSCODE_LENGTH = 4;
/** Wrong tries allowed before a short wait. */
const FREE_TRIES = 5;
const COOL_DOWN_MS = 30_000;
/** Rounds of hashing: slows a guessing attack on a stolen copy. */
const ROUNDS = 1000;

type Stored = { salt: string; hash: string; rounds: number };

// SecureStore keys allow [A-Za-z0-9._-] only; Supabase ids are UUIDs.
const lockKey = (userId: string) => `kandoo.lock.${userId}`;
const offeredKey = (userId: string) => `kandoo.lock.offered.${userId}`;

let failures = 0;
let blockedUntil = 0;

async function stretch(passcode: string, salt: string, rounds: number): Promise<string> {
  let digest = `${salt}:${passcode}`;
  for (let i = 0; i < rounds; i++) {
    digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}${digest}`);
  }
  return digest;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isValidPasscode(passcode: string): boolean {
  return new RegExp(`^\\d{${PASSCODE_LENGTH}}$`).test(passcode);
}

export async function hasPasscode(userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(lockKey(userId))) !== null;
  } catch (error) {
    // Unreadable secure storage must not lock the user out of their own data.
    console.warn('Reading the app lock failed:', error);
    return false;
  }
}

export async function setPasscode(userId: string, passcode: string): Promise<void> {
  if (!isValidPasscode(passcode)) throw new Error(`A passcode is ${PASSCODE_LENGTH} digits.`);
  const salt = toHex(Crypto.getRandomBytes(16));
  const stored: Stored = { salt, hash: await stretch(passcode, salt, ROUNDS), rounds: ROUNDS };
  await SecureStore.setItemAsync(lockKey(userId), JSON.stringify(stored));
  await markLockOffered(userId);
  notifyLockChanged();
}

export async function clearPasscode(userId: string): Promise<void> {
  await SecureStore.deleteItemAsync(lockKey(userId));
  notifyLockChanged();
}

export type CheckResult = { ok: true } | { ok: false; waitMs: number; triesLeft: number };

export async function checkPasscode(userId: string, passcode: string): Promise<CheckResult> {
  const now = Date.now();
  if (now < blockedUntil) return { ok: false, waitMs: blockedUntil - now, triesLeft: 0 };

  const raw = await SecureStore.getItemAsync(lockKey(userId));
  if (!raw) return { ok: true }; // No lock set (e.g. cleared elsewhere).
  const stored = JSON.parse(raw) as Stored;
  const hash = await stretch(passcode, stored.salt, stored.rounds);
  if (hash === stored.hash) {
    failures = 0;
    return { ok: true };
  }
  failures += 1;
  if (failures >= FREE_TRIES) {
    failures = 0;
    blockedUntil = Date.now() + COOL_DOWN_MS;
    return { ok: false, waitMs: COOL_DOWN_MS, triesLeft: 0 };
  }
  return { ok: false, waitMs: 0, triesLeft: FREE_TRIES - failures };
}

/** New accounts are offered the lock once; this remembers the offer was made. */
export async function wasLockOffered(userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(offeredKey(userId))) === 'yes';
  } catch (error) {
    console.warn('Reading the lock offer failed:', error);
    return true; // Never nag because storage misbehaved.
  }
}

export async function markLockOffered(userId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(offeredKey(userId), 'yes');
  } catch (error) {
    console.warn('Saving the lock offer failed:', error);
  }
}

// ---- change notices: the gate and the account sheet stay in step -------------

const lockListeners = new Set<() => void>();

export function onLockChanged(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => {
    lockListeners.delete(listener);
  };
}

export function notifyLockChanged(): void {
  lockListeners.forEach((listener) => listener());
}
