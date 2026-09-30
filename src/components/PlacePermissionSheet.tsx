import { useEffect, useState } from 'react';
import { AppState, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { logFailure } from '@/services/interpretationService';
import {
  getPlacePermission,
  requestPlacePermission,
  type PlacePermission,
} from '@/services/places/placePermissions';
import { requestPlaceResync } from '@/services/places/placeStore';
import { colors, radius, spacing, text, withOpacity } from '@/theme/theme';

/**
 * Explains, BEFORE Android asks, why Places needs "Allow all the time" — and
 * what Kandoo does not do with it. Android 11+ grants "all the time" only in
 * Settings, so the second step says exactly which option to pick there.
 */

export type PlacePermissionSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** "Allow all the time" is on. */
  onGranted: () => void;
};

export function PlacePermissionSheet({ visible, onClose, onGranted }: PlacePermissionSheetProps) {
  const [state, setState] = useState<PlacePermission>('undetermined');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const check = () =>
      void getPlacePermission()
        .then((next) => {
          setState(next);
          // Back from Settings with "Allow all the time" on: done — close
          // rather than leaving the user to find "Not now".
          if (next === 'granted') {
            requestPlaceResync();
            onGranted();
          }
        })
        .catch((error) => logFailure('Reading location permission failed:', error));
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
    // onGranted is the parent's close handler; re-subscribing on every render isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const ask = async () => {
    setBusy(true);
    try {
      const result = await requestPlacePermission();
      setState(result);
      if (result === 'granted') {
        requestPlaceResync();
        onGranted();
      }
    } catch (error) {
      logFailure('Location permission request failed:', error);
    } finally {
      setBusy(false);
    }
  };

  const openSettings = () => {
    void Linking.openSettings().catch((error) => logFailure('Opening settings failed:', error));
  };

  const needsSettings = state === 'foreground-only' || state === 'blocked';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.eyebrow}>Places</Text>
          <Text style={styles.title}>Let Kandoo notice when you arrive.</Text>

          {needsSettings ? (
            <>
              <Text style={styles.blurb}>
                {state === 'blocked'
                  ? 'Location is turned off for Kandoo. In Settings, open Location and choose “Allow all the time”.'
                  : 'One more step. In Settings, open Location and choose “Allow all the time”. Kandoo can then remind you even when it’s closed.'}
              </Text>
              <Pressable style={styles.cta} onPress={openSettings} accessibilityRole="button">
                <Text style={styles.ctaText}>Open Settings</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.blurb}>
                To remind you at school, or bring back what was said at the clinic, Kandoo needs
                location set to “Allow all the time”.
              </Text>
              <View style={styles.promises}>
                <Text style={styles.promise}>It only watches the places you draw.</Text>
                <Text style={styles.promise}>It never follows you around or records your route.</Text>
                <Text style={styles.promise}>When you were where stays on this phone.</Text>
              </View>
              <Pressable
                style={[styles.cta, busy && styles.ctaDisabled]}
                onPress={() => void ask()}
                disabled={busy}
                accessibilityRole="button"
              >
                <Text style={styles.ctaText}>Continue</Text>
              </Pressable>
            </>
          )}

          <Pressable style={styles.later} onPress={onClose} hitSlop={8} accessibilityRole="button">
            <Text style={styles.laterText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: withOpacity(colors.base, 0.6) },
  sheet: {
    backgroundColor: colors.base,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.space5,
    paddingHorizontal: spacing.space4,
    paddingBottom: spacing.space6,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  eyebrow: { ...text.label, color: colors.accent, marginBottom: spacing.space2 },
  title: { ...text.displayL, color: colors.ink, marginBottom: spacing.space3 },
  blurb: { ...text.body, color: colors.inkMuted, marginBottom: spacing.space4 },
  promises: {
    gap: spacing.space2,
    marginBottom: spacing.space5,
    borderLeftWidth: 2,
    borderLeftColor: colors.settledFill,
    paddingLeft: spacing.space3,
  },
  promise: { ...text.body, color: colors.ink },
  cta: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { ...text.bodyStrong, color: colors.ink },
  later: { alignItems: 'center', paddingTop: spacing.space4 },
  laterText: { ...text.bodyStrong, color: colors.inkMuted },
});
