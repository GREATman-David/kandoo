import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { NameSheet } from '@/components/NameSheet';
import { PasscodeScreen, type PasscodeMode } from '@/components/PasscodeScreen';
import { useAuth } from '@/features/Auth/useAuth';
import { clearPasscode, hasPasscode, onLockChanged } from '@/services/appLock';
import { signOut } from '@/services/authService';
import { chosenName } from '@/services/profile';
import {
  isUserCancelled,
  resetPurchasesUser,
  restorePurchases,
} from '@/services/purchases';
import { colors, radius, spacing, text, withOpacity } from '@/theme/theme';

export type AccountSheetProps = {
  visible: boolean;
  isPro: boolean;
  /** Kandoo Elite (includes everything in Pro). */
  isElite?: boolean;
  onClose: () => void;
  /** Free users tap "Get Kandoo Pro" — the caller opens the paywall. */
  onGetPro: () => void;
  /** Pro users tap "Get Kandoo Elite" — the caller opens the paywall on Elite. */
  onGetElite?: () => void;
  /** Called after a successful restore so the badge flips. */
  onEntitlementChange: () => void;
};

export function AccountSheet({
  visible,
  isPro,
  isElite = false,
  onClose,
  onGetPro,
  onGetElite,
  onEntitlementChange,
}: AccountSheetProps) {
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [lockOn, setLockOn] = useState(false);
  /** The passcode step in progress: set a new one, or prove it's you first. */
  const [passcode, setPasscodeStep] = useState<{ mode: PasscodeMode; then: 'change' | 'off' | null } | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => setName(chosenName(user)), [user]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const read = () =>
      void hasPasscode(userId).then((on) => {
        if (active) setLockOn(on);
      });
    read();
    const unsubscribe = onLockChanged(read);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [userId]);

  function lockOptions() {
    if (!lockOn) {
      setPasscodeStep({ mode: 'set', then: null });
      return;
    }
    Alert.alert('App lock', 'Kandoo asks for your passcode when you open it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Change passcode', onPress: () => setPasscodeStep({ mode: 'verify', then: 'change' }) },
      { text: 'Turn off', style: 'destructive', onPress: () => setPasscodeStep({ mode: 'verify', then: 'off' }) },
    ]);
  }

  async function passcodeDone() {
    const step = passcode;
    if (!step || !userId) return setPasscodeStep(null);
    if (step.mode === 'verify' && step.then === 'change') return setPasscodeStep({ mode: 'set', then: null });
    if (step.mode === 'verify' && step.then === 'off') {
      try {
        await clearPasscode(userId);
      } catch (error) {
        console.error('Turning off the app lock failed:', error);
        Alert.alert('Couldn’t turn it off', 'Please try again.');
      }
    }
    setPasscodeStep(null);
  }

  async function restore() {
    if (busy) return;
    setBusy(true);
    try {
      const entitled = await restorePurchases();
      onEntitlementChange();
      Alert.alert(
        entitled ? 'Kandoo Pro restored' : 'Nothing to restore',
        entitled
          ? 'Your whole history is unlocked again.'
          : 'No previous purchase was found for this account.'
      );
    } catch (caught) {
      if (!isUserCancelled(caught)) {
        console.error('Restore failed:', caught);
        Alert.alert('Couldn’t restore', 'Please try again in a moment.');
      }
    } finally {
      setBusy(false);
    }
  }

  function confirmSignOut() {
    Alert.alert('Sign out of Kandoo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          // Detach the RevenueCat customer first so the next account doesn't
          // inherit this one's entitlement.
          void resetPurchasesUser();
          signOut().catch((error: unknown) => {
            console.error('Sign out failed:', error);
          });
          onClose();
        },
      },
    ]);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.eyebrow}>{isElite ? 'Kandoo Elite' : isPro ? 'Kandoo Pro' : 'Account'}</Text>

          {isPro ? (
            <View style={styles.proRow}>
              <Text style={styles.proText}>
                {isElite
                  ? 'You’re on Kandoo Elite — everything in Pro, plus Mr. Kandoo.'
                  : 'You’re on Kandoo Pro — your whole history is unlocked.'}
              </Text>
            </View>
          ) : (
            <Pressable
              style={styles.row}
              onPress={() => {
                onClose();
                onGetPro();
              }}
            >
              <Text style={styles.rowStrong}>Get Kandoo Pro</Text>
              <Text style={styles.rowHint}>Remember across all of time</Text>
            </Pressable>
          )}

          {isPro && !isElite && onGetElite ? (
            <Pressable
              style={styles.row}
              onPress={() => {
                onClose();
                onGetElite();
              }}
              accessibilityRole="button"
            >
              <Text style={styles.rowStrong}>Get Kandoo Elite</Text>
              <Text style={styles.rowHint}>Talk with Mr. Kandoo — 45 minutes a month</Text>
            </Pressable>
          ) : null}

          {isPro ? (
            <Pressable style={styles.row} onPress={() => setNaming(true)} accessibilityRole="button">
              <Text style={styles.rowText}>Kandoo calls you</Text>
              <Text style={styles.rowHint}>{name ?? 'Add your name'}</Text>
            </Pressable>
          ) : null}

          <Pressable style={styles.row} onPress={lockOptions} disabled={!userId} accessibilityRole="button">
            <Text style={styles.rowText}>App lock</Text>
            <Text style={styles.rowHint}>{lockOn ? 'On · a passcode opens Kandoo' : 'Off · add a passcode'}</Text>
          </Pressable>

          <Pressable style={styles.row} onPress={restore} disabled={busy}>
            <Text style={styles.rowText}>
              {busy ? 'Restoring…' : 'Restore purchase'}
            </Text>
          </Pressable>

          <View style={styles.divider} />

          <Pressable style={styles.row} onPress={confirmSignOut} disabled={busy}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </Pressable>
      </Pressable>

      {userId ? (
        <PasscodeScreen
          visible={passcode !== null}
          mode={passcode?.mode ?? 'set'}
          userId={userId}
          onDone={() => void passcodeDone()}
          onCancel={() => setPasscodeStep(null)}
        />
      ) : null}

      <NameSheet
        visible={naming}
        initialName={name}
        onClose={() => setNaming(false)}
        onSaved={setName}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: withOpacity(colors.ink, 0.35),
  },
  sheet: {
    backgroundColor: colors.base,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.space5,
    paddingHorizontal: spacing.space4,
    paddingBottom: spacing.space7,
  },
  eyebrow: {
    ...text.label,
    color: colors.inkMuted,
    marginBottom: spacing.space3,
  },
  row: {
    paddingVertical: spacing.space4,
  },
  rowStrong: {
    ...text.bodyStrong,
    color: colors.accent,
  },
  rowHint: {
    ...text.caption,
    color: colors.inkMuted,
    marginTop: 2,
  },
  rowText: {
    ...text.body,
    color: colors.ink,
  },
  proRow: {
    paddingVertical: spacing.space3,
  },
  proText: {
    ...text.body,
    color: colors.settled,
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: spacing.space2,
  },
  signOut: {
    ...text.body,
    color: colors.alarmText,
  },
});
