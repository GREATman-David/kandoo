import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AddBox, BoxGrid } from '@/components/library/LibraryBoxes';
import {
  createTeam,
  fetchTaskInbox,
  fetchTeams,
  isProRequired,
  joinTeam,
  logFailure,
  respondTeamTask,
  userMessage,
  type TeamSummary,
  type TeamTask,
} from '@/services/interpretationService';
import { scheduleReminder } from '@/services/localNotifications';
import { colors, fontFamily, radius, spacing, text, withOpacity } from '@/theme/theme';
import { formatDueDate } from '@/utils/formatDueDate';
import { timeAgo } from '@/utils/timeAgo';

import { TeamSpace } from './TeamSpace';

const ICONS = { people: require('@/assets/images/icons/user-round.png') };

export type TeamsViewProps = {
  /** Pro or Elite: can be in a team, share files and take tasks. */
  isMember: boolean;
  /** Elite: can start and lead a team (invite, roles, send tasks). */
  canLead: boolean;
  /** Open the paywall on the plan that unlocks what was tapped. */
  onNeedPlan: (plan: 'pro' | 'elite') => void;
  /** An invite code from a link (kandoo://join/CODE), to join straight away. */
  joinCode?: string | null;
  onJoinCodeUsed?: () => void;
  refreshKey?: number;
};

/**
 * Teams (Pro and Elite; leading one is Elite), inside Memory beside the Library: the teams you're in, a
 * banner for tasks your teams sent you, and ways to start or join a team.
 */
