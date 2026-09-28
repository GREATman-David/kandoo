import * as Haptics from 'expo-haptics';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  confirmReminder,
  fetchCaptureNotes,
  interpretText,
  isNetworkError,
  type CaptureNote,
  type CreatedReminder,
  type InterpretResult,
  type InterpretationResponse,
} from '@/services/interpretationService';
import { scheduleReminder } from '@/services/localNotifications';
import { answerOffline, isLikelyQuestion } from '@/services/offlineRecall';

/**
 * Home is one route with four states, not four screens. This hook owns the
 * machine and everything that talks to the network; the screen only renders.
 *
 *   IDLE ──type──► LISTENING ──stop──► UNDERSTANDING ──remember──► REMEMBERED
 *     ▲                                                                │
 *     └────────────────────────────────done──────────────────────────┘
 */
export type HomeState =
  | 'idle'
  | 'listening'
  | 'understanding'
  | 'remembered'
  | 'answered';

export type RecentItem = {
  id: string;
  summary: string;
  reminders: number;
  memories: number;
  /** Capture time, so an older-than-boundary row opens the paywall on tap. */
  createdAt: string;
};

const RECENT_LIMIT = 3;

function clip(value: string, max = 52): string {
  const v = value.trim();
  return v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v;
}

function toRecentItem(capture: CaptureNote): RecentItem {
  return {
    id: capture.id,
    summary: capture.note?.title ?? clip(capture.text),
    reminders: capture.reminders.length,
    memories: capture.memories.length,
    createdAt: capture.created_at,
  };
}

type OkReminder = Extract<InterpretResult, { kind: 'reminder'; status: 'ok' }>;

function okReminders(results: InterpretResult[]): OkReminder[] {
  return results.filter(
    (r): r is OkReminder => r.kind === 'reminder' && r.status === 'ok'
  );
}

/** Haptics are feedback, never load-bearing; a device without them is fine. */
function haptic(style: Haptics.ImpactFeedbackStyle) {
  Haptics.impactAsync(style).catch((error: unknown) => {
    console.warn('Haptic failed:', error);
  });
}

const VOICE_SUPPORTED = ExpoSpeechRecognitionModule.isRecognitionAvailable();

/**
 * One options object for the initial start AND every silent restart, so a
 * restarted session behaves identically to the first. `continuous` asks the
 * recognizer to keep going past a pause; the silence-length extras ask Android
 * to wait much longer before deciding speech is over. Google's recognizer
 * frequently ignores both — so restart-on-'end' (below) is the real guarantee
 * that a 90-second recap with natural pauses is captured whole, not these hints.
 */
const START_OPTIONS = {
  lang: 'en-US',
  interimResults: true,
  continuous: true,
  androidIntentOptions: {
    EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 30000,
    EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 10000,
    EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 10000,
  },
} as const;

