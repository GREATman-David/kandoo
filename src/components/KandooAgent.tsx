import { useConversation } from '@elevenlabs/react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, PermissionsAndroid, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KandooSymbol, type SymbolState } from '@/components/Symbol';
import { kandooTools } from '@/services/agent/agentTools';
import { fetchAgentToken, isProRequired, logFailure, userMessage } from '@/services/interpretationService';
import { stopSpeaking } from '@/services/speech';
import { supabase } from '@/services/supabase';
import { colors, fontFamily, radius, spacing, text } from '@/theme/theme';

/**
 * Talking with Kandoo (Pro). A spoken, back-and-forth conversation in which
 * Kandoo can do anything the user can in the app — through the app's own code
 * (services/agent/agentTools.ts), never by reaching the database itself.
 *
 * What the user sees, per the design system: the mark (never deformed; state is
 * its glow — live orange while the user talks, amber while Kandoo speaks),
 * Kandoo's words in Fraunces, and a quiet, settled line for everything Kandoo
 * DID, so its actions are never invisible. No spinners.
 */

type Line = { who: 'you' | 'kandoo'; text: string };
type Phase = 'connecting' | 'live' | 'ended' | 'error';

/** Tools that change something — shown to the user as "what Kandoo did". */
const DID: Record<string, (p: Record<string, unknown>) => string> = {
  add_memory: (p) => `Remembered: ${String(p.content ?? '')}`,
  edit_memory: () => 'Updated a memory',
  delete_memory: () => 'Deleted a memory',
  create_note: (p) => `Wrote a note${p.title ? `: ${String(p.title)}` : ''}`,
  edit_note: () => 'Updated a note',
  delete_note: () => 'Deleted a note',
  create_reminder: (p) => `Reminder set: ${String(p.task ?? '')}`,
  update_reminder: () => 'Changed a reminder',
  complete_reminder: () => 'Marked a reminder done',
  snooze_reminder: (p) => `Snoozed a reminder ${p.minutes ?? 15} min`,
  delete_reminder: () => 'Deleted a reminder',
  merge_people: () => 'Merged people',
  draw_place: (p) => `Saved a place: ${String(p.name ?? '')}`,
  star_place: (p) => (p.starred === false ? 'Unstarred a place' : 'Starred a place'),
  rename_place: (p) => `Renamed a place to ${String(p.name ?? '')}`,
  merge_places: () => 'Joined two places',
  stop_watching_place: () => 'Stopped watching a place',
  delete_place: () => 'Deleted a place',
};

async function micAllowed(): Promise<boolean> {
  const status = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: 'Talk with Kandoo',
    message: 'Kandoo needs the microphone to hear you.',
    buttonPositive: 'Allow',
  });
  return status === PermissionsAndroid.RESULTS.GRANTED;
}

function firstName(meta: Record<string, unknown> | undefined): string {
  const name = [meta?.name, meta?.full_name, meta?.first_name].find((v) => typeof v === 'string' && v.trim());
  return typeof name === 'string' ? name.trim().split(/\s+/)[0] : 'there';
}

export type KandooAgentProps = {
  visible: boolean;
  onClose: () => void;
  /** Not Pro (the server said so): open the paywall. */
  onNeedPro: () => void;
};

