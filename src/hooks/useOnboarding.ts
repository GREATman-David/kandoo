import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const SEEN_KEY = 'kandoo.onboarding.seen.v1';

/**
 * Whether the first-launch onboarding has been seen. Stored locally so it shows
 * exactly once, before the very first sign-up. Fails OPEN (treats onboarding as
 * seen) if storage can't be read — a returning user hitting a storage hiccup
 * should never be trapped behind the intro again. Only a clean "not seen" read
 * shows it.
 */
export function useOnboarding() {
  // null = still reading; true/false once known.
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(SEEN_KEY)
      .then((value) => {
        if (active) setSeen(value === 'true');
      })
      .catch((error) => {
        console.warn('Reading onboarding flag failed; skipping intro:', error);
        if (active) setSeen(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const markSeen = useCallback(async () => {
    // Flip the UI immediately; persistence is best-effort. If the write fails the
    // intro may reappear next launch, which is a far smaller harm than blocking.
    setSeen(true);
    try {
      await AsyncStorage.setItem(SEEN_KEY, 'true');
    } catch (error) {
      console.warn('Persisting onboarding flag failed:', error);
    }
  }, []);

  return { seen, loading: seen === null, markSeen };
}