export function TeamsView({ isMember, canLead, onNeedPlan, joinCode, onJoinCodeUsed, refreshKey = 0 }: TeamsViewProps) {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [inbox, setInbox] = useState<TeamTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<'create' | 'join' | null>(null);
  const [open, setOpen] = useState<TeamSummary | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);

  const load = useCallback(async () => {
    if (!isMember) return;
    setError(null);
    try {
      const [mine, waiting] = await Promise.all([fetchTeams(), fetchTaskInbox()]);
      setTeams(mine);
      setInbox(waiting);
    } catch (caught) {
      if (isProRequired(caught)) return;
      logFailure('Loading teams failed:', caught);
      setError(userMessage(caught, 'Your teams couldn’t load. Try again.'));
    } finally {
      setLoading(false);
    }
  }, [isMember]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Arrived through an invite link: join, then open the team.
  useEffect(() => {
    if (!joinCode) return;
    onJoinCodeUsed?.();
    if (!isMember) {
      onNeedPlan('pro');
      return;
    }
    joinTeam(joinCode)
      .then((team) => {
        void load();
        setOpen(team);
      })
      .catch((caught: unknown) => {
        logFailure('Joining from a link failed:', caught);
        Alert.alert('Couldn’t join', userMessage(caught, 'That invite link didn’t work. Ask for a new one.'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinCode]);

  if (!isMember) {
    return (
      <View style={styles.locked}>
        <Text style={styles.lockedTitle}>Work together in Teams</Text>
        <Text style={styles.lockedBody}>
          Share notes, research, photos and documents with the people you work with. See who sent what, send
          tasks that land in their reminders, open files in Word, and ask Mr. Kandoo about any of it.
        </Text>
        <Pressable style={styles.primary} onPress={() => onNeedPlan('pro')} accessibilityRole="button">
          <Text style={styles.primaryText}>Teams are part of Kandoo Pro and Elite</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {inbox.length > 0 ? (
          <Pressable style={styles.inbox} onPress={() => setInboxOpen(true)} accessibilityRole="button">
            <Text style={styles.inboxTitle}>
              {inbox.length === 1 ? '1 task from your team' : `${inbox.length} tasks from your teams`}
            </Text>
            <Text style={styles.inboxHint}>Review — accept to add it to your reminders</Text>
          </Pressable>
        ) : null}

        {loading ? (
          <Text style={styles.dim}>Loading…</Text>
        ) : error ? (
          <Pressable onPress={() => void load()} accessibilityRole="button">
            <Text style={styles.errorText}>{error}</Text>
          </Pressable>
        ) : (
          <BoxGrid>
            {[
              <AddBox key="new" label="New team" onPress={() => (canLead ? setForm('create') : onNeedPlan('elite'))} />,
              <AddBox key="join" label="Join with a code" onPress={() => setForm('join')} />,
              ...teams.map((team) => <TeamBox key={team.id} team={team} onPress={() => setOpen(team)} />),
            ]}
          </BoxGrid>
        )}
        {!loading && !error && teams.length === 0 ? (
          <Text style={styles.hint}>
            Start a team and share its link — everyone who joins sees what the team shares, and who shared it.
          </Text>
        ) : null}
      </ScrollView>

      <TeamFormSheet
        mode={form}
        onClose={() => setForm(null)}
        onDone={(team) => {
          setForm(null);
          void load();
          setOpen(team);
        }}
      />

      <TaskInbox visible={inboxOpen} tasks={inbox} onClose={() => setInboxOpen(false)} onAnswered={() => void load()} />

      <TeamSpace
        team={open}
        canLead={canLead}
        onClose={() => {
          setOpen(null);
          void load();
        }}
      />
    </View>
  );
}

function TeamBox({ team, onPress }: { team: TeamSummary; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.teamBox, pressed && { opacity: 0.85 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open the team ${team.name}`}
    >
      <View style={styles.teamHead}>
        <Image source={ICONS.people} style={styles.teamIcon} />
        <Text style={styles.teamLabel}>
          {team.memberCount} {team.memberCount === 1 ? 'member' : 'members'}
        </Text>
      </View>
      <Text style={styles.teamName} numberOfLines={3}>
        {team.name}
      </Text>
      <Text style={styles.teamMeta}>
        {team.fileCount} {team.fileCount === 1 ? 'file' : 'files'} · {timeAgo(team.lastActivity).toLowerCase()}
      </Text>
      {team.role !== 'member' ? <Text style={styles.teamRole}>{team.role === 'owner' ? 'Owner' : 'Admin'}</Text> : null}
    </Pressable>
  );
}

/** Create a team, or join one with a code. */
function TeamFormSheet({
  mode,
  onClose,
  onDone,
}: {
  mode: 'create' | 'join' | null;
  onClose: () => void;
  onDone: (team: TeamSummary) => void;
}) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode) {
      setName('');
      setPurpose('');
      setError(null);
    }
  }, [mode]);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const team = mode === 'create' ? await createTeam({ name: name.trim(), purpose: purpose.trim() || null }) : await joinTeam(name.trim());
      onDone(team);
    } catch (caught) {
      logFailure(mode === 'create' ? 'Creating a team failed:' : 'Joining a team failed:', caught);
      setError(userMessage(caught, 'That didn’t work. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={mode !== null} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.eyebrow}>Teams</Text>
            <Text style={styles.sheetTitle}>{mode === 'create' ? 'A new team' : 'Join a team'}</Text>
            <Text style={styles.sheetHint}>
              {mode === 'create'
                ? 'You’ll get a link to invite people. You can send them tasks, and everyone sees what’s shared.'
                : 'Enter the 8-character code from the invite.'}
            </Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={mode === 'create' ? 'Team name — e.g. Grace Foundation' : 'ABCD2345'}
              placeholderTextColor={colors.inkFaint}
              autoFocus
              autoCapitalize={mode === 'create' ? 'words' : 'characters'}
              maxLength={mode === 'create' ? 80 : 12}
              underlineColorAndroid="transparent"
            />
            {mode === 'create' ? (
              <TextInput
                style={[styles.input, styles.inputSmall]}
                value={purpose}
                onChangeText={setPurpose}
                placeholder="What it’s for (optional)"
                placeholderTextColor={colors.inkFaint}
                maxLength={300}
                underlineColorAndroid="transparent"
              />
            ) : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <View style={styles.actions}>
              <Pressable style={styles.secondary} onPress={onClose} accessibilityRole="button">
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.primary, styles.flex, (!name.trim() || busy) && styles.disabled]}
                onPress={() => void submit()}
                disabled={!name.trim() || busy}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>{busy ? 'One moment' : mode === 'create' ? 'Create team' : 'Join'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Tasks your teams sent you. Nothing lands on your day unreviewed (AGENTS
 * §3.3): Accept turns a task into your own reminder, scheduled on this phone.
 */
function TaskInbox({
  visible,
  tasks,
  onClose,
  onAnswered,
}: {
  visible: boolean;
  tasks: TeamTask[];
  onClose: () => void;
  onAnswered: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const answer = async (task: TeamTask, accept: boolean) => {
    setBusy(task.id);
    try {
      const { reminder } = await respondTeamTask(task.id, accept);
      if (reminder) await scheduleReminder(reminder);
      onAnswered();
    } catch (caught) {
      logFailure('Answering a team task failed:', caught);
      Alert.alert('Not saved', userMessage(caught, 'That didn’t go through. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.eyebrow}>From your teams</Text>
          <Text style={styles.sheetTitle}>Tasks for you</Text>
          {tasks.length === 0 ? <Text style={styles.sheetHint}>All answered.</Text> : null}
          <ScrollView style={{ maxHeight: 420 }}>
            {tasks.map((task) => (
              <View key={task.id} style={styles.taskRow}>
                <Text style={styles.taskText}>{task.task}</Text>
                <Text style={styles.taskMeta}>
                  {formatDueDate(task.dueAt) ?? 'No time'} · from {task.senderName}
                  {task.teamName ? ` in ${task.teamName}` : ''}
                </Text>
                <View style={styles.actions}>
                  <Pressable style={styles.secondary} onPress={() => void answer(task, false)} disabled={busy === task.id}>
                    <Text style={styles.secondaryText}>Decline</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.primary, styles.flex, busy === task.id && styles.disabled]}
                    onPress={() => void answer(task, true)}
                    disabled={busy === task.id}
                  >
                    <Text style={styles.primaryText}>{busy === task.id ? 'One moment' : 'Accept'}</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { paddingBottom: spacing.space6, gap: spacing.space3 },
  dim: { ...text.body, color: colors.inkFaint, textAlign: 'center', marginTop: spacing.space6 },
  hint: { ...text.caption, color: colors.inkMuted, textAlign: 'center', paddingHorizontal: spacing.space4 },
  errorText: { ...text.body, color: colors.alarmText },
  locked: {
    marginTop: spacing.space4,
    padding: spacing.space5,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.markCore,
    backgroundColor: colors.surface,
    gap: spacing.space3,
  },
  lockedTitle: { ...text.displayL, color: colors.ink },
  lockedBody: { ...text.body, color: colors.inkMuted },
  inbox: {
    padding: spacing.space4,
    borderRadius: radius.md,
    backgroundColor: colors.accentWash,
    borderWidth: 1,
    borderColor: colors.accent,
    gap: 2,
  },
  inboxTitle: { ...text.bodyStrong, color: colors.ink },
  inboxHint: { ...text.caption, color: colors.inkMuted },
  teamBox: {
    flex: 1,
    minHeight: 150,
    padding: spacing.space4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  teamHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2, marginBottom: spacing.space2 },
  teamIcon: { width: 16, height: 16, tintColor: colors.markRing },
  teamLabel: { ...text.label, letterSpacing: 1.5, color: colors.markRing },
  teamName: { fontFamily: fontFamily.displaySemiBold, fontSize: 18, lineHeight: 24, color: colors.ink, flexGrow: 1 },
  teamMeta: { ...text.caption, fontSize: 12, color: colors.inkMuted, marginTop: spacing.space2 },
  teamRole: { ...text.label, color: colors.settled, marginTop: spacing.space1 },
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
  sheetTitle: { ...text.displayL, color: colors.ink },
  sheetHint: { ...text.body, color: colors.inkMuted },
  input: {
    ...text.memory,
    color: colors.ink,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.accent,
    paddingVertical: spacing.space2,
    marginTop: spacing.space3,
  },
  inputSmall: { ...text.body, borderBottomColor: colors.lineStrong },
  actions: { flexDirection: 'row', gap: spacing.space2, marginTop: spacing.space3 },
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
    minHeight: 48,
    paddingHorizontal: spacing.space5,
    borderRadius: radius.full,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { ...text.bodyStrong, color: colors.ink },
  disabled: { opacity: 0.5 },
  taskRow: { paddingVertical: spacing.space3, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 2 },
  taskText: { ...text.memory, color: colors.ink },
  taskMeta: { ...text.caption, color: colors.inkMuted },
});
