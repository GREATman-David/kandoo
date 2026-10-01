import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet, type SheetAction } from '@/components/ActionSheet';
import { TimeEntry } from '@/components/TimeEntry';
import { DocumentTooLargeError, pickDocument } from '@/services/documents';
import {
  deleteTeam,
  fetchTeam,
  fetchTeamFiles,
  fetchTeamTasks,
  leaveTeam,
  logFailure,
  markTeamTaskDone,
  regenerateInvite,
  removeMember,
  respondTeamTask,
  sendTeamTask,
  setMemberRole,
  shareTextToTeam,
  uploadTeamFile,
  userMessage,
  type TeamFile,
  type TeamMember,
  type TeamSummary,
  type TeamTask,
} from '@/services/interpretationService';
import { scheduleReminder } from '@/services/localNotifications';
import { PhotoPermissionError, alertCameraOff, pickPhoto } from '@/services/photos';
import { colors, radius, spacing, text, withOpacity } from '@/theme/theme';
import { formatDueDate } from '@/utils/formatDueDate';
import { timeAgo } from '@/utils/timeAgo';

import { ShareNoteSheet } from './ShareNoteSheet';
import { TeamFileReader } from './TeamFileReader';

const ICONS = {
  back: require('@/assets/images/icons/chevron-left.png'),
  search: require('@/assets/images/icons/search.png'),
  note: require('@/assets/images/icons/file-text.png'),
  photo: require('@/assets/images/icons/camera.png'),
};

type Tab = 'files' | 'tasks' | 'people';

const KIND_LABEL: Record<TeamFile['kind'], string> = {
  note: 'Note',
  research: 'Research',
  document: 'Document',
  photo: 'Photo',
};

function fileTypeLabel(file: TeamFile): string {
  if (file.kind !== 'document') return KIND_LABEL[file.kind];
  const ext = file.fileName?.split('.').pop()?.toUpperCase();
  return ext ? `${ext} document` : 'Document';
}

/**
 * One team's space: what members shared (and who), the tasks going round, and
 * who's in it. Admins invite, send tasks and manage members.
 */
