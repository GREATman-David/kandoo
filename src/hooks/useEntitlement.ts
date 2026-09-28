import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { onEntitlementChange, readEntitlement } from '@/services/purchases';

/**
 * The one place the client reads the `kandoo_pro` entitlement. It drives what
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
let isPro = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (next === isPro) return;
  isPro = next;
  listeners.forEach((listener) => listener());
}

async function refreshNow(fresh = false): Promise<void> {
  const pro = await readEntitlement(fresh);
  if (pro !== null) set(pro);
}

let started = false;
function start() {
  if (started) return;
  started = true;
  // Live updates from RevenueCat; `null` = just configured, so read now.
  onEntitlementChange((pro) => {
    if (pro === null) void refreshNow();
    else set(pro);
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

  const pro = useSyncExternalStore(subscribe, () => isPro);
  const refresh = useCallback(() => refreshNow(true), []);

  return { isPro: pro, refresh };
}
