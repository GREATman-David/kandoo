import * as Haptics from 'expo-haptics';
import { useCallback, useRef, useState } from 'react';

import {
  confirmReminder,
  interpretText,
  type CreatedReminder,
  type InterpretResult,
  type InterpretationResponse,
} from '@/services/interpretationService';
import { scheduleReminder } from '@/services/localNotifications';

/**
 * Home is one route with four states, not four screens. This hook owns the
 * machine and everything that talks to the network; the screen only renders.
 *
 *   IDLE ──type──► LISTENING ──stop──► UNDERSTANDING ──remember──► REMEMBERED
 *     ▲                                                                │
 *     └────────────────────────────────done──────────────────────────┘
 */
export type HomeState = 'idle' | 'listening' | 'understanding' | 'remembered';

export type RecentItem = {
  id: string;
  summary: string;
  reminders: number;
  memories: number;
};

const RECENT_LIMIT = 3;

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

export function useHome() {
  const [state, setState] = useState<HomeState>('idle');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState<InterpretationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [busy, setBusy] = useState(false);

  // The transcript that produced the current response, kept for the review
  // sheet's "Saved what you said" fallback and for retry after a failure.
  const submittedText = useRef('');

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
      setTranscript(text);
      if (text.length > 0) startListening();
    },
    [startListening]
  );

  const cancelListening = useCallback(() => {
    setTranscript('');
    setError(null);
    setState('idle');
  }, []);

  /**
   * Stop listening and ask the backend what it heard. The symbol turns accent
   * the moment this starts — that breathing is the "working it out" signal, and
   * it is the only loading indicator Home ever shows.
   */
  const stopListening = useCallback(async () => {
    const text = transcript.trim();
    if (!text || busy) return;

    submittedText.current = text;
    setBusy(true);
    setError(null);
    setState('understanding');

    try {
      const result = await interpretText(text);
      setResponse(result);
    } catch (caught) {
      console.error('Interpret failed:', caught);
      setError(
        caught instanceof Error ? caught.message : 'Could not process that.'
      );
      // Back to listening with the words intact, so nothing is lost.
      setState('listening');
    } finally {
      setBusy(false);
    }
  }, [transcript, busy]);

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

  /** Back to idle. The capture joins the short list of recent items. */
  const done = useCallback(() => {
    if (response) {
      const reminders = okReminders(response.results).length;
      const memories = response.results.filter(
        (r) => r.kind === 'memory' && r.status === 'ok'
      ).length;
      setRecent((current) =>
        [
          {
            id: response.captureId,
            summary: response.summary ?? submittedText.current,
            reminders,
            memories,
          },
          ...current,
        ].slice(0, RECENT_LIMIT)
      );
    }

    setResponse(null);
    setTranscript('');
    setError(null);
    submittedText.current = '';
    setState('idle');
  }, [response]);

  return {
    state,
    transcript,
    response,
    error,
    busy,
    recent,
    submittedText: submittedText.current,
    updateTranscript,
    startListening,
    stopListening,
    cancelListening,
    remember,
    done,
  };
}