export function TeamSpace({ team, onClose }: { team: TeamSummary | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('files');
  const [summary, setSummary] = useState<TeamSummary | null>(team);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [files, setFiles] = useState<TeamFile[]>([]);
  const [tasks, setTasks] = useState<TeamTask[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [shareMenu, setShareMenu] = useState(false);
  const [noteSheet, setNoteSheet] = useState<'library' | 'write' | null>(null);
  const [reading, setReading] = useState<TeamFile | null>(null);
  const [taskSheet, setTaskSheet] = useState(false);
  const [memberMenu, setMemberMenu] = useState<TeamMember | null>(null);

  const id = team?.id ?? null;
  const isAdmin = summary?.role === 'owner' || summary?.role === 'admin';

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [detail, shared, sent] = await Promise.all([fetchTeam(id), fetchTeamFiles(id), fetchTeamTasks(id)]);
      setSummary(detail.team);
      setMembers(detail.members);
      setFiles(shared);
      setTasks(sent);
    } catch (caught) {
      logFailure('Loading a team failed:', caught);
      setError(userMessage(caught, 'This team couldn’t load. Try again.'));
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setTab('files');
    setQuery('');
    setSummary(team);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Search runs on the server (it also matches text inside documents).
  useEffect(() => {
    if (!id) return;
    const t = setTimeout(() => {
      fetchTeamFiles(id, query)
        .then(setFiles)
        .catch((caught: unknown) => logFailure('Searching team files failed:', caught));
    }, 300);
    return () => clearTimeout(t);
  }, [id, query]);

  const run = async (label: string, work: () => Promise<unknown>, failMessage: string) => {
    setBusy(label);
    try {
      await work();
      await load();
    } catch (caught) {
      logFailure(`${label} failed:`, caught);
      Alert.alert('That didn’t work', caught instanceof DocumentTooLargeError ? caught.message : userMessage(caught, failMessage));
    } finally {
      setBusy(null);
    }
  };

  const shareDocument = () => {
    if (!id) return;
    void run(
      'Sharing a document',
      async () => {
        const picked = await pickDocument();
        if (!picked) return;
        await uploadTeamFile(id, { base64: picked.base64, mimeType: picked.mimeType, name: picked.name });
      },
      'That file wasn’t shared. Try again.'
    );
  };

  const sharePhoto = (source: 'camera' | 'library') => {
    if (!id) return;
    void run(
      'Sharing a photo',
      async () => {
        let photo;
        try {
          photo = await pickPhoto(source);
        } catch (caught) {
          if (caught instanceof PhotoPermissionError) {
            alertCameraOff(caught);
            return;
          }
          throw caught;
        }
        if (!photo) return;
        await uploadTeamFile(id, { base64: photo.base64, mimeType: 'image/jpeg', name: `Photo ${new Date().toLocaleDateString()}.jpg` });
      },
      'That photo wasn’t shared. Try again.'
    );
  };

  const shareActions: SheetAction[] = [
    { label: 'A note from my Library', onPress: () => { setShareMenu(false); setNoteSheet('library'); } },
    { label: 'A document — PDF, Word, slides…', onPress: () => { setShareMenu(false); shareDocument(); } },
    { label: 'Take a photo', onPress: () => { setShareMenu(false); setTimeout(() => sharePhoto('camera'), 250); } },
    { label: 'A photo from my gallery', onPress: () => { setShareMenu(false); setTimeout(() => sharePhoto('library'), 250); } },
    { label: 'Write a note for the team', onPress: () => { setShareMenu(false); setNoteSheet('write'); } },
  ];

  const invite = async () => {
    if (!summary?.inviteLink || !summary.inviteCode) return;
    try {
      await Share.share({
        message: `Join “${summary.name}” on Kandoo: ${summary.inviteLink}\n\nOr open Kandoo → Memory → Team → Join, and enter ${summary.inviteCode}.`,
      });
    } catch (caught) {
      logFailure('Sharing an invite failed:', caught);
    }
  };

  const confirmLeave = () => {
    if (!id || !summary) return;
    const owner = summary.role === 'owner';
    Alert.alert(
      owner ? `Delete “${summary.name}”?` : `Leave “${summary.name}”?`,
      owner
        ? 'Everyone loses the team’s files and tasks. This can’t be undone.'
        : 'You’ll stop seeing its files and tasks. An admin can invite you back.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: owner ? 'Delete team' : 'Leave',
          style: 'destructive',
          onPress: () => {
            (owner ? deleteTeam(id) : leaveTeam(id))
              .then(onClose)
              .catch((caught: unknown) => {
                logFailure('Leaving a team failed:', caught);
                Alert.alert('That didn’t work', userMessage(caught, 'Try again in a moment.'));
              });
          },
        },
      ]
    );
  };

  const answerTask = (task: TeamTask, accept: boolean) =>
    run(
      'Answering a task',
      async () => {
        const { reminder } = await respondTeamTask(task.id, accept);
        if (reminder) await scheduleReminder(reminder);
      },
      'That didn’t go through. Try again.'
    );

  const memberActions = (member: TeamMember): SheetAction[] => {
    if (!id) return [];
    const actions: SheetAction[] = [];
    if (summary?.role === 'owner' && member.role !== 'owner') {
      actions.push(
        member.role === 'admin'
          ? { label: 'Make a member', onPress: () => { setMemberMenu(null); void run('Changing a role', () => setMemberRole(id, member.userId, 'member'), 'The role didn’t change.'); } }
          : { label: 'Make an admin', onPress: () => { setMemberMenu(null); void run('Changing a role', () => setMemberRole(id, member.userId, 'admin'), 'The role didn’t change.'); } }
      );
    }
    if (isAdmin && member.role !== 'owner' && !member.isMe) {
      actions.push({
        label: `Remove ${member.name}`,
        destructive: true,
        onPress: () => {
          setMemberMenu(null);
          void run('Removing a member', () => removeMember(id, member.userId), 'They weren’t removed.');
        },
      });
    }
    return actions;
  };

  return (
    <Modal visible={team !== null} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + spacing.space4 }]}>
        <View style={styles.bar}>
          <Pressable style={styles.backBtn} onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
            <Image source={ICONS.back} style={styles.backIcon} />
          </Pressable>
          {busy ? <Text style={styles.busy}>{busy}…</Text> : null}
        </View>

        <Text style={styles.eyebrow}>Team</Text>
        <Text style={styles.heading} numberOfLines={2}>
          {summary?.name}
        </Text>
        {summary?.purpose ? <Text style={styles.purpose}>{summary.purpose}</Text> : null}

        <View style={styles.tabs} accessibilityRole="tablist">
          {(['files', 'tasks', 'people'] as const).map((option) => (
            <Pressable
              key={option}
              style={[styles.tab, tab === option && styles.tabOn]}
              onPress={() => setTab(option)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === option }}
            >
              <Text style={[styles.tabText, tab === option && styles.tabTextOn]}>
                {option === 'files' ? 'Files' : option === 'tasks' ? 'Tasks' : `People · ${members.length}`}
              </Text>
            </Pressable>
          ))}
        </View>

        {error ? (
          <Pressable onPress={() => void load()}>
            <Text style={styles.errorText}>{error}</Text>
          </Pressable>
        ) : null}

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.space7 }]}
        >
          {tab === 'files' ? (
            <>
              <View style={styles.searchRow}>
                <TextInput
                  style={styles.search}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search the team’s files"
                  placeholderTextColor={colors.inkFaint}
                  underlineColorAndroid="transparent"
                  returnKeyType="search"
                />
                <Image source={ICONS.search} style={styles.searchIcon} />
              </View>
              <Pressable style={styles.primary} onPress={() => setShareMenu(true)} accessibilityRole="button">
                <Text style={styles.primaryText}>Share with the team</Text>
              </Pressable>
              {files.length === 0 ? (
                <Text style={styles.dim}>
                  {query ? 'Nothing matches.' : 'Nothing shared yet. Notes, research, photos and documents you share appear here for everyone.'}
                </Text>
              ) : null}
              {files.map((file) => (
                <Pressable
                  key={file.id}
                  style={({ pressed }) => [styles.fileRow, pressed && { opacity: 0.85 }]}
                  onPress={() => setReading(file)}
                  accessibilityRole="button"
                >
                  <View style={styles.fileHead}>
                    <Image source={file.kind === 'photo' ? ICONS.photo : ICONS.note} style={styles.fileIcon} />
                    <Text style={styles.fileKind}>{fileTypeLabel(file)}</Text>
                  </View>
                  <Text style={styles.fileTitle} numberOfLines={2}>
                    {file.title}
                  </Text>
                  {file.message ? <Text style={styles.fileMessage}>“{file.message}”</Text> : null}
                  <Text style={styles.fileMeta}>
                    {file.fromMe ? 'You' : file.senderName} · {timeAgo(file.createdAt).toLowerCase()}
                  </Text>
                </Pressable>
              ))}
            </>
          ) : tab === 'tasks' ? (
            <>
              {isAdmin ? (
                <Pressable style={styles.primary} onPress={() => setTaskSheet(true)} accessibilityRole="button">
                  <Text style={styles.primaryText}>Send a task</Text>
                </Pressable>
              ) : null}
              {tasks.length === 0 ? (
                <Text style={styles.dim}>
                  {isAdmin ? 'Send the team a task — it reaches their reminders once they accept it.' : 'No tasks yet.'}
                </Text>
              ) : null}
              {tasks.map((task) => {
                const recipients = task.counts.sent + task.counts.accepted + task.counts.declined + task.counts.done;
                return (
                  <View key={task.id} style={styles.fileRow}>
                    <Text style={styles.fileTitle}>{task.task}</Text>
                    <Text style={styles.fileMeta}>
                      {formatDueDate(task.dueAt) ?? 'No time'} · from {task.fromMe ? 'you' : task.senderName}
                    </Text>
                    <Text style={styles.progress}>
                      {task.counts.done} of {recipients} done · {task.counts.accepted} accepted
                      {task.counts.declined ? ` · ${task.counts.declined} declined` : ''}
                    </Text>
                    {task.myStatus === 'sent' ? (
                      <View style={styles.actions}>
                        <Pressable style={styles.secondary} onPress={() => void answerTask(task, false)}>
                          <Text style={styles.secondaryText}>Decline</Text>
                        </Pressable>
                        <Pressable style={[styles.primary, styles.flex]} onPress={() => void answerTask(task, true)}>
                          <Text style={styles.primaryText}>Accept</Text>
                        </Pressable>
                      </View>
                    ) : task.myStatus === 'accepted' ? (
                      <Pressable
                        style={styles.secondary}
                        onPress={() => void run('Marking it done', () => markTeamTaskDone(task.id), 'That didn’t go through.')}
                      >
                        <Text style={styles.secondaryText}>Mark done</Text>
                      </Pressable>
                    ) : task.myStatus === 'done' ? (
                      <Text style={styles.doneLabel}>You did this</Text>
                    ) : null}
                  </View>
                );
              })}
            </>
          ) : (
            <>
              {isAdmin && summary?.inviteLink ? (
                <View style={styles.inviteCard}>
                  <Text style={styles.inviteTitle}>Invite people</Text>
                  <Text style={styles.inviteCode}>{summary.inviteCode}</Text>
                  <Text style={styles.fileMeta}>Anyone with this link or code can join while it’s active.</Text>
                  <View style={styles.actions}>
                    <Pressable
                      style={styles.secondary}
                      onPress={() =>
                        void run('Making a new link', async () => {
                          await regenerateInvite(summary.id);
                        }, 'A new link wasn’t made.')
                      }
                    >
                      <Text style={styles.secondaryText}>New link</Text>
                    </Pressable>
                    <Pressable style={[styles.primary, styles.flex]} onPress={() => void invite()}>
                      <Text style={styles.primaryText}>Share invite</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
              {members.map((member) => (
                <Pressable
                  key={member.userId}
                  style={styles.memberRow}
                  onPress={() => (memberActions(member).length ? setMemberMenu(member) : undefined)}
                  accessibilityRole="button"
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{member.name.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.memberName}>
                      {member.name}
                      {member.isMe ? ' (you)' : ''}
                    </Text>
                    <Text style={styles.fileMeta}>
                      {member.role === 'owner' ? 'Owner' : member.role === 'admin' ? 'Admin' : 'Member'} · joined{' '}
                      {timeAgo(member.joinedAt).toLowerCase()}
                    </Text>
                  </View>
                </Pressable>
              ))}
              <Pressable style={styles.leave} onPress={confirmLeave} accessibilityRole="button">
                <Text style={styles.leaveText}>{summary?.role === 'owner' ? 'Delete this team' : 'Leave this team'}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>

      <ActionSheet visible={shareMenu} title="Share with the team" actions={shareActions} onClose={() => setShareMenu(false)} />
      <ActionSheet
        visible={memberMenu !== null}
        title={memberMenu?.name}
        actions={memberMenu ? memberActions(memberMenu) : []}
        onClose={() => setMemberMenu(null)}
      />

      <ShareNoteSheet
        mode={noteSheet}
        teamName={summary?.name ?? 'the team'}
        onClose={() => setNoteSheet(null)}
        onShare={async (note) => {
          if (!id) return;
          await shareTextToTeam(id, note);
          setNoteSheet(null);
          await load();
        }}
      />

      <TeamFileReader
        file={reading}
        canRemove={Boolean(reading && (reading.fromMe || isAdmin))}
        onClose={() => setReading(null)}
        onRemoved={() => {
          setReading(null);
          void load();
        }}
      />

      <TaskSheet
        visible={taskSheet}
        members={members.filter((m) => !m.isMe)}
        onClose={() => setTaskSheet(false)}
        onSend={async (input) => {
          if (!id) return;
          await sendTeamTask(id, input);
          setTaskSheet(false);
          await load();
        }}
      />
    </Modal>
  );
}

/** An admin's task: what, when, and to whom (everyone, or one person). */
function TaskSheet({
  visible,
  members,
  onClose,
  onSend,
}: {
  visible: boolean;
  members: TeamMember[];
  onClose: () => void;
  onSend: (input: { task: string; dueAt: string; assigneeId: string | null }) => Promise<void>;
}) {
  const [task, setTask] = useState('');
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setTask('');
      setDueAt(null);
      setAssignee(null);
      setError(null);
    }
  }, [visible]);

  const ready = task.trim().length > 0 && Boolean(dueAt);

  const send = async () => {
    if (!ready || !dueAt || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend({ task: task.trim(), dueAt, assigneeId: assignee });
    } catch (caught) {
      logFailure('Sending a team task failed:', caught);
      setError(userMessage(caught, 'That task wasn’t sent. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.eyebrow}>Team task</Text>
            <Text style={styles.sheetTitle}>Send a task</Text>
            <Text style={styles.fileMeta}>It reaches their reminders once they accept it.</Text>
            <TextInput
              style={styles.input}
              value={task}
              onChangeText={setTask}
              placeholder="Submit the budget draft"
              placeholderTextColor={colors.inkFaint}
              maxLength={300}
              autoFocus
              underlineColorAndroid="transparent"
            />
            <Pressable style={styles.secondary} onPress={() => setPicking(true)} accessibilityRole="button">
              <Text style={styles.secondaryText}>{dueAt ? formatDueDate(dueAt) : 'Choose when'}</Text>
            </Pressable>
            <Text style={[styles.fileMeta, { marginTop: spacing.space2 }]}>To</Text>
            <View style={styles.chips}>
              {[{ userId: null as string | null, name: 'Everyone' }, ...members].map((m) => (
                <Pressable
                  key={m.userId ?? 'all'}
                  style={[styles.chip, assignee === m.userId && styles.chipOn]}
                  onPress={() => setAssignee(m.userId)}
                  accessibilityRole="button"
                >
                  <Text style={styles.chipText}>{m.name}</Text>
                </Pressable>
              ))}
            </View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <View style={styles.actions}>
              <Pressable style={styles.secondary} onPress={onClose}>
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.primary, styles.flex, (!ready || busy) && styles.disabled]}
                onPress={() => void send()}
                disabled={!ready || busy}
              >
                <Text style={styles.primaryText}>{busy ? 'Sending' : 'Send task'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
      <TimeEntry
        visible={picking}
        initialISO={dueAt}
        saveLabel="Set time"
        onClose={() => setPicking(false)}
        onSave={(iso) => {
          setDueAt(iso);
          setPicking(false);
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space5 },
  bar: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  backIcon: { width: 20, height: 20, tintColor: colors.ink },
  busy: { ...text.caption, color: colors.inkMuted },
  eyebrow: { ...text.label, letterSpacing: 1.5, color: colors.markRing, marginTop: spacing.space2 },
  heading: { ...text.displayL, color: colors.ink, marginTop: spacing.space1 },
  purpose: { ...text.body, color: colors.inkMuted, marginTop: spacing.space1 },
  tabs: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    padding: 3,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    marginTop: spacing.space4,
  },
  tab: { minHeight: 36, paddingHorizontal: spacing.space4, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.surfaceRaised },
  tabText: { ...text.bodyStrong, color: colors.inkMuted },
  tabTextOn: { color: colors.ink },
  body: { paddingTop: spacing.space4, gap: spacing.space3 },
  dim: { ...text.body, color: colors.inkMuted, textAlign: 'center', marginTop: spacing.space3 },
  errorText: { ...text.body, color: colors.alarmText, marginTop: spacing.space3 },
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
  fileRow: {
    padding: spacing.space4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    gap: 4,
  },
  fileHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  fileIcon: { width: 16, height: 16, tintColor: colors.markRing },
  fileKind: { ...text.label, letterSpacing: 1.5, color: colors.markRing },
  fileTitle: { ...text.memory, color: colors.ink },
  fileMessage: { ...text.body, color: colors.ink, fontStyle: 'italic' },
  fileMeta: { ...text.caption, color: colors.inkMuted },
  progress: { ...text.caption, color: colors.settled },
  doneLabel: { ...text.bodyStrong, color: colors.settled },
  inviteCard: {
    padding: spacing.space4,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.markCore,
    backgroundColor: colors.surface,
    gap: spacing.space1,
  },
  inviteTitle: { ...text.label, letterSpacing: 1.5, color: colors.markRing },
  inviteCode: { ...text.displayL, letterSpacing: 4, color: colors.ink },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3, paddingVertical: spacing.space2 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.accentWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...text.bodyStrong, color: colors.markRing },
  memberName: { ...text.bodyStrong, color: colors.ink },
  leave: { paddingVertical: spacing.space4, alignItems: 'center' },
  leaveText: { ...text.bodyStrong, color: colors.alarmText },
  actions: { flexDirection: 'row', gap: spacing.space2, marginTop: spacing.space2 },
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
    minHeight: 44,
    paddingHorizontal: spacing.space5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { ...text.bodyStrong, color: colors.inkMuted },
  disabled: { opacity: 0.5 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: withOpacity(colors.ink, 0.35) },
  sheet: {
    backgroundColor: colors.base,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.space5,
    paddingBottom: spacing.space6,
    gap: spacing.space2,
  },
  sheetTitle: { ...text.displayL, color: colors.ink },
  input: {
    ...text.memory,
    color: colors.ink,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.accent,
    paddingVertical: spacing.space2,
    marginVertical: spacing.space2,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
  chip: {
    paddingHorizontal: spacing.space3,
    paddingVertical: spacing.space2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { borderColor: colors.markCore, backgroundColor: colors.accentWash },
  chipText: { ...text.caption, color: colors.ink },
});
