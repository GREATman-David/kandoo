import { useConversation } from '@elevenlabs/react-native';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, PermissionsAndroid, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgentDraftCard } from '@/components/AgentDraftCard';
import { AgentPlacePreview } from '@/components/AgentPlacePreview';
import { PlaceDrawer } from '@/components/PlaceDrawer';
import { KandooSymbol, type SymbolState } from '@/components/Symbol';
import {
  discardDraft,
  editDraftField,
  markUserSpoke,
  resetDrafts,
  saveDraft,
  setDraftShape,
  subscribeDrafts,
  type Draft,
  type DraftField,
} from '@/services/agent/agentDrafts';
import { kandooTools } from '@/services/agent/agentTools';
import { fetchAgentToken, isProRequired, logFailure, userMessage } from '@/services/interpretationService';
import { stopSpeaking } from '@/services/speech';
import { supabase } from '@/services/supabase';
import { colors, radius, spacing, text } from '@/theme/theme';
import { formatDueDate } from '@/utils/formatDueDate';
import type { PlaceGeometry } from '@/utils/geo';

/**
 * Talking with Kandoo (Pro). A spoken, back-and-forth conversation in which
 * Kandoo can do anything the user can in the app — through the app's own code
 * (services/agent/agentTools.ts), never by reaching the database itself.
 *
 * Nothing is saved on Kandoo's word alone: each change appears as a card in
 * the conversation (AgentDraftCard) that the user can edit, and saves on their
 * yes or their tap. When Kandoo says goodbye, the screen returns to Home.
 *
 * Per the design system: the mark never deforms (state is its colour — live
 * while the user talks, amber while Kandoo speaks or waits on a card, olive as
 * something saves), Kandoo's words are Fraunces, and there are no spinners.
 */

type Line = { kind: 'line'; who: 'you' | 'kandoo'; text: string; at: number };
type Phase = 'connecting' | 'live' | 'ended' | 'error';

/** After Kandoo says goodbye, how long the finished conversation stays up. */
const CLOSE_AFTER_MS = 2200;

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

