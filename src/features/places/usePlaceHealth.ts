import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking } from 'react-native';

import { useEntitlement } from '@/hooks/useEntitlement';
import { logFailure } from '@/services/interpretationService';
import { getPlacePermission, type PlacePermission } from '@/services/places/placePermissions';
import { readPlaceState, requestPlaceResync, type PlaceState } from '@/services/places/placeStore';

/**
 * Is Kandoo actually able to notice arrivals right now — and if not, the one
 * thing to do about it. Every Places surface reads this, so the answer is the
 * same everywhere and never optimistic.
 */
export type PlaceHealth =
  | { kind: 'free' }
  | { kind: 'needs-permission'; permission: PlacePermission }
  | { kind: 'location-off' }
  | { kind: 'error' }
  | { kind: 'watching'; places: number }
  | { kind: 'unknown' };

export function usePlaceHealth(): { health: PlaceHealth; state: PlaceState | null; refresh: () => void } {
  const { isPro } = useEntitlement();
  const [health, setHealth] = useState<PlaceHealth>({ kind: 'unknown' });
  const [state, setState] = useState<PlaceState | null>(null);

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const [permission, servicesOn, stored] = await Promise.all([
          getPlacePermission(),
          Location.hasServicesEnabledAsync(),
          readPlaceState(),
        ]);
        setState(stored);
        if (!isPro) return setHealth({ kind: 'free' });
        if (permission !== 'granted') return setHealth({ kind: 'needs-permission', permission });
        if (!servicesOn) return setHealth({ kind: 'location-off' });

        // Things just got fixed outside the app (Settings): sync now rather
        // than waiting for the next scheduled one.
        const last = stored.lastSync?.status;
        if (last === 'no-permission' || last === 'location-off' || last === 'not-pro') {
          requestPlaceResync();
        }
        if (last === 'error') return setHealth({ kind: 'error' });
        setHealth({ kind: 'watching', places: stored.lastSync?.places ?? Object.keys(stored.places).length });
      } catch (error) {
        logFailure('Reading place health failed:', error);
        setHealth({ kind: 'unknown' });
      }
    })();
  }, [isPro]);

  useFocusEffect(refresh);
  return { health, state, refresh };
}

/** Android's own screens, for the one fix each problem needs. */
export function openLocationSettings(): void {
  Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch((error) =>
    logFailure('Opening location settings failed:', error)
  );
}

/**
 * Some phones (many Tecno, Infinix, Xiaomi and Samsung models) stop apps in
 * the background to save battery, which delays or drops place reminders.
 * This opens the screen where the user can let Kandoo run.
 */
export function openBatterySettings(): void {
  Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() =>
    Linking.openSettings().catch((error) => logFailure('Opening battery settings failed:', error))
  );
}
