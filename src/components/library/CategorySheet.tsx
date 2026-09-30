import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, spacing, text, withOpacity } from '@/theme/theme';

/** Mirrors the server's limit (backend libraryInput.ts). */
const MAX_CATEGORY_NAME = 80;

export type CategorySheetProps = {
  visible: boolean;
  /** Set when renaming; empty for a new category. */
  initialName?: string | null;
  onClose: () => void;
  /** Resolves when saved; throws a user-facing message to keep the sheet open. */
  onSave: (name: string) => Promise<void>;
};

/** Name a Library category ("Kandoo Project"), or rename one. */
export function CategorySheet({ visible, initialName, onClose, onSave }: CategorySheetProps) {
  const [name, setName] = useState(initialName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renaming = Boolean(initialName);

  useEffect(() => {
    if (visible) {
      setName(initialName ?? '');
      setError(null);
    }
  }, [visible, initialName]);

  const save = async () => {
    const value = name.trim();
    if (!value || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That didn’t save just now. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.eyebrow}>Library</Text>
            <Text style={styles.title}>{renaming ? 'Rename this category' : 'A new category'}</Text>
            <Text style={styles.hint}>A shelf for notes that belong together.</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Kandoo Project"
              placeholderTextColor={colors.inkFaint}
              autoFocus
              autoCapitalize="words"
              maxLength={MAX_CATEGORY_NAME}
              returnKeyType="done"
              underlineColorAndroid="transparent"
              onSubmitEditing={() => void save()}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <Pressable style={styles.secondary} onPress={onClose} accessibilityRole="button">
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.primary, !name.trim() && styles.disabled]}
                onPress={() => void save()}
                disabled={!name.trim() || saving}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>
                  {saving ? 'Saving' : renaming ? 'Rename' : 'Create'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: withOpacity(colors.ink, 0.35) },
  sheet: {
    backgroundColor: colors.base,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.space5,
    paddingBottom: spacing.space6,
    gap: spacing.space2,
  },
  eyebrow: { ...text.label, color: colors.markRing },
  title: { ...text.displayL, color: colors.ink },
  hint: { ...text.body, color: colors.inkMuted },
  // The user's own words are Fraunces (AGENTS §7).
  input: {
    ...text.memory,
    color: colors.ink,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.accent,
    paddingVertical: spacing.space2,
    marginTop: spacing.space3,
  },
  error: { ...text.caption, color: colors.alarmText },
  actions: { flexDirection: 'row', gap: spacing.space2, marginTop: spacing.space4 },
  secondary: {
    minHeight: 48,
    paddingHorizontal: spacing.space5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { ...text.bodyStrong, color: colors.inkMuted },
  primary: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.full,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
  primaryText: { ...text.bodyStrong, color: colors.ink },
});
