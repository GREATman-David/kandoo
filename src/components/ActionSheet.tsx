import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, text } from '@/theme/theme';

export type SheetAction = {
  label: string;
  onPress: () => void;
  /** Shown in the alarm colour, e.g. Delete. */
  destructive?: boolean;
};

export type ActionSheetProps = {
  visible: boolean;
  /** What the actions apply to, shown above them (one line). */
  title?: string;
  actions: SheetAction[];
  onClose: () => void;
};

/**
 * The long-press menu. Android's own alert fits only three buttons, and these
 * menus can need more (Add a note, Add a memory, Add a reminder, Delete), so
 * this is a small bottom sheet in Kandoo's style. Tap outside or Cancel to
 * close; choosing an action closes it first, then runs the action.
 */
export function ActionSheet({ visible, title, actions, onClose }: ActionSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu">
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.space4 }]}
          onPress={(e) => e.stopPropagation()}
        >
          {title ? (
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          {actions.map((action) => (
            <Pressable
              key={action.label}
              style={styles.row}
              onPress={() => {
                onClose();
                action.onPress();
              }}
              accessibilityRole="button"
            >
              <Text style={[styles.rowText, action.destructive && styles.destructive]}>
                {action.label}
              </Text>
            </Pressable>
          ))}
          <Pressable
            style={[styles.row, styles.cancel]}
            onPress={onClose}
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(26,10,14,0.35)' },
  sheet: {
    backgroundColor: colors.base,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.space4,
    paddingHorizontal: spacing.space5,
  },
  title: {
    ...text.caption,
    color: colors.inkMuted,
    marginBottom: spacing.space2,
  },
  row: {
    paddingVertical: spacing.space4,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowText: { ...text.body, color: colors.ink },
  destructive: { color: colors.alarmText },
  cancel: { borderBottomWidth: 0 },
  cancelText: { ...text.bodyStrong, color: colors.inkMuted },
});