export function useHome() {
  const [state, setState] = useState<HomeState>('idle');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState<InterpretationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  // False until the first Recently fetch settles, so Home never flashes the
  // empty state at a returning user whose rows are still on the way.
  const [recentLoaded, setRecentLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  // Raised when extraction returns nothing actionable. Kandoo says so in its own
  // voice and the typed text stays in the field — the UI never shows nothing.
  const [notice, setNotice] = useState<string | null>(null);
  // Raised when a recall answer reaches past the free 10-day window. The paywall
  // appears at that boundary and nowhere else — never on launch.
  const [paywallVisible, setPaywallVisible] = useState(false);

  // The transcript that produced the current response, kept for the review
  // sheet's "Saved what you said" fallback and for retry after a failure.
  const submittedText = useRef('');
  // Latest transcript as a ref: voice results and the submit path both need it
  // without waiting for a state flush, since the speech 'end' event fires
  // immediately after the final 'result'.
  const latest = useRef('');
  const busyRef = useRef(false);
  // Set by onProUnlocked so the re-asked question re-checks Pro on the server
  // instead of hitting its short "free" cache and raising the paywall again.
  const freshEntitlementNext = useRef(false);
  // Set when the user asks to send while the mic is still live, so the 'end'
  // handler submits the final transcript rather than a mid-word interim.
  const submitOnEnd = useRef(false);
  // Text finalized across the recognizer's own segments AND across our silent
  // restarts. The live interim is shown appended to this; when a segment
  // finalizes, or a session ends and we restart, it is folded in here so the
  // next session's words ADD to it instead of replacing it. This is what makes
  // capture survive the pauses in a long recap.
  const committed = useRef('');
  // Distinguishes a user-driven stop/cancel from the recognizer ending on its
  // own. Only the latter — the OS deciding it heard a pause — triggers a
  // silent restart. The user, never the OS, decides when capture ends.
  const cancelRequested = useRef(false);
  const fatalError = useRef(false);

  function setTranscriptBoth(text: string) {
    latest.current = text;
    setTranscript(text);
  }

  // Recently comes from the server (GET /captures?limit=3&noted=false), not
  // memory — the old in-memory list was empty on every cold start, which is why
  // Home looked bare. Best-effort: a failure just leaves Recently empty.
  const loadRecent = useCallback(async () => {
    try {
      // Only captures that kept something — a question is answered, not listed.
      const captures = await fetchCaptureNotes({
        limit: RECENT_LIMIT,
        notedOnly: false,
        requireActions: true,
      });
      setRecent(captures.map(toRecentItem));
    } catch (caught) {
      console.warn('Loading Recently failed:', caught);
    } finally {
      setRecentLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  /**
   * Ask the backend what it heard. Reads the transcript from a ref so the
   * voice 'end' path and the typed path share one implementation. The symbol
   * turns accent the moment this starts — that breathing is the "working it
   * out" signal, and the only loading indicator Home ever shows.
   */
  const runInterpret = useCallback(async () => {
    const text = latest.current.trim();
    if (!text || busyRef.current) return;

    submittedText.current = text;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    setState('understanding');

    try {
      const freshEntitlement = freshEntitlementNext.current;
      freshEntitlementNext.current = false;
      const result = await interpretText(text, { freshEntitlement });
      // Nothing actionable came back (extraction returned no ok actions). Never
      // show an empty Understanding screen — say so in Kandoo's voice and leave
      // the text where the user can reword and resend it.
      const ok = result.results.filter((r) => r.status === 'ok');
      if (ok.length === 0) {
        setNotice(
          "I wasn't sure what to do with that. Try asking it another way?"
        );
        setState('listening');
        return;
      }
      setResponse(result);
      // A recall question lands in ANSWERED (the answer streams in with its
      // sources); a capture stays in UNDERSTANDING (chips + Remember).
      const isRecall = ok.some((r) => r.kind === 'recall');
      setState(isRecall ? 'answered' : 'understanding');
      // The paywall is a recall-boundary event: it opens only when the answer
      // genuinely reached older, Pro-only memories.
      const reachedPro = result.results.some(
        (r) => r.kind === 'recall' && r.status === 'ok' && r.proBoundaryHit
      );
      if (reachedPro) setPaywallVisible(true);
    } catch (caught) {
      console.error('Interpret failed:', caught);

      // No connection, and it reads as a question: answer from what is saved
      // on this phone rather than failing. Said plainly as an offline answer.
      if (isNetworkError(caught) && isLikelyQuestion(text)) {
        const answer = await answerOffline(text);
        if (answer) {
          setResponse({
            success: true,
            captureId: '',
            summary: null,
            confidence: 'low',
            note: null,
            results: [
              { kind: 'recall', status: 'ok', answer, memories: [], proBoundaryHit: false },
            ],
          });
          setState('answered');
          return;
        }
      }

      setError(
        caught instanceof Error ? caught.message : 'Could not process that.'
      );
      // Back to listening with the words intact, so nothing is lost.
      setState('listening');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  // --- Voice: the mic streams into the same transcript the field edits. ---
  // Each result is the current segment only; we append it to everything
  // finalized so far, so the displayed transcript grows across pauses.
  useSpeechRecognitionEvent('result', (event) => {
    const segment = event.results[0]?.transcript ?? '';
    const full = [committed.current, segment]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    setTranscriptBoth(full);
    // A finalized segment is locked in so the next phrase appends to it.
    if (event.isFinal) committed.current = full;
  });

  useSpeechRecognitionEvent('end', () => {
    // Cancelled: cancelListening already reset the UI. Nothing to do.
    if (cancelRequested.current) {
      cancelRequested.current = false;
      return;
    }
    // A fatal error (permission, no recogniser) ended it: stop, but keep the
    // words captured so far and the typing fallback.
    if (fatalError.current) {
      fatalError.current = false;
      setVoiceActive(false);
      return;
    }
    // User pressed Stop: fold in the final words and submit.
    if (submitOnEnd.current) {
      submitOnEnd.current = false;
      committed.current = latest.current.trim();
      setVoiceActive(false);
      void runInterpret();
      return;
    }
    // Otherwise the recogniser ended ITSELF — a pause, a silence timeout, or a
    // finished segment. The user hasn't asked to stop, so keep the session
    // alive: fold in what we have and start listening again, silently, without
    // touching the UI. A long silence (including at the very start) just loops
    // back through here, so it never ends capture.
    committed.current = latest.current.trim();
    try {
      ExpoSpeechRecognitionModule.start(START_OPTIONS);
    } catch (caught) {
      console.warn('Voice restart failed:', caught);
      setVoiceActive(false);
      setError('Voice capture stopped. You can keep typing.');
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    // 'end' fires immediately after an error; this handler only records whether
    // the error is fatal, so 'end' knows whether to restart or stop. Words
    // already captured are never lost, and typing always stays available.
    console.warn('Speech recognition error:', event.error, event.message);
    const fatal =
      event.error === 'not-allowed' ||
      event.error === 'service-not-allowed' ||
      event.error === 'audio-capture' ||
      event.error === 'language-not-supported';
    if (fatal) {
      fatalError.current = true;
      setError(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone access is off. You can still type.'
          : 'Voice capture is unavailable. You can still type.'
      );
    }
    // Transient errors (no-speech, no-match, speech-timeout, network, busy) are
    // the normal cost of a pause and are left for 'end' to restart through.
  });

  /** Typing the first character is what opens capture in text mode. */
  const startListening = useCallback(() => {
    setState((current) => {
      if (current !== 'idle') return current;
      haptic(Haptics.ImpactFeedbackStyle.Light);
      return 'listening';
    });
    setError(null);
  }, []);

  const updateTranscript = useCallback(
    (text: string) => {
      setTranscriptBoth(text);
      setNotice(null);
      if (text.length > 0) startListening();
    },
    [startListening]
  );

  /**
   * Speak instead of type. Voice replaces the field as the input — it does not
   * add a state — and typing stays available alongside it. On-device, so no
   * network and no API quota is spent (AGENTS.md §3.6).
   */
  const startVoice = useCallback(async () => {
    if (!VOICE_SUPPORTED) {
      setError('Speech recognition is not available. You can type instead.');
      setState('listening');
      return;
    }

    try {
      const permission =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone access is needed to speak. You can type instead.');
        setState('listening');
        return;
      }

      setError(null);
      committed.current = '';
      cancelRequested.current = false;
      fatalError.current = false;
      submitOnEnd.current = false;
      setTranscriptBoth('');
      setState('listening');
      setVoiceActive(true);
      haptic(Haptics.ImpactFeedbackStyle.Light);

      ExpoSpeechRecognitionModule.start(START_OPTIONS);
    } catch (caught) {
      console.error('Starting voice failed:', caught);
      setVoiceActive(false);
      setError('Could not start the microphone. You can type instead.');
      setState('listening');
    }
  }, []);

  const cancelListening = useCallback(() => {
    if (voiceActive) {
      // Flag the cancel BEFORE abort so the 'end' it triggers doesn't restart.
      cancelRequested.current = true;
      submitOnEnd.current = false;
      ExpoSpeechRecognitionModule.abort();
    }
    committed.current = '';
    setVoiceActive(false);
    setTranscriptBoth('');
    setError(null);
    setNotice(null);
    setState('idle');
  }, [voiceActive]);

  /**
   * Send what was captured. If the mic is still live, stop it and let the
   * 'end' handler submit the final transcript; otherwise submit now.
   */
  const stopListening = useCallback(async () => {
    if (voiceActive) {
      submitOnEnd.current = true;
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    await runInterpret();
  }, [voiceActive, runInterpret]);

  const openPaywall = useCallback(() => setPaywallVisible(true), []);

  /** The review sheet edited, removed or confirmed items: keep Home in step. */
  const replaceResults = useCallback((results: InterpretResult[]) => {
    setResponse((current) => (current ? { ...current, results } : current));
  }, []);

  /**
   * Everything was kept from the review sheet — it already confirmed and
   * scheduled each reminder, so Home just shows Complete (no second confirm).
   */
  const markRemembered = useCallback(() => {
    haptic(Haptics.ImpactFeedbackStyle.Soft);
    setState('remembered');
  }, []);
  const closePaywall = useCallback(() => setPaywallVisible(false), []);

  /**
   * Called after a successful purchase. Re-asks the exact same question now
   * that the user is Pro, so the answer comes back with the older memories the
   * boundary was hiding — the moment the paywall pays off.
   */
  const onProUnlocked = useCallback(() => {
    setPaywallVisible(false);
    latest.current = submittedText.current;
    freshEntitlementNext.current = true;
    void runInterpret();
  }, [runInterpret]);

  /**
   * The trust boundary. Reminders were created `pending`; this is the only
   * place they become `confirmed`. Memories were already saved by /interpret.
   * If any confirm fails, stay in Understanding and say so — a reminder the
   * user thinks is scheduled but isn't is the worst outcome available.
   */
  const remember = useCallback(async () => {
    if (!response || busy) return;

    setBusy(true);
    setError(null);

    const settled = await Promise.allSettled(
      okReminders(response.results).map((item) =>
        confirmReminder(item.reminder.id)
      )
    );
    const failed = settled.filter((s) => s.status === 'rejected');

    if (failed.length > 0) {
      setBusy(false);
      for (const f of failed) {
        console.error('Confirm reminder failed:', (f as PromiseRejectedResult).reason);
      }
      setError(
        failed.length === 1
          ? "One reminder couldn't be confirmed. Try again."
          : `${failed.length} reminders couldn't be confirmed. Try again.`
      );
      return;
    }

    // Schedule the local notification for each confirmed reminder. The DEVICE
    // owns the trigger (§3.2): once scheduled, it fires with the server off.
    // Best-effort per reminder — the server has already committed the confirm,
    // so a scheduling hiccup must not un-confirm it; launch reconcile retries.
    const confirmed = settled
      .filter(
        (s): s is PromiseFulfilledResult<CreatedReminder> =>
          s.status === 'fulfilled'
      )
      .map((s) => s.value);
    for (const reminder of confirmed) {
      try {
        await scheduleReminder(reminder);
      } catch (error) {
        console.error(`Scheduling reminder ${reminder.id} failed:`, error);
      }
    }

    setBusy(false);
    haptic(Haptics.ImpactFeedbackStyle.Soft);
    setState('remembered');
  }, [response, busy]);

  /** Back to idle, and refresh Recently from the server so the new capture
   *  (and its note) appears at the top. */
  const done = useCallback(() => {
    setResponse(null);
    latest.current = '';
    committed.current = '';
    setTranscript('');
    setError(null);
    setNotice(null);
    setPaywallVisible(false);
    submittedText.current = '';
    setState('idle');
    void loadRecent();
  }, [loadRecent]);

  return {
    state,
    transcript,
    response,
    error,
    notice,
    busy,
    recent,
    recentLoaded,
    voiceActive,
    voiceSupported: VOICE_SUPPORTED,
    paywallVisible,
    openPaywall,
    closePaywall,
    onProUnlocked,
    replaceResults,
    markRemembered,
    submittedText: submittedText.current,
    updateTranscript,
    startListening,
    startVoice,
    stopListening,
    cancelListening,
    remember,
    done,
  };
}
