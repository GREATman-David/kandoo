import * as Sharing from 'expo-sharing';
import { useRef, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { KandooSymbol } from '@/components/Symbol';
import { logFailure, type Photo } from '@/services/interpretationService';
import { colors, fontFamily, radius, spacing, text } from '@/theme/theme';
import { timeAgo } from '@/utils/timeAgo';

/**
 * One kept photo, full size, as a Kandoo photo card: the photo with the mark
 * and the name "Kandoo" beneath it in the corner, and what Kandoo understood
 * it to be underneath. Share sends exactly that card — a picture of the card
 * the user is looking at — so every shared photo carries the watermark.
 */

export type PhotoViewerProps = {
  photo: Photo | null;
  onClose: () => void;
  /** Omit to hide Delete (e.g. a photo shown inside an answer). */
  onDelete?: (photo: Photo) => void;
  /** Open a person or place it belongs to. */
  onOpenEntity?: (kind: 'person' | 'place', id: string) => void;
};

/** The watermark: the mark, with "Kandoo" set beneath it. Scales with the card. */
export function KandooWatermark({ size }: { size: number }) {
  return (
    <View style={styles.watermark} pointerEvents="none">
      <KandooSymbol state="remembered" size={size} />
      <Text style={[styles.watermarkText, { fontSize: Math.round(size * 0.46), lineHeight: Math.round(size * 0.6) }]}>
        Kandoo
      </Text>
    </View>
  );
}

export function PhotoViewer({ photo, onClose, onDelete, onOpenEntity }: PhotoViewerProps) {
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const card = useRef<View>(null);
  const [sharing, setSharing] = useState(false);

  if (!photo) return null;

  // Fit the photo inside the screen, keeping its shape, so the card that is
  // shared is exactly the photo — no letterboxing baked into the image.
  const maxW = screenW - spacing.space4 * 2;
  const maxH = screenH * 0.58;
  const ratio = photo.width && photo.height ? photo.width / photo.height : 4 / 3;
  const w = Math.min(maxW, maxH * ratio);
  const h = w / ratio;
  const markSize = Math.max(26, Math.min(48, Math.round(Math.min(w, h) * 0.1)));
  const linked = [
    ...photo.people.map((p) => ({ kind: 'person' as const, ...p })),
    ...photo.places.map((p) => ({ kind: 'place' as const, ...p })),
  ];

  const share = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing isn’t available', 'This phone can’t share from Kandoo.');
        return;
      }
      const uri = await captureRef(card, { format: 'jpg', quality: 0.92, result: 'tmpfile' });
      await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: 'Share from Kandoo' });
    } catch (error) {
      logFailure('Sharing a photo card failed:', error);
      Alert.alert('That didn’t share', 'Try again in a moment.');
    } finally {
      setSharing(false);
    }
  };

  const confirmDelete = () => {
    if (!onDelete) return;
    Alert.alert('Delete this photo?', 'It’s removed from Kandoo. What Kandoo kept from it stays.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(photo) },
    ]);
  };

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.screen, { paddingTop: insets.top + spacing.space3, paddingBottom: insets.bottom + spacing.space4 }]}>
        <View style={styles.topRow}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {/* The card — what Share captures. collapsable=false keeps it a real
              native view on Android so it can be captured. */}
          <View ref={card} collapsable={false} style={[styles.card, { width: w }]}>
            <View style={{ width: w, height: h }}>
              {photo.url ? (
                <Image source={{ uri: photo.url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <View style={styles.missing}>
                  <Text style={styles.missingText}>This photo couldn’t load.</Text>
                </View>
              )}
              <View style={styles.watermarkSpot}>
                <KandooWatermark size={markSize} />
              </View>
            </View>
            {photo.description ? (
              <View style={styles.caption}>
                <Text style={styles.captionText}>{photo.description}</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.meta}>Kept {timeAgo(photo.createdAt)}</Text>

          {linked.length > 0 ? (
            <View style={styles.links}>
              {linked.map((entity) => (
                <Pressable
                  key={entity.id}
                  style={styles.link}
                  disabled={!onOpenEntity}
                  onPress={() => onOpenEntity?.(entity.kind, entity.id)}
                  accessibilityRole={onOpenEntity ? 'button' : undefined}
                >
                  <Text style={styles.linkText}>{entity.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.actions}>
          {onDelete ? (
            <Pressable style={styles.secondary} onPress={confirmDelete} accessibilityRole="button">
              <Text style={styles.deleteText}>Delete</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.primary, (sharing || !photo.url) && styles.disabled]}
            onPress={() => void share()}
            disabled={sharing || !photo.url}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>{sharing ? 'Preparing…' : 'Share'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space4 },
  topRow: { flexDirection: 'row', justifyContent: 'flex-end', minHeight: 32 },
  close: { ...text.bodyStrong, color: colors.markRing },
  content: { alignItems: 'center', paddingVertical: spacing.space4, gap: spacing.space3 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
  },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  missingText: { ...text.caption, color: colors.inkMuted },
  watermarkSpot: { position: 'absolute', right: spacing.space3, bottom: spacing.space3 },
  watermark: { alignItems: 'center' },
  watermarkText: {
    fontFamily: fontFamily.displayItalic,
    color: colors.surface,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    marginTop: 2,
  },
  caption: { paddingHorizontal: spacing.space4, paddingVertical: spacing.space3 },
  captionText: { ...text.memory, color: colors.ink },
  meta: { ...text.caption, color: colors.inkMuted },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2, justifyContent: 'center' },
  link: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingVertical: 6,
    paddingHorizontal: spacing.space3,
  },
  linkText: { ...text.caption, color: colors.ink },
  actions: { flexDirection: 'row', gap: spacing.space2 },
  secondary: {
    minHeight: 48,
    paddingHorizontal: spacing.space5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { ...text.bodyStrong, color: colors.alarmText },
  primary: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.full,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { ...text.bodyStrong, color: colors.ink },
  disabled: { opacity: 0.5 },
});
