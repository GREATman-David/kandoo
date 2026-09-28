import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CaptureNote } from '@/services/interpretationService';
import { colors, fontFamily, spacing, text } from '@/theme/theme';
import { timeAgo } from '@/utils/timeAgo';

const ICONS = {
  back: require('@/assets/images/icons/chevron-left.png'),
  note: require('@/assets/images/icons/file-text.png'),
  memory: require('@/assets/images/icons/user-round.png'),
};

export type NoteMemoryForkProps = {
  /** A capture that has BOTH a written note and at least one memory. */
  capture: CaptureNote | null;
  visible: boolean;
  onClose: () => void;
  /** The Note card: the full note, as the Memory list always opened it. */
  onOpenNote: (capture: CaptureNote) => void;
  /** The Memory card: the fact(s) Kandoo kept from it. */
  onOpenMemory: (capture: CaptureNote) => void;
};

/**
 * "Two ways to see this" (Figma: kandoo-note-memory-fork). One thing you said
 * can be read as the note Kandoo wrote up, or as the short facts it will
 * remember. Shown when a Memory card has both; a card with only one opens it
 * directly, as before.
 */
export function NoteMemoryFork({
  capture,
  visible,
  onClose,
  onOpenNote,
  onOpenMemory,
}: NoteMemoryForkProps) {
  const insets = useSafeAreaInsets();

  if (!capture) {
    return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} />;
  }

  const noteText = capture.note?.body || capture.note?.title || capture.text;
  const [first, ...rest] = capture.memories;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={[styles.bar, { marginTop: insets.top + spacing.space4 }]}>
          <Pressable
            style={styles.backBtn}
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Image source={ICONS.back} style={styles.backIcon} />
          </Pressable>
        </View>

        <Text style={styles.eyebrow}>Two ways to see this</Text>

        <View style={styles.cards}>
          <Pressable
            style={[styles.card, styles.noteCard]}
            onPress={() => onOpenNote(capture)}
            accessibilityRole="button"
            accessibilityLabel="Open the note"
          >
            <View style={styles.cardHead}>
              <Image source={ICONS.note} style={styles.cardIcon} />
              <Text style={styles.cardLabel}>Note</Text>
            </View>
            <Text style={styles.cardText} numberOfLines={6}>
              {noteText}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.card, styles.memoryCard]}
            onPress={() => onOpenMemory(capture)}
            accessibilityRole="button"
            accessibilityLabel="Open the memory"
          >
            <View style={styles.cardHead}>
              <Image source={ICONS.memory} style={styles.cardIcon} />
              <Text style={styles.cardLabel}>{rest.length ? 'Memories' : 'Memory'}</Text>
            </View>
            <Text style={styles.cardText} numberOfLines={rest.length ? 5 : 6}>
              {first?.content ?? ''}
            </Text>
            {rest.length ? (
              <Text style={styles.more}>
                +{rest.length} more
              </Text>
            ) : null}
          </Pressable>
        </View>

        <Text style={styles.captured}>Captured {timeAgo(capture.created_at).toLowerCase()}</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space5 },
  bar: { height: 44, flexDirection: 'row', alignItems: 'center' },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  backIcon: { width: 20, height: 20, tintColor: colors.ink },
  eyebrow: {
    ...text.label,
    letterSpacing: 1.5,
    color: colors.markRing,
    marginTop: 20,
    marginBottom: spacing.space4,
  },
  cards: { flexDirection: 'row', gap: spacing.space4 },
  card: {
    flex: 1,
    height: 180,
    padding: spacing.space4,
    borderRadius: 14,
    borderWidth: 1,
  },
  noteCard: { backgroundColor: colors.surface, borderColor: colors.line },
  memoryCard: { backgroundColor: colors.accentWash, borderColor: colors.lineStrong },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2, marginBottom: spacing.space2 },
  cardIcon: { width: 16, height: 16, tintColor: colors.markRing },
  cardLabel: { ...text.label, letterSpacing: 1.5, color: colors.markRing },
  cardText: {
    fontFamily: fontFamily.displayRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
  },
  more: { ...text.caption, color: colors.markRing, marginTop: 'auto' },
  captured: {
    ...text.caption,
    fontSize: 12,
    textAlign: 'center',
    color: colors.inkMuted,
    marginTop: spacing.space5,
  },
});
