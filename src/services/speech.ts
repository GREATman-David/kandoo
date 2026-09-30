import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';

import { fetchSpeech } from '@/services/interpretationService';

/**
 * Spoken recall answers, in Kandoo's voice — the same voice as Kandoo Agent, so
 * Free and Pro sound like one assistant. The audio comes from the backend
 * (/speak; the ElevenLabs key never leaves the server). If that fails — offline,
 * quota, not configured — the phone's own voice (expo-speech) says it instead.
 * Speaking never blocks the UI; the text is already on screen.
 *
 * Every entry point stops any current utterance first, so a new answer never
 * overlaps the previous one — the caller doesn't have to track "am I speaking?".
 */

let player: AudioPlayer | null = null;
/** Ends the current Kandoo-voice answer (releases it, tells the caller). */
let finishCurrent: (() => void) | null = null;
/** Bumped on every speak/stop, so a late download can't start talking. */
let generation = 0;

function releasePlayer(): void {
  if (!player) return;
  try {
    player.pause();
    player.remove();
  } catch (error) {
    console.warn('Releasing the speech player failed:', error);
  }
  player = null;
}

function speakOnDevice(text: string, onEnd?: () => void): void {
  try {
    Speech.stop();
    // `onEnd` fires once this utterance is over, however it ended — finished,
    // stopped, or failed — so the UI can swap Stop for Done.
    Speech.speak(text, { onDone: onEnd, onStopped: onEnd, onError: onEnd });
  } catch (error) {
    // TTS is a nicety, never load-bearing — the answer is on screen regardless.
    console.warn('Speech.speak failed:', error);
    onEnd?.();
  }
}

async function speakInKandooVoice(text: string, mine: number, onEnd?: () => void): Promise<void> {
  const audio = await fetchSpeech(text);
  if (mine !== generation) return; // stopped or replaced while downloading
  const file = new File(Paths.cache, `kandoo-answer-${mine}.mp3`);
  file.write(audio, { encoding: 'base64' });

  const next = createAudioPlayer({ uri: file.uri });
  player = next;
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    if (player === next) releasePlayer();
    if (finishCurrent === finish) finishCurrent = null;
    try {
      file.delete();
    } catch (error) {
      console.warn('Removing a spoken answer failed:', error);
    }
    onEnd?.();
  };
  next.addListener('playbackStatusUpdate', (status) => {
    if (status.didJustFinish) finish();
  });
  finishCurrent = finish;
  next.play();
}

export function speakAnswer(text: string, onEnd?: () => void): void {
  const trimmed = text.trim();
  stopSpeaking();
  if (!trimmed) {
    onEnd?.();
    return;
  }
  const mine = generation;
  // Until the audio arrives, a stop still has to tell the caller it's over.
  let told = false;
  const endOnce = () => {
    if (told) return;
    told = true;
    onEnd?.();
  };
  finishCurrent = endOnce;
  speakInKandooVoice(trimmed, mine, endOnce).catch((error) => {
    console.warn('Kandoo voice unavailable, using the phone voice:', error);
    if (mine === generation) speakOnDevice(trimmed, endOnce);
  });
}

/**
 * Silence immediately. Called on mute, on the mic tap, on Done, on navigating
 * away and on backgrounding — a voice still talking after the user has left the
 * answer is the worst failure this feature has.
 */
export function stopSpeaking(): void {
  generation += 1;
  releasePlayer();
  const finish = finishCurrent;
  finishCurrent = null;
  finish?.();
  try {
    Speech.stop();
  } catch (error) {
    console.warn('Speech.stop failed:', error);
  }
}