export function KandooAgent({ visible, onClose, onNeedPro }: KandooAgentProps) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('connecting');
  const [lines, setLines] = useState<Line[]>([]);
  const [did, setDid] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);

  // Every tool reports what it changed, then runs exactly as the app would.
  const clientTools = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(kandooTools).map(([name, tool]) => [
          name,
          async (params: Record<string, unknown>) => {
            const result = await tool(params);
            if (DID[name] && result.startsWith('{"ok":true')) {
              setDid((d) => [...d, DID[name](params)]);
            }
            return result;
          },
        ])
      ),
    []
  );

  const conversation = useConversation({
    clientTools,
    onConnect: () => setPhase('live'),
    onDisconnect: () => setPhase((p) => (p === 'error' ? p : 'ended')),
    onMessage: ({ message, source }) => {
      // A silent mic can come through as "..." — only lines with words count.
      if (!/[\p{L}\p{N}]/u.test(message ?? '')) return;
      setLines((l) => [...l, { who: source === 'user' ? 'you' : 'kandoo', text: message.trim() }]);
    },
    onError: (message) => {
      logFailure('Kandoo Agent error:', new Error(message));
      setError('Kandoo lost the connection. Tap to try again.');
      setPhase('error');
    },
  });

  const start = async () => {
    setError(null);
    setPhase('connecting');
    stopSpeaking();
    try {
      if (!(await micAllowed())) {
        setError('Kandoo needs the microphone to hear you. You can allow it in Settings.');
        setPhase('error');
        return;
      }
      const token = await fetchAgentToken();
      const { data } = await supabase.auth.getUser();
      conversation.startSession({
        conversationToken: token,
        connectionType: 'webrtc',
        dynamicVariables: {
          user_name: firstName(data.user?.user_metadata),
          client_time: localIsoNow(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
    } catch (caught) {
      if (isProRequired(caught)) {
        onClose();
        onNeedPro();
        return;
      }
      logFailure('Starting Kandoo Agent failed:', caught);
      setError(userMessage(caught, 'Kandoo couldn’t start just now. Tap to try again.'));
      setPhase('error');
    }
  };

  // Open → start fresh; close → always hang up (a voice still listening after
  // the screen is gone is the worst failure this feature could have).
  useEffect(() => {
    if (!visible) return;
    setLines([]);
    setDid([]);
    void start();
    return () => {
      conversation.endSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [lines.length, did.length]);

  const close = () => {
    conversation.endSession();
    onClose();
  };

  const markState: SymbolState =
    phase !== 'live' ? 'idle' : conversation.isSpeaking ? 'understanding' : 'listening';
  const status =
    phase === 'connecting'
      ? 'Connecting…'
      : phase === 'live'
        ? conversation.isSpeaking
          ? 'Kandoo is speaking'
          : 'Listening'
        : phase === 'ended'
          ? 'Conversation ended'
          : '';

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={close}>
      <View style={[styles.screen, { paddingTop: insets.top + spacing.space6, paddingBottom: insets.bottom + spacing.space5 }]}>
        <View style={styles.head}>
          <KandooSymbol state={markState} size={96} />
          <Text style={styles.status}>{status}</Text>
        </View>

        <ScrollView ref={scroll} style={styles.flex} contentContainerStyle={styles.lines} showsVerticalScrollIndicator={false}>
          {lines.map((line, i) =>
            line.who === 'kandoo' ? (
              <Text key={i} style={styles.kandoo}>{line.text}</Text>
            ) : (
              <Text key={i} style={styles.you}>{line.text}</Text>
            )
          )}
          {did.length > 0 ? (
            <View style={styles.did}>
              {did.map((d, i) => (
                <Text key={i} style={styles.didLine} numberOfLines={2}>
                  ✓ {d}
                </Text>
              ))}
            </View>
          ) : null}
          {error ? (
            <Pressable onPress={() => void start()} accessibilityRole="button">
              <Text style={styles.error}>{error}</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        <View style={styles.actions}>
          {phase === 'live' ? (
            <Pressable
              style={styles.secondary}
              onPress={() => conversation.setMuted(!conversation.isMuted)}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>{conversation.isMuted ? 'Unmute' : 'Mute'}</Text>
            </Pressable>
          ) : phase === 'ended' || phase === 'error' ? (
            <Pressable style={styles.secondary} onPress={() => void start()} accessibilityRole="button">
              <Text style={styles.secondaryText}>Talk again</Text>
            </Pressable>
          ) : null}
          <Pressable style={[styles.cta, styles.flex]} onPress={close} accessibilityRole="button">
            <Text style={styles.ctaText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Local time with its offset ("2026-09-30T14:05:00+00:00") — the agent resolves times against it. */
function localIsoNow(): string {
  const now = new Date();
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(now.getTime() + offset * 60_000).toISOString().slice(0, 19);
  return `${local}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space5 },
  flex: { flex: 1 },
  head: { alignItems: 'center', gap: spacing.space3, marginBottom: spacing.space5 },
  status: { ...text.label, letterSpacing: 1.5, color: colors.markRing },
  lines: { gap: spacing.space4, paddingBottom: spacing.space5 },
  // Kandoo's words and answers are Fraunces (AGENTS §7).
  kandoo: { ...text.answer, color: colors.ink },
  you: { ...text.body, color: colors.inkMuted, textAlign: 'right' },
  did: {
    gap: spacing.space1,
    borderLeftWidth: 2,
    borderLeftColor: colors.settledFill,
    paddingLeft: spacing.space3,
  },
  didLine: { ...text.caption, color: colors.settled },
  error: { ...text.body, color: colors.alarmText },
  actions: { flexDirection: 'row', gap: spacing.space2 },
  cta: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { ...text.bodyStrong, color: colors.ink },
  secondary: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.space5,
  },
  secondaryText: { ...text.bodyStrong, color: colors.ink },
});