/** How an edited value reads back to Kandoo. */
function spoken(field: DraftField, value: string): string {
  return field.kind === 'time' ? `${formatDueDate(value) ?? value} (${value})` : `"${value}"`;
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
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  /** A new-place card whose shape the user is adjusting on the full map. */
  const [adjusting, setAdjusting] = useState<Draft | null>(null);
  const scroll = useRef<ScrollView>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftsRef = useRef<Draft[]>([]);
  const connectedAt = useRef(0);
  const heardAnything = useRef(false);

  useEffect(
    () =>
      subscribeDrafts((next) => {
        draftsRef.current = next;
        setDrafts(next);
      }),
    []
  );

  const conversation = useConversation({
    clientTools: kandooTools,
    onConnect: () => {
      connectedAt.current = Date.now();
      heardAnything.current = false;
      setPhase('live');
    },
    onDisconnect: (details) => {
      if (details.reason === 'error') {
        logFailure('Kandoo Agent disconnected:', new Error(details.message));
        setError('Kandoo lost the connection. Tap to try again.');
        setPhase('error');
        return;
      }
      // Closed within seconds with nothing said: Kandoo couldn't start (for
      // example, the voice service is out of quota). Say so — never a silent close.
      if (!heardAnything.current && Date.now() - connectedAt.current < 5000) {
        logFailure('Kandoo Agent closed right after connecting:', new Error(details.reason));
        setError('Kandoo can’t talk right now. Please try again later.');
        setPhase('error');
        return;
      }
      setPhase('ended');
      // Kandoo said goodbye: back to Home — unless a card still waits on the user.
      if (details.reason === 'agent') {
        closeTimer.current = setTimeout(() => {
          closeTimer.current = null;
          if (!draftsRef.current.some((d) => d.status === 'draft')) finish('/');
        }, CLOSE_AFTER_MS);
      }
    },
    onMessage: ({ message, source }) => {
      // A silent mic can come through as "..." — only lines with words count.
      if (!/[\p{L}\p{N}]/u.test(message ?? '')) return;
      heardAnything.current = true;
      if (source === 'user') markUserSpoke();
      setLines((l) => [...l, { kind: 'line', who: source === 'user' ? 'you' : 'kandoo', text: message.trim(), at: Date.now() }]);
    },
    onError: (message) => {
      logFailure('Kandoo Agent error:', new Error(message));
      setError('Kandoo lost the connection. Tap to try again.');
      setPhase('error');
    },
  });

  /** Tell Kandoo what the user did on a card, so the conversation stays in step. */
  const tell = (update: string) => {
    if (phase !== 'live') return;
    try {
      conversation.sendContextualUpdate(update);
    } catch (error) {
      // The call dropped between the tap and this line; the card itself is already right.
      console.warn('Telling Kandoo about a card failed:', error);
    }
  };

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
    resetDrafts();
    void start();
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = null;
      conversation.endSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [lines.length, drafts.length]);

  /** Close the conversation, optionally landing on a screen. */
  function finish(to?: string, params?: Record<string, string>) {
    conversation.endSession();
    onClose();
    if (to) router.navigate({ pathname: to as never, params });
  }

  const saveByTap = async (draft: Draft) => {
    const outcome = await saveDraft(draft.id, 'user');
    if (outcome.ok) {
      tell(`The user tapped Save on card ${draft.id} (${draft.title}). It is saved — don't save it again.`);
      // The conversation already ended and nothing else waits: head Home.
      if (phase === 'ended' && !draftsRef.current.some((d) => d.status === 'draft')) {
        setTimeout(() => finish('/'), 900);
      }
    }
  };

  const discardByTap = (draft: Draft) => {
    if (discardDraft(draft.id)) tell(`The user dismissed card ${draft.id} (${draft.title}). It was not saved.`);
  };

  const editByTap = (draft: Draft, field: DraftField, value: string) => {
    editDraftField(draft.id, field.key, value);
    tell(`The user edited card ${draft.id}: ${field.label} is now ${spoken(field, value)}. Use this value; the card is still not saved.`);
  };

  const startAdjust = (draft: Draft) => {
    setAdjusting(draft);
    // The call stays up while the user draws; the mic rests so Kandoo waits.
    if (phase === 'live') {
      try {
        conversation.setMuted(true);
      } catch (error) {
        console.warn('Pausing the mic failed:', error);
      }
      tell(`The user is adjusting the shape of card ${draft.id} on the map. Wait quietly until they're back.`);
    }
  };

  const endAdjust = (shape?: PlaceGeometry, name?: string) => {
    const draft = adjusting;
    setAdjusting(null);
    if (phase === 'live') {
      try {
        conversation.setMuted(false);
      } catch (error) {
        console.warn('Resuming the mic failed:', error);
      }
    }
    if (!draft) return;
    if (!shape) {
      tell(`The user closed the map without changing card ${draft.id}.`);
      return;
    }
    setDraftShape(draft.id, { center: shape.center, radiusM: shape.radiusM, area: shape.area ?? null });
    const current = draft.fields.find((f) => f.key === 'name')?.value;
    if (name && name !== current) editDraftField(draft.id, 'name', name);
    tell(
      `The user redrew the shape on card ${draft.id}${name && name !== current ? ` and named it "${name}"` : ''}. ` +
        'Ask if it looks right now; the card is still not saved.'
    );
  };

  // Every save — by a tap or on the user's spoken yes — flashes the mark olive.
  const savedCount = drafts.filter((d) => d.status === 'saved').length;
  const lastSaved = useRef(0);
  useEffect(() => {
    const grew = savedCount > lastSaved.current;
    lastSaved.current = savedCount;
    if (!grew) return;
    setJustSaved(true);
    const t = setTimeout(() => setJustSaved(false), 1500);
    return () => clearTimeout(t);
  }, [savedCount]);

  const waitingOnCard = drafts.some((d) => d.status === 'draft');
  const markState: SymbolState = justSaved
    ? 'remembered'
    : phase !== 'live'
      ? 'idle'
      : conversation.isSpeaking || waitingOnCard
        ? 'understanding'
        : 'listening';
  const status = justSaved
    ? 'Saved'
    : phase === 'connecting'
      ? 'Connecting…'
      : phase === 'live'
        ? conversation.isSpeaking
          ? 'Kandoo is speaking'
          : waitingOnCard
            ? 'Check the card'
            : 'Listening'
        : phase === 'ended'
          ? 'Conversation ended'
          : '';

  // One timeline: what was said and what Kandoo proposed, in order.
  const timeline = [...lines, ...drafts.map((d) => ({ kind: 'draft' as const, draft: d, at: d.createdAt }))].sort(
    (a, b) => a.at - b.at
  );

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={() => finish()}>
      <View style={[styles.screen, { paddingTop: insets.top + spacing.space6, paddingBottom: insets.bottom + spacing.space5 }]}>
        <View style={styles.head}>
          <KandooSymbol state={markState} size={96} />
          <Text style={styles.status}>{status}</Text>
        </View>

        <ScrollView
          ref={scroll}
          style={styles.flex}
          contentContainerStyle={styles.lines}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {timeline.map((item) =>
            item.kind === 'draft' ? (
              <AgentDraftCard
                key={item.draft.id}
                draft={item.draft}
                mapPreview={
                  item.draft.shape ? (
                    <AgentPlacePreview
                      // A redrawn shape remounts the map so it fits the new outline.
                      key={`${item.draft.shape.center.lat},${item.draft.shape.center.lng},${item.draft.shape.radiusM},${item.draft.shape.area?.length ?? 0}`}
                      shape={item.draft.shape}
                      saved={item.draft.status === 'saved'}
                      onAdjust={
                        item.draft.tool === 'draw_place' && item.draft.status === 'draft'
                          ? () => startAdjust(item.draft)
                          : undefined
                      }
                    />
                  ) : null
                }
                onEdit={(field, value) => editByTap(item.draft, field, value)}
                onSave={() => void saveByTap(item.draft)}
                onDiscard={() => discardByTap(item.draft)}
                onOpen={() => item.draft.open && finish(item.draft.open.pathname, item.draft.open.params)}
              />
            ) : item.who === 'kandoo' ? (
              <Text key={`l${item.at}`} style={styles.kandoo}>
                {item.text}
              </Text>
            ) : (
              <Text key={`l${item.at}`} style={styles.you}>
                {item.text}
              </Text>
            )
          )}
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
          <Pressable style={[styles.cta, styles.flex]} onPress={() => finish()} accessibilityRole="button">
            <Text style={styles.ctaText}>Done</Text>
          </Pressable>
        </View>
      </View>

      <PlaceDrawer
        visible={adjusting !== null}
        place={
          adjusting?.shape
            ? {
                id: `agent-${adjusting.id}`,
                name: adjusting.fields.find((f) => f.key === 'name')?.value ?? 'Place',
                center: adjusting.shape.center,
                radiusM: adjusting.shape.radiusM,
                area: adjusting.shape.area ?? null,
              }
            : null
        }
        onShape={(shape, name) => endAdjust(shape, name)}
        onClose={() => endAdjust()}
        onSaved={() => endAdjust()}
        onNeedPro={() => endAdjust()}
      />
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
