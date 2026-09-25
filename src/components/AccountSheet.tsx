import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { signOut } from '@/services/authService';
import {
  isUserCancelled,
  resetPurchasesUser,
  restorePurchases,
} from '@/services/purchases';
import { colors, radius, spacing, text, withOpacity } from '@/theme/theme';

export type AccountSheetProps = {
  visible: boolean;
  isPro: boolean;
  onClose: () => void;
  /** Free users tap "Get Kandoo Pro" — the caller opens the paywall. */
  onGetPro: () => void;
  /** Called after a successful restore so the badge flips. */
  onEntitlementChange: () => void;
};

export function AccountSheet({
  visible,
  isPro,
  onClose,
  onGetPro,
  onEntitlementChange,
}: AccountSheetProps) {
  const [busy, setBusy] = useState(false);

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
          <Text style={styles.eyebrow}>{isPro ? 'Kandoo Pro' : 'Account'}</Text>

          {isPro ? (
            <View style={styles.proRow}>
              <Text style={styles.proText}>
                You’re on Kandoo Pro — your whole history is unlocked.
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
