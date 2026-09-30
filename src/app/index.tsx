import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Image,
  type ImageSourcePropType,
  Modal,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountSheet } from '@/components/AccountSheet';
import { EmptyState } from '@/components/EmptyState';
import { PlaceHomeCards } from '@/components/PlaceHomeCards';
import { OfflineNote } from '@/components/OfflineNote';
import { NoteDetail } from '@/components/NoteDetail';
import { Onboarding } from '@/components/Onboarding';
import { KandooAgent } from '@/components/KandooAgent';
import { NameSheet } from '@/components/NameSheet';
import { Paywall } from '@/components/Paywall';
import { ReviewSheet } from '@/components/ReviewSheet';
import { KandooSymbol } from '@/components/Symbol';
import {
  useHome,
  type HomeState,
  type RecentItem,
} from '@/features/Home/useHome';
import { usePlaceSync } from '@/features/places/usePlaceSync';
import { useReminderSync } from '@/features/reminders/useReminderSync';
import { useEntitlement } from '@/hooks/useEntitlement';
import { useKeyboardLift } from '@/hooks/useKeyboardLift';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useSpeechEnabled } from '@/hooks/useSpeechEnabled';
import { chosenName } from '@/services/profile';
import { speakAnswer, stopSpeaking } from '@/services/speech';
import { configurePurchases, identifyUser } from '@/services/purchases';
import {
  takeNote,
  type InterpretResult,
  type InterpretationResponse,
  logFailure,
} from '@/services/interpretationService';
import {
  colors,
  duration,
  fontFamily,
  radius,
  spacing,
  text,
  withOpacity,
} from '@/theme/theme';
import { formatDueDate, formatPlaceWhen } from '@/utils/formatDueDate';
import { timeAgo } from '@/utils/timeAgo';

import AuthScreen from '../features/Auth/AuthScreen';
import { useAuth } from '../features/Auth/useAuth';

/** Free recall reaches back ten days; older Recently rows open the paywall. */
const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
const isLocked = (createdAt: string) =>
  Date.now() - Date.parse(createdAt) > TEN_DAYS_MS;

/** The mark has no 'answered' state; recall reuses the understanding mark. */
function symbolFor(state: HomeState) {
  return state === 'answered' ? 'understanding' : state;
}

