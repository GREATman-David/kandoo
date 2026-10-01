import { useEffect, useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  createLibraryCategory,
  createLibraryNote,
  deleteTeamFile,
  fetchLibrary,
  fetchTeamFile,
  logFailure,
  openInWord,
  openTeamFile,
  userMessage,
  type TeamFile,
} from '@/services/interpretationService';
import { colors, radius, spacing, text } from '@/theme/theme';
import { timeAgo } from '@/utils/timeAgo';

const ICONS = { back: require('@/assets/images/icons/chevron-left.png') };

function linksIn(body: string): string[] {
  const found = body.match(/https?:\/\/[^\s)\]]+/g) ?? [];
  return [...new Set(found.map((url) => url.replace(/[.,;:]+$/, '')))].slice(0, 20);
}

/**
 * One shared file. Notes and research read here, open in Word, and save into
 * your own Library; documents and photos open in the phone's app for them.
 */
export function TeamFileReader({
  file,
  canRemove,
  onClose,
  onRemoved,
}: {
  file: TeamFile | null;
  canRemove: boolean;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [text_, setText] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('Team');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    setText(file.body);
    fetchTeamFile(file.id)
      .then((data) => {
        setText(data.text ?? data.file.body);
        setTeamName(data.teamName);
      })
      .catch((caught: unknown) => logFailure('Opening a team file failed:', caught));
  }, [file]);

  const isText = file?.kind === 'note' || file?.kind === 'research';

  const act = async (label: string, work: () => Promise<void>, failMessage: string) => {
    setBusy(label);
    try {
      await work();
    } catch (caught) {
      logFailure(`${label} failed:`, caught);
      Alert.alert('That didn’t work', userMessage(caught, failMessage));
    } finally {
      setBusy(null);
    }
  };

  /** File it on a Library shelf named after the team, making the shelf if needed. */
  const saveToLibrary = () =>
    act(
      'Saving',
      async () => {
        if (!file || !text_) return;
        const shelves = await fetchLibrary();
        const shelf =
          shelves.find((c) => c.name.toLowerCase() === teamName.toLowerCase()) ?? (await createLibraryCategory(teamName));
        await createLibraryNote(
          shelf.id,
          { title: file.title, body: `${text_}\n\nShared by ${file.senderName} in ${teamName}.` },
          file.kind === 'research' ? 'research' : 'manual'
        );
        Alert.alert('Saved', `It’s in your Library under “${shelf.name}”.`);
      },
      'It wasn’t saved. Try again.'
    );

  const remove = () => {
    if (!file) return;
    Alert.alert('Remove from the team?', 'Everyone in the team will stop seeing it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void act('Removing', async () => { await deleteTeamFile(file.id); onRemoved(); }, 'It wasn’t removed.'),
      },
    ]);
  };

  return (
    <Modal visible={file !== null} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + spacing.space4 }]}>
        <View style={styles.bar}>
          <Pressable style={styles.backBtn} onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
            <Image source={ICONS.back} style={styles.backIcon} />
          </Pressable>
          {canRemove ? (
            <Pressable onPress={remove} hitSlop={8} accessibilityRole="button">
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + spacing.space7 }}>
          <Text style={styles.eyebrow}>
            {file?.kind === 'research' ? 'Research' : file?.kind === 'note' ? 'Note' : file?.kind === 'photo' ? 'Photo' : 'Document'} ·{' '}
            {teamName}
          </Text>
          <Text style={styles.title}>{file?.title}</Text>
          <Text style={styles.meta}>
            Shared by {file?.fromMe ? 'you' : file?.senderName} · {file ? timeAgo(file.createdAt).toLowerCase() : ''}
          </Text>
          {file?.message ? <Text style={styles.message}>“{file.message}”</Text> : null}

          <View style={styles.actions}>
            {isText && file ? (
              <Pressable
                style={styles.primary}
                onPress={() => void act('Opening in Word', () => openInWord({ kind: 'team', fileId: file.id }, file.title), 'It didn’t open. Is Word installed?')}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>{busy === 'Opening in Word' ? 'Opening…' : 'Open in Word'}</Text>
              </Pressable>
            ) : file ? (
              <Pressable
                style={styles.primary}
                onPress={() => void act('Opening', () => openTeamFile(file), 'It didn’t open. Try again.')}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>{busy === 'Opening' ? 'Opening…' : `Open ${file.fileName ?? 'file'}`}</Text>
              </Pressable>
            ) : null}
            {text_ ? (
              <Pressable style={styles.secondary} onPress={() => void saveToLibrary()} accessibilityRole="button">
                <Text style={styles.secondaryText}>{busy === 'Saving' ? 'Saving…' : 'Save to my Library'}</Text>
              </Pressable>
            ) : null}
          </View>

          {text_ ? (
            <>
              {!isText ? <Text style={styles.label}>What it says</Text> : null}
              <View style={styles.page}>
                <Text style={styles.body} selectable>
                  {isText ? text_ : text_.length > 3000 ? `${text_.slice(0, 3000)}…` : text_}
                </Text>
              </View>
              {linksIn(text_).length > 0 ? (
                <View style={styles.links}>
                  <Text style={styles.label}>Links</Text>
                  {linksIn(text_).map((url) => (
                    <Pressable key={url} onPress={() => void Linking.openURL(url).catch((e: unknown) => logFailure('Opening a link failed:', e))}>
                      <Text style={styles.link} numberOfLines={1}>
                        {url.replace(/^https?:\/\//, '')}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {!isText ? <Text style={styles.hint}>Ask Mr. Kandoo about this file — he can read it with you.</Text> : null}
            </>
          ) : file && !isText ? (
            <Text style={styles.hint}>Kandoo is still reading this file. Its text will appear here, and in search, shortly.</Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space5 },
  bar: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  backIcon: { width: 20, height: 20, tintColor: colors.ink },
  remove: { ...text.bodyStrong, color: colors.alarmText },
  eyebrow: { ...text.label, letterSpacing: 1.5, color: colors.markRing, marginTop: spacing.space2 },
  title: { ...text.displayL, color: colors.ink, marginTop: spacing.space1 },
  meta: { ...text.caption, color: colors.inkMuted, marginTop: spacing.space1 },
  message: { ...text.body, color: colors.ink, fontStyle: 'italic', marginTop: spacing.space3 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2, marginVertical: spacing.space4 },
  primary: {
    minHeight: 48,
    paddingHorizontal: spacing.space5,
    borderRadius: radius.full,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { ...text.bodyStrong, color: colors.ink },
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
  label: { ...text.label, letterSpacing: 1.5, color: colors.markRing, marginBottom: spacing.space2 },
  page: { padding: spacing.space4, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  body: { ...text.memory, fontSize: 16, lineHeight: 24, color: colors.ink },
  links: { marginTop: spacing.space4, gap: spacing.space2 },
  link: { ...text.body, color: colors.focus, textDecorationLine: 'underline' },
  hint: { ...text.caption, color: colors.inkMuted, marginTop: spacing.space4, textAlign: 'center' },
});
