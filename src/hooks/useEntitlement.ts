import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { onEntitlementChange, readTier, type Tier } from '@/services/purchases';
import { setKandooVoiceAllowed } from '@/services/speech';

/**
 * The one place the client reads the tier (`kandoo_personal` / `kandoo_pro` / `kandoo_elite`). It drives what
 * the UI shows — the Free/Pro badge, which older rows look locked — never what
 * access is granted; the backend enforces memory depth server-side.
 *
 * ONE shared value for the whole app. Each screen used to keep its own copy,
 * read once on mount, so a purchase (or losing Pro) on one tab left the others
 * — Memory, a person's page — showing the old state until a restart. Now every
 * screen reads the same store, updated live by RevenueCat's customer-info
 * listener and re-checked whenever the app returns to the foreground. A failed
 * read (offline) keeps the last known value rather than dropping to Free.
 */
let tier: Tier = 'free';
const listeners = new Set<() => void>();

function set(next: Tier) {
  if (next === tier) return;
  tier = next;
  // Kandoo's own voice for spoken answers is a paid benefit; Free uses the phone's.
  setKandooVoiceAllowed(next !== 'free');
  listeners.forEach((listener) => listener());
}

async function refreshNow(fresh = false): Promise<void> {
  const next = await readTier(fresh);
  if (next !== null) set(next);
}

let started = false;
function start() {
  if (started) return;
  started = true;
  // Live updates from RevenueCat; `null` = just configured, so read now.
  onEntitlementChange((next) => {
    if (next === null) void refreshNow();
    else set(next);
  });
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void refreshNow(true);
  });
  void refreshNow();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useEntitlement() {
  useEffect(() => {
    start();
  }, []);

  const current = useSyncExternalStore(subscribe, () => tier);
  const refresh = useCallback(() => refreshNow(true), []);

  // isPro = any paid plan (Personal and up): whole history, Places, photos,
  //   voice, Insights. The name predates Personal; it means "paid".
  // isBusiness = Pro or Elite: work tools (pages into notes, Teams).
  // isElite = Mr. Kandoo, research, leading a team.
  return {
    tier: current,
    isPro: current !== 'free',
    isBusiness: current === 'pro' || current === 'elite',
    isElite: current === 'elite',
    refresh,
  };
}