export default function HomeScreen() {
  const { loading, isAuthenticated, user } = useAuth();
  const {
    seen: onboardingSeen,
    loading: onboardingLoading,
    markSeen,
  } = useOnboarding();

  // Configure RevenueCat once, then tie the customer to the Supabase account so
  // the backend can read the entitlement by the same id over the V2 REST API.
  useEffect(() => {
    configurePurchases();
  }, []);

  useEffect(() => {
    if (user?.id) void identifyUser(user.id);
  }, [user?.id]);

  if (loading || onboardingLoading) {
    return (
      <View style={styles.loading}>
        <KandooSymbol state="idle" size={62} />
      </View>
    );
  }

  // Onboarding shows once, before the first sign-up — never for a signed-in user.
  if (!isAuthenticated && onboardingSeen === false) {
    return <Onboarding onDone={markSeen} />;
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return <KandooHome />;
}

const SYMBOL_SIZE = 120;
/** While the keyboard is up the mark steps back so the typed words stay in view. */
const TYPING_SYMBOL_SIZE = 56;
/** Full-screen moments show the Figma 72px mark inside a soft halo. */
const HALO_SYMBOL_SIZE = 72;
/** Figma halos: a pale-amber disc of `radius`, blurred by `blur` (listening / understood). */
const LISTENING_HALO = { radius: 100, blur: 20 };
const UNDERSTOOD_HALO = { radius: 65, blur: 15 };

/**
 * Reproduces Figma's blurred glow disc (accentWash at 55%, Gaussian blur) as a
 * radial gradient, since RN has no blur filter. Stops follow the blurred edge:
 * solid to r - 2σ, half strength at r, gone by r + 2σ. `box` is the layout size.
 */
function haloStyles({ radius: r, blur }: { radius: number; blur: number }) {
  const outer = r + 2 * blur;
  const at = (distance: number) => `${Math.round((distance / outer) * 100)}%`;
  const wash = (alpha: number) => withOpacity(colors.accentWash, alpha);
  return {
    box: { width: r * 2, height: r * 2 },
    glow: {
      width: outer * 2,
      height: outer * 2,
      experimental_backgroundImage: `radial-gradient(circle closest-side, ${wash(0.55)} 0%, ${wash(0.54)} ${at(r - 2 * blur)}, ${wash(0.46)} ${at(r - blur)}, ${wash(0.28)} ${at(r)}, ${wash(0.09)} ${at(r + blur)}, ${wash(0)} 100%)`,
    },
  };
}

const CHIP_ICONS: Record<ChipKind, ImageSourcePropType> = {
  person: require('@/assets/images/icons/chip-person.png'),
  topic: require('@/assets/images/icons/chip-topic.png'),
  time: require('@/assets/images/icons/chip-time.png'),
};
const MIC_ICON = require('@/assets/images/icons/mic.png');
const CHECK_ICON = require('@/assets/images/icons/check.png');
const CHIP_LIMIT = 6;
const CHIP_TEXT_LIMIT = 48;

/**
 * One route, four states. The symbol never unmounts; only what sits beneath
 * it changes. Everything that touches the network lives in useHome.
 */
function KandooHome() {
  const home = useHome();
  const entitlement = useEntitlement();
  const insets = useSafeAreaInsets();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  // Just unlocked Pro: ask what Kandoo should call them (once, skippable).
  const [askName, setAskName] = useState(false);
  const { user: account } = useAuth();
  const [noteId, setNoteId] = useState<string | null>(null);
  // Typing: lift the docked field above the keyboard, and shrink the mark so
  // what is being typed stays in view. Voice is full-screen and unaffected.
  const keyboard = useKeyboardLift();
  // The same for the full-screen layer, where the spoken words are edited.
  const modalKeyboard = useKeyboardLift();

  // Set up notification channels/permissions and rebuild the local schedule
  // from the server's active reminders. Replaces the retired server-push path.
  useReminderSync(true);
  // Pro: hand the OS the places to watch, so arriving fires place reminders
  // and Kandoo Moments with the app closed. A no-op for free users.
  usePlaceSync(true);

  // A Recently row opens its note — unless a FREE user taps a capture older
  // than the free window, which opens the paywall (the row still looks normal).
  // Pro reaches back forever, so Pro never sees the paywall here.
  const openRecent = (item: RecentItem) => {
    if (!entitlement.isPro && isLocked(item.createdAt)) home.openPaywall();
    else setNoteId(item.id);
  };

  // Voice listening and a spoken answer are full-screen moments (Figma's
  // Listening frame): no top bar, no input, no tabs — the mark in its halo, the
  // words, and two buttons. They sit in a full-screen layer over the tab bar
  // (hiding the native bar leaves its strip untappable). Typing stays inline.
  const voiceListening = home.state === 'listening' && home.voiceActive;
  const immersive =
    voiceListening ||
    home.state === 'answered' ||
    home.state === 'understanding' ||
    home.state === 'remembered';
  // Understood and Complete use Figma's smaller halo; listening the larger.
  const compactHalo =
    home.state === 'understanding' || home.state === 'remembered';
  const halo = haloStyles(compactHalo ? UNDERSTOOD_HALO : LISTENING_HALO);

  return (
    <View
      ref={keyboard.ref}
      style={[
        styles.screen,
        {
          paddingTop: insets.top + spacing.space5,
          paddingBottom: keyboard.lift,
        },
      ]}
    >
      <Modal
        visible={immersive}
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={
          voiceListening
            ? home.cancelListening
            : home.state === 'answered' || home.state === 'remembered'
              ? home.done
              : // Understood waits on Edit or Remember; back never drops a
                // pending capture on the floor.
                () => {}
        }
      >
        <View
          ref={modalKeyboard.ref}
          style={[
            styles.screen,
            {
              paddingTop:
                insets.top +
                (home.state === 'understanding'
                  ? spacing.space5
                  : home.state === 'remembered'
                    ? spacing.space7 + spacing.space2
                    : spacing.space6 + spacing.space2),
              // Above the keyboard while the spoken words are being edited.
              paddingBottom: Math.max(insets.bottom, modalKeyboard.lift),
            },
          ]}
        >
          {/* The large halo steps aside while the keyboard is up, so the words
              being edited get the room. */}
          {voiceListening && modalKeyboard.keyboardOpen ? null : (
            <View style={[styles.halo, halo.box]}>
              <View style={[styles.haloGlow, halo.glow]} pointerEvents="none" />
              <Pressable
                onPress={voiceListening ? home.stopListening : undefined}
                accessibilityRole={voiceListening ? 'button' : undefined}
                accessibilityLabel={
                  voiceListening ? 'Stop and send' : undefined
                }
                hitSlop={12}
              >
                <KandooSymbol
                  state={symbolFor(home.state)}
                  size={HALO_SYMBOL_SIZE}
                />
              </Pressable>
            </View>
          )}

          {voiceListening ? (
            <VoiceListening
              transcript={home.transcript}
              paused={home.voicePaused}
              canSend={home.voiceActive || home.transcript.trim().length > 0}
              error={home.error}
              notice={home.notice}
              busy={home.busy}
              onSend={home.stopListening}
              onCancel={home.cancelListening}
              onEdit={home.editVoiceTranscript}
              onPause={home.pauseVoice}
              onResume={home.resumeVoice}
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
              onOpenNote={setNoteId}
            />
          ) : null}

          {home.state === 'answered' && home.response ? (
            <Answered
              response={home.response}
              onDone={home.done}
              voiceSupported={home.voiceSupported}
              onAskAgain={home.startVoice}
            />
          ) : null}
        </View>
      </Modal>

      <View style={styles.topBar}>
        <Text style={styles.wordmark}>Kandoo</Text>
        <View style={styles.topActions}>
        {/* Kandoo Agent (Pro): a spoken conversation that can act across the app. */}
        <Pressable
          style={styles.talk}
          onPress={() => {
            stopSpeaking();
            if (entitlement.isPro) setAgentOpen(true);
            else home.openPaywall();
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Talk to Kandoo"
        >
          <Text style={styles.talkText}>Talk to Kandoo</Text>
        </Pressable>
        <Pressable
          style={styles.badge}
          onPress={() => setAccountOpen(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Account"
        >
          <Text style={styles.badgeText}>
            {entitlement.isPro ? 'Kandoo Pro' : 'Free'}
          </Text>
        </Pressable>
        </View>
      </View>

      <View
        style={[styles.symbol, keyboard.keyboardOpen && styles.symbolTyping]}
      >
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
          <KandooSymbol
            state={symbolFor(home.state)}
            size={keyboard.keyboardOpen ? TYPING_SYMBOL_SIZE : SYMBOL_SIZE}
          />
        </Pressable>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        <OfflineNote />

        {home.state === 'idle' ? (
          <View style={styles.header}>
            <Text style={styles.greeting}>{greeting()}</Text>
            <Text style={styles.ask}>What should I remember for you?</Text>
          </View>
        ) : null}

        {home.state === 'listening' ? (
          <Text style={styles.listeningLabel}>Listening…</Text>
        ) : null}

        {home.state === 'idle' ? <PlaceHomeCards /> : null}

        {home.state === 'idle' ? (
          <Idle
            recent={home.recent}
            loaded={home.recentLoaded}
            onSelect={openRecent}
          />
        ) : null}

        {home.state === 'listening' ? (
          <Listening
            canStop={home.voiceActive || home.transcript.trim().length > 0}
            voiceActive={home.voiceActive}
            error={home.error}
            notice={home.notice}
            busy={home.busy}
            onStop={home.stopListening}
            onCancel={home.cancelListening}
            onSaveAsMemory={home.saveAsMemory}
          />
        ) : null}
      </ScrollView>

      {/*
        One input across idle and listening, like the symbol, docked above the
        tab bar. The TextInput is the SAME element in the SAME parent in both
        states — swapping or reparenting it on the first keystroke would drop
        focus and blink the keyboard. Only the mic button toggles.
      */}
      {(home.state === 'idle' || home.state === 'listening') &&
      !voiceListening ? (
        <View style={styles.inputDock}>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.field}
              placeholder="Tell Kandoo anything…"
              placeholderTextColor={colors.inkFaint}
              underlineColorAndroid="transparent"
              value={home.transcript}
              onChangeText={home.updateTranscript}
              multiline
              // Matches the server's MAX_CAPTURE_CHARS.
              maxLength={4000}
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
                <Image source={MIC_ICON} style={styles.micIcon} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {home.response ? (
        <ReviewSheet
          visible={sheetOpen}
          summary={home.response.summary}
          confidence={home.response.confidence}
          results={home.response.results}
          rawText={home.submittedText}
          captureId={home.response.captureId}
          onClose={() => setSheetOpen(false)}
          onResultsChanged={home.replaceResults}
          onKeptAll={() => {
            setSheetOpen(false);
            home.markRemembered();
          }}
        />
      ) : null}

      <Paywall
        visible={home.paywallVisible}
        onClose={home.closePaywall}
        onPurchased={() => {
          entitlement.refresh();
          home.onProUnlocked();
          if (!chosenName(account)) setAskName(true);
        }}
      />

      <NameSheet visible={askName} welcome onClose={() => setAskName(false)} />

      <KandooAgent
        visible={agentOpen}
        onClose={() => setAgentOpen(false)}
        onNeedPro={home.openPaywall}
      />

      <AccountSheet
        visible={accountOpen}
        isPro={entitlement.isPro}
        onClose={() => setAccountOpen(false)}
        onGetPro={home.openPaywall}
        onEntitlementChange={entitlement.refresh}
      />

      <NoteDetail
        captureId={noteId}
        visible={noteId !== null}
        onClose={() => setNoteId(null)}
      />
    </View>
  );
}

// ---------------------------------------------------------------- Idle

type IdleProps = {
  recent: RecentItem[];
  loaded: boolean;
  onSelect: (item: RecentItem) => void;
};

function Idle({ recent, loaded, onSelect }: IdleProps) {
  // Nothing until the first fetch settles — no flash of "Nothing yet.".
  if (!loaded) return null;

  // Home already shows the symbol large above, so its empty state is words only.
  if (recent.length === 0) {
    return (
      <EmptyState
        line="Nothing yet."
        help="Tell about your day. Kandoo will remember."
        showMark={false}
      />
    );
  }

  return (
    <View style={styles.recent}>
      <Text style={styles.recentLabel}>Recently</Text>
      {recent.map((item) => (
        <Pressable
          key={item.id}
          style={styles.recentRow}
          onPress={() => onSelect(item)}
        >
          <Text style={styles.recentSummary} numberOfLines={2}>
            {item.summary}
          </Text>
          <Text style={styles.recentMeta}>
            {timeAgo(item.createdAt)} · {describeCounts(item)}
          </Text>
        </Pressable>
      ))}
    </View>
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

/** A speaker cone (box + flared triangle) with sound bars when on, a slash when
 *  muted. Drawn with Views like every other glyph — no emoji, no icon library. */
function SpeakerGlyph({ color, muted }: { color: string; muted: boolean }) {
  return (
    <View style={styles.speaker} pointerEvents="none">
      <View style={[styles.speakerBox, { backgroundColor: color }]} />
      <View style={[styles.speakerCone, { borderRightColor: color }]} />
      {muted ? (
        <View style={[styles.speakerSlash, { backgroundColor: color }]} />
      ) : (
        <View style={styles.speakerWaves}>
          <View
            style={[styles.wave, styles.waveSm, { backgroundColor: color }]}
          />
          <View
            style={[styles.wave, styles.waveLg, { backgroundColor: color }]}
          />
        </View>
      )}
    </View>
  );
}

// ----------------------------------------------------------- Listening

type ListeningProps = {
  canStop: boolean;
  voiceActive: boolean;
  error: string | null;
  notice: string | null;
  busy: boolean;
  onStop: () => void;
  onCancel: () => void;
  /** Keep the words as a memory when Kandoo found nothing to act on. */
  onSaveAsMemory: () => void;
};

function Listening({
  canStop,
  voiceActive,
  error,
  notice,
  busy,
  onStop,
  onCancel,
  onSaveAsMemory,
}: ListeningProps) {
  return (
    <>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {/* Kandoo's own voice when nothing actionable came back — gentle, not an
          error — with a way to keep the words anyway, so nothing is lost. */}
      {notice ? (
        <>
          <Text style={styles.notice}>{notice}</Text>
          <Pressable
            style={[styles.saveMemory, busy && styles.btnDisabled]}
            onPress={onSaveAsMemory}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.saveMemoryText}>
              {busy ? 'Saving…' : 'Save it as a memory'}
            </Text>
          </Pressable>
        </>
      ) : null}

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
          <Text style={styles.btnPrimaryText}>Send</Text>
        </Pressable>
      </View>
    </>
  );
}

// ------------------------------------------------------ Voice listening

type VoiceListeningProps = {
  transcript: string;
  /** Listening is paused while the user edits the words. */
  paused: boolean;
  canSend: boolean;
  error: string | null;
  notice: string | null;
  busy: boolean;
  onSend: () => void;
  onCancel: () => void;
  onEdit: (text: string) => void;
  onPause: () => void;
  onResume: () => void;
};

/** How long after the last touch or keystroke Kandoo starts listening again. */
const RESUME_AFTER_EDIT_MS = 2000;

/** The spoken words start large and step down as they grow, like a caption. */
function spokenSize(length: number) {
  if (length <= 80) return { fontSize: 24, lineHeight: 32 };
  if (length <= 200) return { fontSize: 20, lineHeight: 28 };
  return { fontSize: 17, lineHeight: 26 };
}

/**
 * The mic is live: the words appear in Kandoo's serif as they are heard, and
 * Send stops the mic and submits in one tap (useHome.stopListening).
 */
function VoiceListening({
  transcript,
  paused,
  canSend,
  error,
  notice,
  busy,
  onSend,
  onCancel,
  onEdit,
  onPause,
  onResume,
}: VoiceListeningProps) {
  // Touching the words pauses listening; two seconds after the last touch or
  // keystroke, it listens again and new speech is added after the edit.
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const holdForEdit = () => {
    onPause();
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
  };
  const resumeSoon = () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(onResume, RESUME_AFTER_EDIT_MS);
  };

  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    []
  );

  return (
    <>
      <View style={styles.voiceBody}>
        <Text style={styles.immersiveLabel}>
          {paused ? 'Paused while you edit' : 'Listening…'}
        </Text>
        {/* The words as heard, editable in place: tap to place the cursor.
            It scrolls inside itself once long, so the line being edited stays
            in view above the keyboard. */}
        <TextInput
          style={[
            styles.spoken,
            styles.spokenInput,
            spokenSize(transcript.length),
          ]}
          value={transcript}
          onChangeText={(text) => {
            holdForEdit();
            onEdit(text);
            resumeSoon();
          }}
          onTouchStart={holdForEdit}
          onTouchEnd={resumeSoon}
          placeholder="Start speaking — tap here to edit"
          placeholderTextColor={colors.inkFaint}
          underlineColorAndroid="transparent"
          multiline
          scrollEnabled
          accessibilityLabel="What you said. Tap to edit."
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      </View>

      <View style={styles.dockActions}>
        <Pressable style={styles.btn} onPress={onCancel} disabled={busy}>
          <Text style={styles.btnText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.btnPrimary, (busy || !canSend) && styles.btnDisabled]}
          onPress={onSend}
          disabled={busy || !canSend}
        >
          <Text style={styles.btnPrimaryText}>Send</Text>
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
  // While the backend is working, the breathing mark is the whole signal and
  // the words wait in the card, dimmed. No spinner, ever.
  const chips = response ? buildChips(response) : [];
  const nothingActionable = response ? !hasActions(response) : false;

  const label = !response
    ? 'Working it out'
    : nothingActionable
      ? 'Saved what you said'
      : 'I understood';
  const title =
    !response || nothingActionable
      ? transcript
      : (response.summary ?? transcript);

  return (
    <>
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.understoodContent}
      >
        <Text style={styles.understoodLabel}>{label}</Text>

        <View style={styles.card}>
          <Text style={[styles.cardTitle, !response && styles.cardTitleHeld]}>
            {title}
          </Text>
          {chips.length > 0 ? (
            <View style={styles.chips}>
              {chips.map((chip, index) => (
                <StaggerChip
                  key={`${chip.label}-${index}`}
                  chip={chip}
                  index={index}
                />
              ))}
            </View>
          ) : null}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      {response ? (
        <View style={styles.dockActions}>
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
      ) : null}
    </>
  );
}

type ChipKind = 'person' | 'topic' | 'time';
/** `kind` picks the Figma icon; the "+N" overflow chip has none. */
type Chip = { kind: ChipKind | null; label: string; guessed?: boolean };

function hasActions(response: InterpretationResponse): boolean {
  return response.results.some(
    (r) => r.status === 'ok' && (r.kind === 'reminder' || r.kind === 'memory')
  );
}

/**
 * Figma's Understood card: the people Kandoo heard, then the topics it filed
 * the memories under, then each reminder with its time. A memory with no
 * person or topic still gets a chip, so nothing extracted goes unseen. Capped
 * so a long recap reads as a summary, not a wall. Low confidence becomes the
 * one word "guessed" on the time chip — never a number.
 */
function buildChips(response: InterpretationResponse): Chip[] {
  const people = new Map<string, string>();
  const topics = new Map<string, string>();
  const loose: Chip[] = [];
  const times: Chip[] = [];
  const guessedTimes = response.confidence === 'low';
  const add = (into: Map<string, string>, value: string) => {
    const key = value.trim().toLowerCase();
    if (key && !into.has(key)) into.set(key, value.trim());
  };

  for (const result of response.results) {
    if (result.status !== 'ok') continue;

    if (result.kind === 'reminder') {
      const r = result.reminder;
      const when = formatDueDate(r.due_at) ?? formatPlaceWhen(r) ?? 'Reminder';
      const guessed = guessedTimes && !!r.due_at;
      times.push({
        kind: 'time',
        label: `${clip(r.task)} · ${when}${guessed ? ' — guessed' : ''}`,
        guessed,
      });
      if (r.person) add(people, r.person);
    } else if (result.kind === 'memory') {
      const m = result.memory;
      if (m.person) add(people, m.person);
      if (m.topics.length > 0) m.topics.forEach((topic) => add(topics, topic));
      else if (!m.person) loose.push({ kind: 'topic', label: clip(m.content) });
    }
  }

  const chips: Chip[] = [
    ...[...people.values()].map((label) => ({
      kind: 'person' as const,
      label,
    })),
    ...[...topics.values()].map((label) => ({ kind: 'topic' as const, label })),
    ...loose,
    ...times,
  ];

  if (chips.length <= CHIP_LIMIT) return chips;
  return [
    ...chips.slice(0, CHIP_LIMIT - 1),
    { kind: null, label: `+${chips.length - CHIP_LIMIT + 1}` },
  ];
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
    <Animated.View
      style={[styles.chip, chip.guessed && styles.chipGuessed, style]}
    >
      {chip.kind ? (
        <Image
          source={CHIP_ICONS[chip.kind]}
          style={[styles.chipIcon, chip.guessed && styles.chipIconGuessed]}
        />
      ) : null}
      <Text style={[styles.chipText, chip.guessed && styles.chipTextGuessed]}>
        {chip.label}
      </Text>
    </Animated.View>
  );
}

// ---------------------------------------------------------- Remembered

type RememberedProps = {
  response: InterpretationResponse;
  onDone: () => void;
  /** Opens the capture's note (the same NoteDetail the Memory tab uses). */
  onOpenNote: (captureId: string) => void;
};

type NoteStatus = 'idle' | 'taking' | 'failed';

/**
 * Complete (Figma: kandoo-complete): a gold tick for everything that was kept,
 * then Done. "Take note" asks Kandoo to write this capture up as a clean note;
 * while it works a muted "Taking note…" line waits in the list, and when it
 * lands it becomes one more tick — "Note taken · <title>" — that opens the note.
 * A capture Kandoo already wrote up shows that tick from the start.
 */
function Remembered({ response, onDone, onOpenNote }: RememberedProps) {
  const ticks = useMemo(() => buildTicks(response.results), [response.results]);
  const [note, setNote] = useState<{ title: string } | null>(
    response.note ?? null
  );
  const [noteStatus, setNoteStatus] = useState<NoteStatus>('idle');

  async function onTakeNote() {
    if (noteStatus === 'taking') return;
    setNoteStatus('taking');
    try {
      const saved = await takeNote(response.captureId);
      setNote(saved);
      setNoteStatus('idle');
    } catch (caught) {
      logFailure('Take note failed:', caught);
      setNoteStatus('failed');
    }
  }

  return (
    <>
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.completeContent}
      >
        <Text style={styles.completeLabel}>I’ve got it</Text>

        <View style={styles.ticks}>
          {ticks.map((tick, index) => (
            <View key={index} style={styles.tickRow}>
              <View style={styles.tickIconWrap}>
                <Image source={CHECK_ICON} style={styles.tickIcon} />
              </View>
              <Text style={styles.tickText}>{tick}</Text>
            </View>
          ))}

          {note ? (
            <Pressable
              style={styles.tickRow}
              onPress={() => onOpenNote(response.captureId)}
              accessibilityRole="button"
              accessibilityLabel="Open the note"
            >
              <View style={styles.tickIconWrap}>
                <Image source={CHECK_ICON} style={styles.tickIcon} />
              </View>
              <Text style={styles.tickText}>
                Note taken · <Text style={styles.tickLink}>{note.title}</Text>
              </Text>
            </Pressable>
          ) : noteStatus === 'taking' ? (
            <View style={styles.tickRow}>
              <View style={styles.tickIconWrap} />
              <Text style={[styles.tickText, styles.tickPending]}>
                Taking note…
              </Text>
            </View>
          ) : null}
        </View>

        {noteStatus === 'failed' ? (
          <Text style={styles.error}>
            Couldn’t take a note just now. Try again.
          </Text>
        ) : null}
      </ScrollView>

      <View style={styles.dockActions}>
        {!note ? (
          <Pressable
            style={[styles.btn, noteStatus === 'taking' && styles.btnDisabled]}
            onPress={onTakeNote}
            disabled={noteStatus === 'taking'}
          >
            <Text style={styles.btnText}>Take note</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.btnPrimary} onPress={onDone}>
          <Text style={styles.btnPrimaryText}>Done</Text>
        </Pressable>
      </View>
    </>
  );
}

/** Figma's Complete list: one line for the memories, one per reminder. */
function buildTicks(results: InterpretResult[]): string[] {
  const ticks: string[] = [];
  let memories = 0;
  for (const result of results) {
    if (result.status !== 'ok') continue;
    if (result.kind === 'reminder') {
      const when =
        formatDueDate(result.reminder.due_at) ?? formatPlaceWhen(result.reminder);
      ticks.push(
        `Reminder · ${result.reminder.task}${when ? ` · ${when}` : ''}`
      );
    } else if (result.kind === 'memory') {
      memories++;
    } else {
      ticks.push('Answered');
    }
  }
  if (memories > 0) {
    ticks.unshift(`${memories} memor${memories === 1 ? 'y' : 'ies'} saved`);
  }
  return ticks.length > 0 ? ticks : ['Saved what you said'];
}

// ------------------------------------------------------------ Answered

function recallAnswer(response: InterpretationResponse): string {
  for (const result of response.results) {
    if (result.kind === 'recall' && result.status === 'ok')
      return result.answer;
  }
  return response.summary ?? '';
}

type AnsweredProps = {
  response: InterpretationResponse;
  onDone: () => void;
  /** MuMu and other recogniser-less devices hide the mic; speech still works. */
  voiceSupported: boolean;
  /** Stop speaking and start listening for the next question (no state carries). */
  onAskAgain: () => void;
};

/**
 * Recall answers land here, not in Understanding. The answer fades in, and —
 * unless muted — Kandoo speaks it aloud (expo-speech, on-device). The text stays
 * on screen; speech is additive. A speaker toggle silences it (persisted, for a
 * meeting), and a mic re-asks: it stops the speech at once and listens for the
 * next question, whose answer replaces this one. Speech stops on every exit —
 * mute, mic, Done, navigating away, backgrounding — because a voice still
 * talking after the user has left is the worst failure this feature has.
 */
function Answered({
  response,
  onDone,
  voiceSupported,
  onAskAgain,
}: AnsweredProps) {
  const answer = recallAnswer(response);
  const fromLocation = !!response?.results.some(
    (r) => r.kind === 'recall' && r.status === 'ok' && r.fromLocation
  );
  const { enabled, loading, toggle } = useSpeechEnabled();
  const shown = useSharedValue(0);
  // True while Kandoo is saying this answer: the primary button reads Stop, then
  // Done once it falls quiet. Each utterance gets an id so a stale end callback
  // (the previous answer being cut off) can't flip a newer one to Done.
  const [speaking, setSpeaking] = useState(false);
  const utterance = useRef(0);

  function say(value: string) {
    const id = ++utterance.current;
    setSpeaking(true);
    speakAnswer(value, () => {
      if (utterance.current === id) setSpeaking(false);
    });
  }

  function silence() {
    utterance.current++;
    setSpeaking(false);
    stopSpeaking();
  }

  useEffect(() => {
    shown.value = withTiming(1, { duration: 520 });
  }, [shown]);

  // Speak each new answer once the stored preference is known — never before, or
  // a muted user hears a burst before the `false` loads. Cleanup silences on any
  // unmount: Done, the mic's transition to listening, or navigating away.
  useEffect(() => {
    if (loading) return;
    if (enabled) say(answer);
    return () => {
      utterance.current++;
      stopSpeaking();
    };
    // `enabled` is deliberately not a dep: toggling is handled in onToggle so a
    // mute doesn't re-trigger speech. This runs on a new answer or once loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer, loading]);

  // A voice must not outlive the foreground — stop the moment the app backgrounds.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') stopSpeaking();
    });
    return () => sub.remove();
  }, []);

  // Navigating away is a blur, not an unmount, under the native tab bar (the Home
  // screen stays mounted). Stop on blur so speech never follows the user to
  // another tab — the exact failure this feature must not have.
  useFocusEffect(
    useCallback(() => {
      return () => stopSpeaking();
    }, [])
  );

  function onToggle() {
    const willBeOn = !enabled;
    toggle();
    if (willBeOn) say(answer);
    else silence();
  }

  function onMic() {
    silence();
    onAskAgain();
  }

  function onPressDone() {
    silence();
    onDone();
  }

  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: 6 * (1 - shown.value) }],
  }));

  // Same full-screen layout as voice listening: the answer in Kandoo's serif,
  // Ask again on the left, Stop (while speaking) then Done on the right. The
  // speaker keeps the persisted mute preference one tap away.
  return (
    <>
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.immersiveContent}
      >
        <View style={styles.answeredHead}>
          <Text style={styles.immersiveLabel}>
            {speaking ? 'Speaking…' : fromLocation ? 'Here’s where you are' : 'Here’s what you told me'}
          </Text>
          <Pressable
            style={styles.speakerBtn}
            onPress={onToggle}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={enabled ? 'Mute answers' : 'Speak answers'}
          >
            <SpeakerGlyph color={colors.markRing} muted={!enabled} />
          </Pressable>
        </View>

        <Animated.Text style={[styles.spoken, style]} selectable>
          {answer}
        </Animated.Text>
      </ScrollView>

      <View style={styles.dockActions}>
        {voiceSupported ? (
          <Pressable
            style={styles.btn}
            onPress={onMic}
            accessibilityRole="button"
            accessibilityLabel="Ask another question"
          >
            <Text style={styles.btnText}>Ask again</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.btnPrimary}
          onPress={speaking ? silence : onPressDone}
        >
          <Text style={styles.btnPrimaryText}>
            {speaking ? 'Stop' : 'Done'}
          </Text>
        </Pressable>
      </View>
    </>
  );
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
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.space5,
    marginBottom: spacing.space5,
  },
  brand: {
    ...text.label,
    color: colors.inkMuted,
  },
  wordmark: {
    fontFamily: text.wordmark.fontFamily,
    fontSize: 16,
    lineHeight: 20,
    color: colors.ink,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  talk: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  talkText: { ...text.label, textTransform: 'none', letterSpacing: 0.5, color: colors.ink },
  badge: {
    backgroundColor: colors.accentWash,
    borderRadius: radius.full,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  badgeText: {
    ...text.label,
    textTransform: 'none',
    letterSpacing: 1,
    color: colors.markRing,
  },
  answerText: {
    ...text.answer,
    color: colors.ink,
    alignSelf: 'stretch',
    marginBottom: spacing.space3,
  },
  symbol: {
    alignItems: 'center',
    marginBottom: spacing.space5,
  },
  symbolTyping: {
    marginBottom: spacing.space2,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    alignItems: 'center',
    paddingHorizontal: spacing.space5,
    paddingTop: spacing.space5,
    paddingBottom: spacing.space5,
  },

  header: {
    alignSelf: 'stretch',
    gap: spacing.space2,
    marginBottom: spacing.space6,
  },
  greeting: {
    ...text.body,
    color: colors.inkMuted,
  },
  ask: {
    ...text.displayL,
    letterSpacing: 0,
    color: colors.ink,
  },
  listeningLabel: {
    ...text.caption,
    color: colors.inkMuted,
    marginBottom: spacing.space2,
  },

  // The input docks above the tab bar; the keyboard lifts it with the window.
  inputDock: {
    paddingHorizontal: spacing.space5,
    paddingTop: spacing.space2,
    paddingBottom: spacing.space3,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    paddingLeft: spacing.space4,
    paddingRight: spacing.space2,
  },
  field: {
    ...text.body,
    flex: 1,
    color: colors.ink,
    maxHeight: 120,
    paddingVertical: spacing.space3,
  },
  micBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micIcon: {
    width: 20,
    height: 20,
    tintColor: colors.markRing,
  },
  // Voice listening / spoken answer (Figma: kandoo-listening).
  halo: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Sized and shaded per state by haloStyles().
  haloGlow: {
    position: 'absolute',
  },
  immersiveContent: {
    paddingHorizontal: spacing.space5,
    paddingTop: spacing.space4,
    paddingBottom: spacing.space5,
  },
  voiceBody: {
    flex: 1,
    paddingHorizontal: spacing.space5,
    paddingTop: spacing.space4,
  },
  spokenInput: {
    flex: 1,
    textAlignVertical: 'top',
    padding: 0,
  },
  immersiveLabel: {
    ...text.caption,
    color: colors.markRing,
    textAlign: 'center',
  },
  spoken: {
    ...text.memory,
    color: colors.ink,
    marginTop: spacing.space6,
  },
  dockActions: {
    flexDirection: 'row',
    gap: spacing.space3,
    paddingHorizontal: spacing.space5,
    paddingTop: spacing.space3,
    paddingBottom: spacing.space5,
  },
  answeredHead: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.space1,
  },
  speakerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speaker: {
    width: 24,
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakerBox: {
    width: 5,
    height: 8,
    borderRadius: 1,
  },
  speakerCone: {
    width: 0,
    height: 0,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderRightWidth: 8,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    marginLeft: -1,
  },
  speakerWaves: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 3,
  },
  wave: {
    width: 2,
    borderRadius: 1,
  },
  waveSm: {
    height: 6,
  },
  waveLg: {
    height: 10,
  },
  speakerSlash: {
    position: 'absolute',
    width: 26,
    height: 2,
    borderRadius: 1,
    transform: [{ rotate: '45deg' }],
  },
  held: {
    ...text.bodyL,
    color: colors.inkMuted,
    textAlign: 'center',
    marginTop: spacing.space2,
  },

  recent: {
    alignSelf: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  recentLabel: {
    ...text.label,
    letterSpacing: 1.5,
    color: colors.markRing,
    marginBottom: spacing.space1,
  },
  recentRow: {
    paddingVertical: spacing.space4,
    gap: spacing.space1,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  recentSummary: {
    fontFamily: fontFamily.displaySemiBold,
    fontSize: 17,
    lineHeight: 22,
    color: colors.ink,
  },
  recentMeta: {
    ...text.caption,
    color: colors.inkMuted,
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
  // Understood (Figma: kandoo-understood).
  understoodContent: {
    paddingHorizontal: spacing.space5,
    paddingTop: spacing.space3,
    paddingBottom: spacing.space5,
  },
  understoodLabel: {
    ...text.label,
    letterSpacing: 1.5,
    color: colors.markRing,
    textAlign: 'center',
    marginBottom: spacing.space6,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 20,
    gap: spacing.space4,
  },
  cardTitle: {
    ...text.answer,
    color: colors.ink,
  },
  cardTitleHeld: {
    color: colors.inkMuted,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.space2,
  },
  chip: {
    maxWidth: '100%',
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.accentWash,
  },
  chipGuessed: {
    borderColor: colors.alarmText,
  },
  chipIcon: {
    width: 14,
    height: 14,
    tintColor: colors.ink,
  },
  chipIconGuessed: {
    tintColor: colors.alarmText,
  },
  chipText: {
    ...text.caption,
    flexShrink: 1,
    color: colors.ink,
  },
  chipTextGuessed: {
    color: colors.alarmText,
  },

  // Complete (Figma: kandoo-complete).
  completeContent: {
    paddingHorizontal: spacing.space5,
    paddingTop: spacing.space6,
    paddingBottom: spacing.space5,
  },
  completeLabel: {
    ...text.label,
    letterSpacing: 0,
    color: colors.markRing,
    textAlign: 'center',
    marginBottom: spacing.space5,
  },
  ticks: {
    gap: 20,
  },
  tickRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.space3,
  },
  tickIconWrap: {
    width: 18,
    height: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickIcon: {
    width: 14,
    height: 14,
    tintColor: colors.markCore,
  },
  tickText: {
    ...text.body,
    flex: 1,
    lineHeight: 21,
    color: colors.ink,
  },
  tickLink: {
    fontFamily: fontFamily.textSemiBold,
    color: colors.markRing,
  },
  tickPending: {
    color: colors.inkMuted,
  },

  error: {
    ...text.caption,
    color: colors.alarmText,
    textAlign: 'center',
    marginTop: spacing.space3,
  },
  saveMemory: {
    alignSelf: 'center',
    marginTop: spacing.space3,
    paddingVertical: spacing.space2,
    paddingHorizontal: spacing.space4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.accentWash,
  },
  saveMemoryText: {
    ...text.bodyStrong,
    color: colors.markRing,
  },
  notice: {
    ...text.answer,
    color: colors.inkMuted,
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
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    ...text.bodyStrong,
    color: colors.inkMuted,
  },
  btnPrimary: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    ...text.bodyStrong,
    color: colors.ink,
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
