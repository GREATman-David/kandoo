import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  createLibraryCategory,
  fetchLibrary,
  logFailure,
  userMessage,
  type LibraryCategory,
} from '@/services/interpretationService';
import { colors, radius, spacing, text } from '@/theme/theme';

import { CategorySheet } from './CategorySheet';
import { AddBox, BoxGrid, CategoryBox } from './LibraryBoxes';
import { LibraryCategoryView } from './LibraryCategoryView';

const ICONS = {
  search: require('@/assets/images/icons/search.png'),
};

export type LibraryViewProps = {
  /** Bumped by the parent (e.g. on screen focus) to reload the shelves. */
  refreshKey?: number;
};

/**
 * The Library, inside Memory: the user's own notes, stacked in categories
 * they name ("Kandoo Project"). The Library holds categories; a category
 * holds notes. Search matches category names as you type.
 */
export function LibraryView({ refreshKey = 0 }: LibraryViewProps) {
  const [categories, setCategories] = useState<LibraryCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<LibraryCategory | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      setCategories(await fetchLibrary());
    } catch (caught) {
      logFailure('Loading the library failed:', caught);
      setError(userMessage(caught, 'Your library couldn’t load. Try again.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // After the first load, a refresh keeps the shelves on screen while it runs.
    void load(refreshKey > 0);
  }, [load, refreshKey]);

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return categories;
    return categories.filter((c) => words.every((w) => c.name.toLowerCase().includes(w)));
  }, [categories, query]);

  const create = async (name: string) => {
    try {
      const category = await createLibraryCategory(name);
      setCategories((current) => [category, ...current]);
      setQuery('');
      setOpen(category);
    } catch (caught) {
      logFailure('Creating a library category failed:', caught);
      throw new Error(userMessage(caught, 'That category wasn’t made. Try again.'));
    }
  };

  const searching = query.trim().length > 0;

  return (
    <View style={styles.flex}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search categories"
          placeholderTextColor={colors.inkFaint}
          underlineColorAndroid="transparent"
          numberOfLines={1}
          returnKeyType="search"
        />
        <Image source={ICONS.search} style={styles.searchIcon} />
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {searching && !loading && !error ? (
          <View style={styles.searchHead}>
            <Text style={styles.searchCount}>
              {shown.length === 0
                ? 'No category by that name'
                : `${shown.length} ${shown.length === 1 ? 'category' : 'categories'}`}
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
          <>
            <BoxGrid>
              {[
                ...(searching
                  ? []
                  : [<AddBox key="add" label="New category" onPress={() => setCreating(true)} />]),
                ...shown.map((category) => (
                  <CategoryBox
                    key={category.id}
                    category={category}
                    onPress={() => setOpen(category)}
                    onLongPress={() => setOpen(category)}
                  />
                )),
              ]}
            </BoxGrid>
            {categories.length === 0 ? (
              <Text style={styles.hint}>
                Make a category — “Kandoo Project”, “Recipes”, “Lecture notes” — and keep your notes in it.
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>

      <LibraryCategoryView
        category={open}
        onClose={() => setOpen(null)}
        onChanged={() => void load(true)}
      />

      <CategorySheet visible={creating} onClose={() => setCreating(false)} onSave={create} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  body: { paddingTop: spacing.space4, paddingBottom: spacing.space6, gap: spacing.space3 },
  searchHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  searchCount: { ...text.caption, color: colors.inkMuted, flexShrink: 1 },
  searchClear: { ...text.bodyStrong, color: colors.markRing },
  empty: { ...text.body, color: colors.inkFaint, textAlign: 'center', marginTop: spacing.space8 },
  errorBox: { alignItems: 'center', gap: spacing.space2, marginTop: spacing.space8 },
  errorText: { ...text.body, color: colors.alarmText, textAlign: 'center' },
  hint: {
    ...text.caption,
    color: colors.inkMuted,
    textAlign: 'center',
    marginTop: spacing.space2,
    paddingHorizontal: spacing.space4,
  },
});
