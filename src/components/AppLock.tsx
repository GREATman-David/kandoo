import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { KandooSymbol } from '@/components/Symbol';
import { PasscodeScreen } from '@/components/PasscodeScreen';
import { useAuth } from '@/features/Auth/useAuth';
import { hasPasscode, markLockOffered, onLockChanged, wasLockOffered } from '@/services/appLock';
import { colors } from '@/theme/theme';

/**
 * Covers the whole app with the passcode screen when the user has chosen a
 * passcode: on launch, and when they come back after being away a while.
 * Also offers the passcode once to a brand-new account (skippable) — later it
 * lives in the account sheet. Without a passcode this renders nothing.
 */

/** Back within this long (a quick glance at another app) and Kandoo stays open. */
const GRACE_MS = 30_000;
/** An account younger than this is "new" and gets the one-time offer. */
const NEW_ACCOUNT_MS = 30 * 60 * 1000;

export function AppLock() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // null = still checking (the app stays covered until we know).
  const [lockSet, setLockSet] = useState<boolean | null>(null);
  const [locked, setLocked] = useState(true);
  const [offer, setOffer] = useState(false);
  const leftAt = useRef<number | null>(null);

  // Is there a passcode for this account? Re-read whenever it changes.
  useEffect(() => {
    if (!userId) {
      setLockSet(null);
      setLocked(true);
      return;
    }
    let active = true;
    const read = async (initial: boolean) => {
      const set = await hasPasscode(userId);
      if (!active) return;
      setLockSet(set);
      if (initial) setLocked(set);
      if (!set) setLocked(false);
    };
    void read(true);
    const unsubscribe = onLockChanged(() => void read(false));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [userId]);

  // The one-time offer, for a brand-new account only.
  useEffect(() => {
    if (!userId || lockSet !== false || !user?.created_at) return;
    if (Date.now() - Date.parse(user.created_at) > NEW_ACCOUNT_MS) return;
    let active = true;
    void wasLockOffered(userId).then((offered) => {
      if (active && !offered) setOffer(true);
    });
    return () => {
      active = false;
    };
  }, [userId, lockSet, user?.created_at]);

  // Lock again after time away.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        leftAt.current = Date.now();
      } else if (state === 'active' && leftAt.current !== null) {
        const away = Date.now() - leftAt.current;
        leftAt.current = null;
        if (lockSet && away > GRACE_MS) setLocked(true);
      }
    });
    return () => sub.remove();
  }, [lockSet]);

  if (!userId) return null;

  return (
    <>
      {/* Until we know whether a lock is set, nothing personal shows. */}
      {lockSet === null ? (
        <View style={styles.cover} pointerEvents="auto">
          <KandooSymbol state="idle" size={62} />
        </View>
      ) : null}

      <PasscodeScreen
        visible={!!lockSet && locked}
        mode="unlock"
        userId={userId}
        onDone={() => setLocked(false)}
      />

      <PasscodeScreen
        visible={offer && !lockSet}
        mode="set"
        intro="Kandoo keeps personal things. Add a 6-digit passcode so only you can open it. You can skip this and add one later from your account."
        userId={userId}
        onDone={() => {
          setOffer(false);
          setLocked(false);
        }}
        onCancel={() => {
          setOffer(false);
          void markLockOffered(userId);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.base,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
});
