import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useEntitlement } from '@/hooks/useEntitlement';
import { onPlaceResyncRequest } from '@/services/places/placeStore';
import { requestPlaceSync, type PlaceSyncResult } from '@/services/places/placeSync';

/** Resync requests arriving in a burst (several reminders confirmed) run once. */
const DEBOUNCE_MS = 1500;

/**
 * Keeps the phone's watched places in line with the server: on launch, when
 * Pro starts or ends, when the app comes back to the front, and whenever a
 * place reminder is confirmed for a place not watched yet. Never blocks the UI;
 * a failure leaves the places already registered working.
 */
export function usePlaceSync(enabled: boolean): PlaceSyncResult | null {
  const { isPro } = useEntitlement();
  const [result, setResult] = useState<PlaceSyncResult | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = () => {
      void requestPlaceSync().then((r) => {
        if (active && r) setResult(r);
      });
    };
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, DEBOUNCE_MS);
    };

    run();
    const unsubscribe = onPlaceResyncRequest(soon);
    const appState = AppState.addEventListener('change', (state) => {
      // Back from Settings with "Allow all the time" granted, or from anywhere.
      if (state === 'active') soon();
    });

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
      appState.remove();
    };
  }, [enabled, isPro]);

  return result;
}
