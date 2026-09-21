import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Paywall } from '@/components/Paywall';
import { ReviewSheet } from '@/components/ReviewSheet';
import { KandooSymbol } from '@/components/Symbol';
import { useHome, type RecentItem } from '@/features/Home/useHome';
import { useReminderSync } from '@/features/reminders/useReminderSync';
import {
  configurePurchases,
  identifyUser,
  resetPurchasesUser,
} from '@/services/purchases';
import type {
  InterpretResult,
  InterpretationResponse,
} from '@/services/interpretationService';
import { colors, duration, radius, spacing, text } from '@/theme/theme';
import { formatDueDate } from '@/utils/formatDueDate';

import AuthScreen from '../features/Auth/AuthScreen';
import { useAuth } from '../features/Auth/useAuth';
import { signOut } from '../services/authService';

export default function HomeScreen() {
  const { loading, isAuthenticated, user } = useAuth();

  // Configure RevenueCat once, then tie the customer to the Supabase account so
  // the backend can read the entitlement by the same id over the V2 REST API.
  useEffect(() => {
    configurePurchases();
  }, []);

  useEffect(() => {
    if (user?.id) void identifyUser(user.id);
  }, [user?.id]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <KandooSymbol state="idle" size={62} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return <KandooHome />;
}

const SYMBOL_SIZE = 62;
const CHIP_LIMIT = 6;
const CHIP_TEXT_LIMIT = 48;

/**
 * One route, four states. The symbol never unmounts; only what sits beneath
 * it changes. Everything that touches the network lives in useHome.
 */
function KandooHome() {
  const home = useHome();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Set up notification channels/permissions and rebuild the local schedule
  // from the server's active reminders. Replaces the retired server-push path.
  useReminderSync(true);

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>Kandoo</Text>
        <Text style={styles.brand}>●</Text>
      </View>

      <View style={styles.symbol}>
        <Pressable
          onPress={
            home.state === 'idle'
              ? home.startVoice
              : home.state === 'listening'
                ? home.stopListening
                : undefined
          }
          accessibilityRole={
            home.state === 'idle' || home.state === 'listening'
              ? 'button'
              : undefined
          }
          accessibilityLabel={
            home.state === 'idle'
              ? 'Tap to speak'
              : home.state === 'listening'
                ? 'Stop and send'
                : undefined
          }
          hitSlop={12}
        >
          <KandooSymbol state={home.state} size={SYMBOL_SIZE} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        {home.state === 'idle' ? (
          <>
            <Text style={styles.greeting}>{greeting()}</Text>
            <Text style={styles.ask}>What should I remember for you?</Text>
            {home.voiceSupported ? (
              <Text style={styles.voiceHint}>Tap the mic to speak, or just type.</Text>
            ) : null}
          </>
        ) : null}

        {home.state === 'listening' ? (
          <Text style={styles.greeting}>Listening…</Text>
        ) : null}

        {/*
          One input across idle and listening, like the symbol. The TextInput
          is the SAME element and stays in the SAME parent row in both states —
          swapping or reparenting it on the first keystroke would drop focus and
          blink the keyboard. Only the row's border and the mic button toggle.
        */}
        {home.state === 'idle' || home.state === 'listening' ? (
          <View
            style={[
              styles.inputRow,
              home.state === 'listening' && styles.inputRowBare,
            ]}
          >
            <TextInput
              style={home.state === 'listening' ? styles.transcript : styles.field}
              placeholder="Tell Kandoo anything…"
              placeholderTextColor={colors.inkFaint}
              value={home.transcript}
              onChangeText={home.updateTranscript}
              multiline
            />
            {/* Mic at the right edge of the field is the standard, primary way
                to start voice. The mark stays tappable as a shortcut. Toggling
                this sibling never remounts the TextInput beside it. */}
            {home.state === 'idle' && home.voiceSupported ? (
              <Pressable
                style={styles.micBtn}
                onPress={home.startVoice}
                accessibilityRole="button"
                accessibilityLabel="Speak"
                hitSlop={8}
              >
                <MicGlyph color={colors.inkMuted} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {home.state === 'idle' ? <Idle recent={home.recent} /> : null}

        {home.state === 'listening' ? (
          <Listening
            canStop={home.voiceActive || home.transcript.trim().length > 0}
            voiceActive={home.voiceActive}
            error={home.error}
            busy={home.busy}
            onStop={home.stopListening}
            onCancel={home.cancelListening}
          />
        ) : null}

        {home.state === 'understanding' ? (
          <Understanding
            transcript={home.submittedText}
            response={home.response}
            error={home.error}
            busy={home.busy}
            onRemember={home.remember}
            onEdit={() => setSheetOpen(true)}
          />
        ) : null}

        {home.state === 'remembered' && home.response ? (
          <Remembered
            response={home.response}
            onDone={home.done}
            onEdit={() => setSheetOpen(true)}
          />
        ) : null}
      </ScrollView>

      {home.response ? (
        <ReviewSheet
          visible={sheetOpen}
          summary={home.response.summary}
          confidence={home.response.confidence}
          results={home.response.results}
          rawText={home.submittedText}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}

      <Paywall
        visible={home.paywallVisible}
        onClose={home.closePaywall}
        onPurchased={home.onProUnlocked}
      />
    </View>
  );
}

// ---------------------------------------------------------------- Idle

type IdleProps = {
  recent: RecentItem[];
};

function Idle({ recent }: IdleProps) {
  return (
    <>
      {recent.length > 0 ? (
        <View style={styles.recent}>
          <Text style={styles.eyebrow}>Recently</Text>
          {recent.map((item) => (
            <View key={item.id} style={styles.recentRow}>
              <Text style={styles.recentSummary} numberOfLines={1}>
                {item.summary}
              </Text>
              <Text style={styles.recentMeta}>{describeCounts(item)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Pressable
        style={styles.signOut}
        onPress={() => {
          // Detach the RevenueCat customer first so the next account that signs
          // in on this device doesn't inherit this one's entitlement.
          void resetPurchasesUser();
          signOut().catch((error: unknown) => {
            console.error('Sign out failed:', error);
          });
        }}
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning.';
  if (hour < 17) return 'Good afternoon.';
  return 'Good evening.';
}

function describeCounts(item: RecentItem): string {
  const parts: string[] = [];
  if (item.reminders > 0) {
    parts.push(`${item.reminders} reminder${item.reminders === 1 ? '' : 's'}`);
  }
  if (item.memories > 0) {
    parts.push(`${item.memories} memor${item.memories === 1 ? 'y' : 'ies'}`);
  }
  return parts.join(' · ') || 'Saved what you said';
}

/**
 * A microphone drawn from plain Views — no icon font or SVG (we removed
 * react-native-svg for the Fabric gap). A filled capsule head over a short
 * stem and base reads as a mic; `color` lets it follow colour-as-state.
 */
function MicGlyph({ color }: { color: string }) {
  return (
    <View style={styles.mic} pointerEvents="none">
      <View style={[styles.micHead, { backgroundColor: color }]} />
      <View style={[styles.micStem, { backgroundColor: color }]} />
      <View style={[styles.micBase, { backgroundColor: color }]} />
    </View>
  );
}

// ----------------------------------------------------------- Listening

type ListeningProps = {
  canStop: boolean;
  voiceActive: boolean;
  error: string | null;
  busy: boolean;
  onStop: () => void;
  onCancel: () => void;
};

function Listening({
  canStop,
  voiceActive,
  error,
  busy,
  onStop,
  onCancel,
}: ListeningProps) {
  return (
    <>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        <Pressable style={styles.btn} onPress={onCancel} disabled={busy}>
          <Text style={styles.btnText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.btnPrimary, (busy || !canStop) && styles.btnDisabled]}
          onPress={onStop}
          disabled={busy || !canStop}
        >
          {/* Live mic: stop it, then submit. Typed or already stopped: send now. */}
          <Text style={styles.btnPrimaryText}>{voiceActive ? 'Stop' : 'Send'}</Text>
        </Pressable>
      </View>
    </>
  );
}

// ------------------------------------------------------- Understanding

type UnderstandingProps = {
  transcript: string;
  response: InterpretationResponse | null;
  error: string | null;
  busy: boolean;
  onRemember: () => void;
  onEdit: () => void;
};

function Understanding({
  transcript,
  response,
  error,
  busy,
  onRemember,
  onEdit,
}: UnderstandingProps) {
  // While the backend is working, the breathing accent symbol is the whole
  // signal. The words stay on screen, dimmed. No spinner, ever.
  if (!response) {
    return (
      <>
        <Text style={styles.eyebrow}>Working it out</Text>
        <Text style={styles.held}>{transcript}</Text>
      </>
    );
  }

  const chips = buildChips(response);
  const nothingActionable = chips.length === 0;

  return (
    <>
      <Text style={styles.eyebrow}>
        {nothingActionable ? 'Saved what you said' : 'I understood'}
      </Text>
      <Text style={styles.task}>
        {nothingActionable ? transcript : response.summary ?? transcript}
      </Text>

      {chips.length > 0 ? (
        <View style={styles.chips}>
          {chips.map((chip, index) => (
            <StaggerChip key={`${chip.label}-${index}`} chip={chip} index={index} />
          ))}
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        {!nothingActionable ? (
          <Pressable style={styles.btn} onPress={onEdit} disabled={busy}>
            <Text style={styles.btnText}>Edit</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.btnPrimary, busy && styles.btnDisabled]}
          onPress={onRemember}
          disabled={busy}
        >
          <Text style={styles.btnPrimaryText}>
            {nothingActionable ? 'Done' : 'Remember'}
          </Text>
        </Pressable>
      </View>
    </>
  );
}

type Chip = { label: string; guessed?: boolean };

/**
 * One chip per thing Kandoo understood, plus the people it heard. Capped so
 * a long recap reads as a summary, not a wall. Low confidence becomes the one
 * word "guessed" on the time chip — never a number.
 */
function buildChips(response: InterpretationResponse): Chip[] {
  const chips: Chip[] = [];
  const people = new Set<string>();
  const guessedTimes = response.confidence === 'low';

  for (const result of response.results) {
    if (result.status !== 'ok') continue;

    if (result.kind === 'reminder') {
      const r = result.reminder;
      const when = formatDueDate(r.due_at) ?? r.place_hint ?? 'Reminder';
      chips.push({
        label: `${clip(r.task)} · ${when}${guessedTimes && r.due_at ? ' — guessed' : ''}`,
        guessed: guessedTimes && !!r.due_at,
      });
      if (r.person) people.add(r.person);
    } else if (result.kind === 'memory') {
      chips.push({ label: `${clip(result.memory.content)} · Memory` });
      if (result.memory.person) people.add(result.memory.person);
    }
  }

  for (const person of people) {
    chips.push({ label: `${person} · Person` });
  }

  if (chips.length <= CHIP_LIMIT) return chips;
  return [...chips.slice(0, CHIP_LIMIT - 1), { label: `+${chips.length - CHIP_LIMIT + 1}` }];
}

function clip(value: string): string {
  return value.length > CHIP_TEXT_LIMIT
    ? `${value.slice(0, CHIP_TEXT_LIMIT - 1).trimEnd()}…`
    : value;
}

/** Chips arrive one after another at duration-stagger. This is the "spinner". */
function StaggerChip({ chip, index }: { chip: Chip; index: number }) {
  const shown = useSharedValue(0);

  useEffect(() => {
    shown.value = withDelay(
      120 + index * duration.stagger,
      withTiming(1, { duration: 220 })
    );
  }, [index, shown]);

  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: 4 * (1 - shown.value) }],
  }));

  return (
    <Animated.View style={[styles.chip, chip.guessed && styles.chipGuessed, style]}>
      <Text
        style={[styles.chipText, chip.guessed && styles.chipTextGuessed]}
        numberOfLines={1}
      >
        {chip.label}
      </Text>
    </Animated.View>
  );
}

// ---------------------------------------------------------- Remembered

type RememberedProps = {
  response: InterpretationResponse;
  onDone: () => void;
  onEdit: () => void;
};

function Remembered({ response, onDone, onEdit }: RememberedProps) {
  const ticks = useMemo(() => buildTicks(response.results), [response.results]);

  return (
    <>
      <Text style={styles.eyebrow}>I’ve got it</Text>
      <Text style={styles.task}>{response.summary ?? 'Saved what you said'}</Text>

      <View style={styles.ticks}>
        {ticks.map((tick, index) => (
          <Text key={index} style={styles.tick}>
            ✓ {tick}
          </Text>
        ))}
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.btn} onPress={onEdit}>
          <Text style={styles.btnText}>Edit</Text>
        </Pressable>
        <Pressable style={styles.btnPrimary} onPress={onDone}>
          <Text style={styles.btnPrimaryText}>Done</Text>
        </Pressable>
      </View>
    </>
  );
}

function buildTicks(results: InterpretResult[]): string[] {
  const ticks: string[] = [];
  for (const result of results) {
    if (result.status !== 'ok') continue;
    if (result.kind === 'reminder') {
      const when = formatDueDate(result.reminder.due_at) ?? result.reminder.place_hint;
      ticks.push(`Reminder created${when ? ` · ${when}` : ''}`);
    } else if (result.kind === 'memory') {
      const who = result.memory.person ?? result.memory.topics[0];
      ticks.push(`Memory saved${who ? ` · ${who}` : ''}`);
    } else {
      ticks.push('Answered');
    }
  }
  return ticks.length > 0 ? ticks : ['Saved what you said'];
}

// -------------------------------------------------------------- Styles

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.base,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.base,
    paddingTop: spacing.space5,
    paddingHorizontal: spacing.space4,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.space6,
  },
  brand: {
    ...text.label,
    color: colors.inkMuted,
  },
  symbol: {
    alignItems: 'center',
    marginBottom: spacing.space5,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    alignItems: 'center',
    paddingBottom: spacing.space7,
  },

  greeting: {
    ...text.caption,
    color: colors.inkMuted,
    marginBottom: spacing.space2,
  },
  ask: {
    ...text.displayL,
    color: colors.ink,
    textAlign: 'center',
    maxWidth: 300,
    marginBottom: spacing.space3,
  },
  voiceHint: {
    ...text.caption,
    color: colors.inkFaint,
    textAlign: 'center',
    marginBottom: spacing.space5,
  },
  inputRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingRight: spacing.space2,
  },
  // Listening: drop the box so the centered transcript reads plainly, matching
  // the pre-mic-button look. The mic hides here, so no right padding is needed.
  inputRowBare: {
    borderWidth: 0,
    backgroundColor: 'transparent',
    paddingRight: 0,
  },
  field: {
    ...text.body,
    flex: 1,
    color: colors.ink,
    paddingHorizontal: spacing.space4,
    paddingVertical: spacing.space3,
  },
  transcript: {
    ...text.bodyL,
    flex: 1,
    color: colors.ink,
    textAlign: 'center',
    paddingVertical: spacing.space3,
  },
  micBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mic: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micHead: {
    width: 11,
    height: 15,
    borderRadius: 5.5,
  },
  micStem: {
    width: 2,
    height: 3,
    marginTop: 1,
  },
  micBase: {
    width: 12,
    height: 2,
    borderRadius: 1,
    marginTop: 1,
  },
  held: {
    ...text.bodyL,
    color: colors.inkMuted,
    textAlign: 'center',
    marginTop: spacing.space2,
  },

  recent: {
    alignSelf: 'stretch',
    marginTop: spacing.space6,
  },
  recentRow: {
    paddingVertical: spacing.space3,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  recentSummary: {
    ...text.body,
    color: colors.ink,
  },
  recentMeta: {
    ...text.caption,
    color: colors.inkMuted,
    marginTop: 2,
  },

  eyebrow: {
    ...text.label,
    color: colors.inkMuted,
    alignSelf: 'flex-start',
    marginBottom: spacing.space2,
  },
  task: {
    ...text.answer,
    color: colors.ink,
    alignSelf: 'stretch',
    marginBottom: spacing.space3,
  },
  chips: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.space2,
  },
  chip: {
    maxWidth: '100%',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipGuessed: {
    borderColor: colors.alarmText,
  },
  chipText: {
    ...text.caption,
    color: colors.inkMuted,
  },
  chipTextGuessed: {
    color: colors.alarmText,
  },

  ticks: {
    alignSelf: 'stretch',
    gap: spacing.space2,
    marginTop: spacing.space3,
  },
  tick: {
    ...text.caption,
    color: colors.settled,
  },

  error: {
    ...text.caption,
    color: colors.alarmText,
    textAlign: 'center',
    marginTop: spacing.space3,
  },

  actions: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: spacing.space2,
    marginTop: spacing.space5,
  },
  btn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    ...text.bodyStrong,
    color: colors.inkMuted,
  },
  btnPrimary: {
    flex: 2,
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    ...text.bodyStrong,
    color: colors.base,
  },
  btnDisabled: {
    opacity: 0.6,
  },

  signOut: {
    marginTop: spacing.space6,
    minHeight: 44,
    justifyContent: 'center',
  },
  signOutText: {
    ...text.caption,
    color: colors.inkFaint,
  },
});
