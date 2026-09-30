import type { ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { LibraryCategory, LibraryNote } from '@/services/interpretationService';
import { colors, fontFamily, radius, spacing, text } from '@/theme/theme';
import { timeAgo } from '@/utils/timeAgo';

/**
 * The Library's boxes, laid out the way "Two ways to see this" lays out a
 * note and a memory (NoteMemoryFork): two cards side by side, the same height
 * in each row, a gap between. Every note wears the note colours; a category
 * is a note-coloured box with a second edge behind it — a stack of notes.
 */

const ICONS = {
  note: require('@/assets/images/icons/file-text.png'),
  plus: require('@/assets/images/icons/plus.png'),
};

/** Two per row, each row as tall as its taller card; an odd last card keeps its half width. */
export function BoxGrid({ children }: { children: ReactNode[] }) {
  const rows: ReactNode[][] = [];
  for (let i = 0; i < children.length; i += 2) rows.push(children.slice(i, i + 2));
  return (
    <View style={styles.grid}>
      {rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((child, c) => (
            <View key={c} style={styles.cell}>
              {child}
            </View>
          ))}
          {row.length === 1 ? <View style={styles.cell} /> : null}
        </View>
      ))}
    </View>
  );
}

export function AddBox({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.box, styles.addBox, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.addIconWrap}>
        <Image source={ICONS.plus} style={styles.addIcon} />
      </View>
      <Text style={styles.addText}>{label}</Text>
    </Pressable>
  );
}

export function CategoryBox({
  category,
  onPress,
  onLongPress,
}: {
  category: LibraryCategory;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const count = category.noteCount;
  return (
    <Pressable
      style={({ pressed }) => [styles.stack, pressed && styles.pressed]}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${category.name}, ${count} ${count === 1 ? 'note' : 'notes'}`}
    >
      {/* The edge of the next note down: this box holds more than one page. */}
      <View style={styles.stackEdge} />
      <View style={[styles.box, styles.noteBox, styles.stackTop]}>
        <View style={styles.head}>
          <Image source={ICONS.note} style={styles.icon} />
          <Text style={styles.label}>{count === 1 ? '1 note' : `${count} notes`}</Text>
        </View>
        <Text style={styles.categoryName} numberOfLines={4}>
          {category.name}
        </Text>
        <Text style={styles.meta}>Updated {timeAgo(category.updated_at).toLowerCase()}</Text>
      </View>
    </Pressable>
  );
}

export function NoteBox({
  note,
  onPress,
  onLongPress,
}: {
  note: LibraryNote;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.box, styles.noteBox, pressed && styles.pressed]}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`Open the note ${note.title ?? note.body.slice(0, 40)}`}
    >
      <View style={styles.head}>
        <Image source={ICONS.note} style={styles.icon} />
        <Text style={styles.label}>{note.source === 'document' ? 'From a page' : 'Note'}</Text>
      </View>
      {note.title ? (
        <Text style={styles.noteTitle} numberOfLines={2}>
          {note.title}
        </Text>
      ) : null}
      <Text style={styles.noteText} numberOfLines={note.title ? 5 : 7}>
        {note.body}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { gap: spacing.space4 },
  // Side by side and always the same height, as in NoteMemoryFork.
  row: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.space4 },
  cell: { flex: 1 },
  box: {
    flex: 1,
    minHeight: 180,
    padding: spacing.space4,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  // The note colours (NoteMemoryFork's Note card).
  noteBox: { backgroundColor: colors.surface, borderColor: colors.line },
  pressed: { opacity: 0.85 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space2,
    marginBottom: spacing.space2,
  },
  icon: { width: 16, height: 16, tintColor: colors.markRing },
  label: { ...text.label, letterSpacing: 1.5, color: colors.markRing },
  noteTitle: {
    fontFamily: fontFamily.displaySemiBold,
    fontSize: 15,
    lineHeight: 21,
    color: colors.ink,
    marginBottom: spacing.space1,
  },
  noteText: {
    fontFamily: fontFamily.displayRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
  },

  // A category: the top note, and the edge of the one beneath it.
  stack: { flex: 1, paddingBottom: 6 },
  stackEdge: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 0,
    top: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
  },
  stackTop: { minHeight: 150 },
  categoryName: {
    fontFamily: fontFamily.displaySemiBold,
    fontSize: 18,
    lineHeight: 24,
    color: colors.ink,
    flexGrow: 1,
  },
  meta: { ...text.caption, fontSize: 12, color: colors.inkMuted, marginTop: spacing.space2 },

  addBox: {
    minHeight: 150,
    borderStyle: 'dashed',
    borderColor: colors.lineStrong,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.space2,
  },
  addIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIcon: { width: 16, height: 16, tintColor: colors.ink },
  addText: { ...text.bodyStrong, color: colors.ink, textAlign: 'center' },
});
