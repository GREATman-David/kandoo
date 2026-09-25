import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'kandoo.speech.enabled.v1';

/**
 * Whether Kandoo speaks answers aloud. Persisted locally so a mute survives the
 * session — someone in a meeting who silenced it (the answer could be about
 * their doctor) stays silenced next time. Defaults ON, because speaking the
 * answer is the whole point of the feature.
 *
 * `loading` matters: the caller must not speak until the stored preference is
 * known, or a muted user hears one burst before the `false` arrives.
 */
export function useSpeechEnabled() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(KEY)
      .then((value) => {
        // Only a stored 'false' overrides the on-by-default; a missing key stays on.
        if (active && value !== null) setEnabled(value === 'true');
      })
      .catch((error) => {
        console.warn('Reading speech preference failed; defaulting on:', error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      AsyncStorage.setItem(KEY, String(next)).catch((error) => {
        console.warn('Persisting speech preference failed:', error);
      });
      return next;
    });
  }, []);

  return { enabled, loading, toggle };
}
