import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { addPerson, logFailure, userMessage } from '@/services/interpretationService';
import { colors, radius, spacing, text, withOpacity } from '@/theme/theme';

/**
 * Add someone to People by hand — the way a note or memory can be added —
 * with a few optional things to remember about them. Each line becomes a
 * memory about that person, so asking Kandoo about them later finds it.
 */

const MAX_FACTS = 5;

export type AddPersonSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** The saved person (an existing one, if Kandoo already knew the name). */
  onAdded: (person: { id: string; name: string; existed: boolean }) => void;
};

export function AddPersonSheet({ visible, onClose, onAdded }: AddPersonSheetProps) {
  const [name, setName] = useState('');
  const [facts, setFacts] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName('');
    setFacts(['']);
    setError(null);
  }, [visible]);

  const first = name.trim().split(/\s+/)[0] || 'them';

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const person = await addPerson(
        name.trim(),
        facts.map((f) => f.trim()).filter(Boolean)
      );
      onAdded(person);
      onClose();
    } catch (caught) {
      logFailure('Adding a person failed:', caught);
      setError(userMessage(caught, 'Could not add that person just now.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
              <Text style={styles.eyebrow}>Add someone</Text>

              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.name}
                value={name}
                onChangeText={setName}
                placeholder="Their name"
                placeholderTextColor={colors.inkFaint}
                autoFocus
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={60}
                returnKeyType="next"
              />

              <Text style={[styles.label, styles.gap]}>Things to remember about {first}</Text>
              <Text style={styles.hint}>Optional — a birthday, what they like, how you know them.</Text>
              {facts.map((fact, i) => (
                <TextInput
                  key={i}
                  style={styles.fact}
                  value={fact}
                  onChangeText={(v) => setFacts((all) => all.map((f, j) => (j === i ? v : f)))}
                  placeholder={i === 0 ? `${first === 'them' ? 'Their' : `${first}’s`} birthday is 12 May` : 'Something else'}
                  placeholderTextColor={colors.inkFaint}
                  multiline
                />
              ))}
              {facts.length < MAX_FACTS && facts[facts.length - 1].trim() ? (
                <Pressable onPress={() => setFacts((all) => [...all, ''])} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.more}>+ Add another</Text>
                </Pressable>
              ) : null}

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
                  <Text style={styles.primaryText}>{saving ? 'Saving' : 'Save'}</Text>
                </Pressable>
              </View>
            </ScrollView>
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
    maxHeight: '88%',
    backgroundColor: colors.base,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  content: { padding: spacing.space5, paddingBottom: spacing.space6, gap: spacing.space2 },
  eyebrow: { ...text.label, color: colors.markRing, marginBottom: spacing.space2 },
  label: { ...text.caption, color: colors.inkMuted },
  gap: { marginTop: spacing.space4 },
  hint: { ...text.caption, color: colors.inkFaint },
  // The user's own words are Fraunces (AGENTS §7).
  name: {
    ...text.displayL,
    color: colors.ink,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.accent,
    paddingVertical: spacing.space2,
  },
  fact: {
    ...text.memory,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.space3,
    paddingVertical: spacing.space2,
    minHeight: 48,
  },
  more: { ...text.bodyStrong, color: colors.markRing, paddingVertical: spacing.space2 },
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
