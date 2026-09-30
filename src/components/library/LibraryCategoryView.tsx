import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet } from '@/components/ActionSheet';
import {
  createLibraryNote,
  deleteLibraryCategory,
  deleteLibraryNote,
  fetchLibraryCategory,
  logFailure,
  renameLibraryCategory,
  updateLibraryNote,
  userMessage,
  type LibraryCategory,
  type LibraryNote,
} from '@/services/interpretationService';
import { colors, radius, spacing, text } from '@/theme/theme';

import { CategorySheet } from './CategorySheet';
import { AddBox, BoxGrid, NoteBox } from './LibraryBoxes';
import { LibraryNoteEditor } from './LibraryNoteEditor';

const ICONS = {
  back: require('@/assets/images/icons/chevron-left.png'),
  search: require('@/assets/images/icons/search.png'),
};

export type LibraryCategoryViewProps = {
  /** The category to open; null keeps the page closed. */
  category: LibraryCategory | null;
  onClose: () => void;
  /** Anything that changes the Library's list (count, name, deletion). */
  onChanged: () => void;
};

/** Words in the title or body, all of them, in any order. */
function matches(note: LibraryNote, query: string): boolean {
  const haystack = `${note.title ?? ''}\n${note.body}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/**
 * An open category: its notes as note-coloured boxes, two to a row, with a
 * search bar that filters them as you type and a box to write a new one.
 */
export function LibraryCategoryView({ category, onClose, onChanged }: LibraryCategoryViewProps) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(category?.name ?? '');
  const [notes, setNotes] = useState<LibraryNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<LibraryNote | 'new' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const id = category?.id ?? null;

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLibraryCategory(id);
      setName(data.category.name);
      setNotes(data.notes);
    } catch (caught) {
      logFailure('Loading a library category failed:', caught);
      setError(userMessage(caught, 'This category couldn’t load. Try again.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setQuery('');
    setNotes([]);
    setName(category?.name ?? '');
    void load();
  }, [id, category?.name, load]);

  const shown = useMemo(
    () => (query.trim() ? notes.filter((n) => matches(n, query.trim())) : notes),
    [notes, query]
  );

  const saveNote = async (value: { title: string | null; body: string }) => {
    if (!id || !editing) return;
    try {
      if (editing === 'new') {
        const created = await createLibraryNote(id, value);
        setNotes((current) => [created, ...current]);
      } else {
        const updated = await updateLibraryNote(editing.id, value);
        setNotes((current) => [updated, ...current.filter((n) => n.id !== updated.id)]);
      }
      onChanged();
    } catch (caught) {
      logFailure('Saving a library note failed:', caught);
      throw new Error(userMessage(caught, 'That note didn’t save. Try again.'));
    }
  };

  const removeNote = async (note: LibraryNote) => {
    try {
      await deleteLibraryNote(note.id);
      setNotes((current) => current.filter((n) => n.id !== note.id));
      onChanged();
    } catch (caught) {
      logFailure('Deleting a library note failed:', caught);
      throw new Error(userMessage(caught, 'That note wasn’t deleted. Try again.'));
    }
  };

  const rename = async (next: string) => {
    if (!id) return;
    try {
      const updated = await renameLibraryCategory(id, next);
      setName(updated.name);
      onChanged();
    } catch (caught) {
      logFailure('Renaming a library category failed:', caught);
      throw new Error(userMessage(caught, 'That category wasn’t renamed. Try again.'));
    }
  };

  const confirmDeleteCategory = () => {
    if (!id) return;
    const count = notes.length;
    Alert.alert(
      `Delete “${name}”?`,
      count > 0
        ? `Its ${count === 1 ? 'note' : `${count} notes`} will be deleted with it.`
        : 'This category is empty.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteLibraryCategory(id)
              .then(() => {
                onChanged();
                onClose();
              })
              .catch((caught: unknown) => {
                logFailure('Deleting a library category failed:', caught);
                Alert.alert('Not deleted', userMessage(caught, 'That category wasn’t deleted. Try again.'));
              });
          },
        },
      ]
    );
  };

  const searching = query.trim().length > 0;

  return (
    <Modal visible={Boolean(category)} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + spacing.space4 }]}>
        <View style={styles.bar}>
          <Pressable
            style={styles.backBtn}
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back to the library"
          >
            <Image source={ICONS.back} style={styles.backIcon} />
          </Pressable>
          <Pressable onPress={() => setMenuOpen(true)} hitSlop={8} accessibilityRole="button">
            <Text style={styles.more}>Edit</Text>
          </Pressable>
        </View>

        <Text style={styles.eyebrow}>Library</Text>
        <Text style={styles.heading} numberOfLines={2}>
          {name}
        </Text>

        <View style={styles.searchRow}>
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder={`Search notes in ${name}`}
            placeholderTextColor={colors.inkFaint}
            underlineColorAndroid="transparent"
            numberOfLines={1}
            returnKeyType="search"
          />
          <Image source={ICONS.search} style={styles.searchIcon} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.space6 }]}
        >
          {searching && !loading && !error ? (
            <View style={styles.searchHead}>
              <Text style={styles.searchCount}>
                {shown.length === 0
                  ? 'No notes match'
                  : `${shown.length} ${shown.length === 1 ? 'match' : 'matches'}`}
              </Text>
              <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button">
                <Text style={styles.searchClear}>Clear</Text>
              </Pressable>
            </View>
          ) : null}

          {loading ? (
            <Text style={styles.empty}>Loading…</Text>
          ) : error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={() => void load()} hitSlop={8} accessibilityRole="button">
                <Text style={styles.searchClear}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <BoxGrid>
              {[
                ...(searching
                  ? []
                  : [<AddBox key="add" label="New note" onPress={() => setEditing('new')} />]),
                ...shown.map((note) => (
                  <NoteBox key={note.id} note={note} onPress={() => setEditing(note)} />
                )),
              ]}
            </BoxGrid>
          )}
          {!loading && !error && notes.length === 0 ? (
            <Text style={styles.hint}>Write the first note for {name}.</Text>
          ) : null}
        </ScrollView>
      </View>

      <LibraryNoteEditor
        visible={editing !== null}
        categoryName={name}
        note={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSave={saveNote}
        onDelete={editing && editing !== 'new' ? () => removeNote(editing) : undefined}
      />

      <ActionSheet
        visible={menuOpen}
        title={name}
        onClose={() => setMenuOpen(false)}
        actions={[
          {
            label: 'Rename',
            onPress: () => {
              setMenuOpen(false);
              setRenaming(true);
            },
          },
          {
            label: 'Delete category',
            destructive: true,
            onPress: () => {
              setMenuOpen(false);
              confirmDeleteCategory();
            },
          },
        ]}
      />

      <CategorySheet
        visible={renaming}
        initialName={name}
        onClose={() => setRenaming(false)}
        onSave={rename}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space5 },
  bar: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  backIcon: { width: 20, height: 20, tintColor: colors.ink },
  more: { ...text.bodyStrong, color: colors.markRing },
  eyebrow: {
    ...text.label,
    letterSpacing: 1.5,
    color: colors.markRing,
    marginTop: spacing.space3,
    marginBottom: spacing.space1,
  },
  heading: { ...text.displayL, color: colors.ink, marginBottom: spacing.space4 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.space4,
    gap: spacing.space2,
  },
  search: { ...text.body, flex: 1, color: colors.ink, paddingVertical: spacing.space3 },
  searchIcon: { width: 16, height: 16, tintColor: colors.markRing },
  body: { paddingTop: spacing.space4, gap: spacing.space3 },
  searchHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  searchCount: { ...text.caption, color: colors.inkMuted, flexShrink: 1 },
  searchClear: { ...text.bodyStrong, color: colors.markRing },
  empty: { ...text.body, color: colors.inkFaint, textAlign: 'center', marginTop: spacing.space8 },
  errorBox: { alignItems: 'center', gap: spacing.space2, marginTop: spacing.space8 },
  errorText: { ...text.body, color: colors.alarmText, textAlign: 'center' },
  hint: { ...text.caption, color: colors.inkMuted, textAlign: 'center', marginTop: spacing.space2 },
});
