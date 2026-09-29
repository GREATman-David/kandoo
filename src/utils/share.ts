import { Share } from 'react-native';

/**
 * Sharing a note or memory out of Kandoo, through Android's own share sheet
 * (WhatsApp, Messages, email — anything installed).
 *
 * What's shared is the user's words, cleanly, with one quiet line of
 * attribution. Every shared note carries the name and the promise; it reads
 * like a signature, not an ad, so people are happy to send it.
 */
const SIGN_OFF = '— Shared from Kandoo · Tell Kandoo once. It remembers when it matters.';

async function share(message: string, title: string): Promise<void> {
  try {
    await Share.share({ message, title }, { dialogTitle: title });
  } catch (error) {
    // Closing the sheet is not an error; a failure to open it is worth a log.
    console.warn('Opening the share sheet failed:', error);
  }
}

export function shareNote(note: { title: string; body: string }): Promise<void> {
  return share(`${note.title}\n\n${note.body}\n\n${SIGN_OFF}`, note.title);
}

export function shareMemory(content: string): Promise<void> {
  return share(`${content}\n\n${SIGN_OFF}`, 'A memory from Kandoo');
}
