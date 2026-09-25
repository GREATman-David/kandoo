import * as Speech from 'expo-speech';

/**
 * On-device text-to-speech for recall answers. expo-speech is native and free —
 * no third-party service, no API cost (AGENTS §3.6). Speaking an answer never
 * blocks the UI; the text is already on screen and speech is additive.
 *
 * Every entry point stops any current utterance first, so a new answer never
 * overlaps the previous one — the caller doesn't have to track "am I speaking?".
 */
export function speakAnswer(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    Speech.stop();
    Speech.speak(trimmed);
  } catch (error) {
    // TTS is a nicety, never load-bearing — the answer is on screen regardless.
    console.warn('Speech.speak failed:', error);
  }
}

/**
 * Silence immediately. Called on mute, on the mic tap, on Done, on navigating
 * away and on backgrounding — a voice still talking after the user has left the
 * answer is the worst failure this feature has.
 */
export function stopSpeaking(): void {
  try {
    Speech.stop();
  } catch (error) {
    console.warn('Speech.stop failed:', error);
  }
}
