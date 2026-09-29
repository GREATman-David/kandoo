import type { CaptureNote } from './interpretationService';
import { readAllCached } from './offlineCache';
import { formatDueDate } from '@/utils/formatDueDate';

/**
 * Offline questions. With no connection the answer model can't run, so a
 * question is matched by keywords against what is saved on this phone (the
 * notes, memories and reminders the user has already loaded). It is a
 * fallback, said plainly as one — never presented as Kandoo's real answer.
 */

const QUESTION_WORDS = new Set([
  'what', 'when', 'where', 'who', 'whom', 'whose', 'which', 'why', 'how',
  'did', 'do', 'does', 'is', 'are', 'was', 'were', 'have', 'has', 'had',
  'can', 'could', 'should', 'will', 'would', 'tell', 'find',
]);

const STOP_WORDS = new Set([
  ...QUESTION_WORDS,
  'the', 'and', 'for', 'that', 'this', 'with', 'about', 'from', 'you', 'your',
  'me', 'my', 'mine', 'i', 'it', 'its', 'of', 'to', 'in', 'on', 'at', 'a', 'an',
  'say', 'said', 'tell', 'told', 'last', 'any', 'anything', 'there', 'they',
  'them', 'her', 'his', 'him', 'she', 'he', 'we', 'us', 'our', 'be', 'been',
  'remember', 'know', 'again',
]);

/** A question mark, or a question word up front. "Remind me to…" is not one. */
export function isLikelyQuestion(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.endsWith('?')) return true;
  const first = trimmed.split(/\s+/)[0] ?? '';
  return QUESTION_WORDS.has(first);
}

function keywords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) ?? [])
    .map((word) => word.replace(/'s$/, ''))
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

type Candidate = { id: string; text: string; createdAt: string };

function candidatesFrom(captures: CaptureNote[]): Candidate[] {
  const out: Candidate[] = [];
  for (const capture of captures) {
    for (const memory of capture.memories) {
      out.push({ id: `m:${memory.id}`, text: memory.content, createdAt: capture.created_at });
    }
    for (const reminder of capture.reminders) {
      const when = formatDueDate(reminder.due_at);
      out.push({
        id: `r:${reminder.id}`,
        text: `Reminder: ${reminder.task}${when ? ` · ${when}` : ''}.`,
        createdAt: capture.created_at,
      });
    }
    if (capture.memories.length === 0 && capture.reminders.length === 0) {
      out.push({
        id: `c:${capture.id}`,
        text: capture.note?.body ?? capture.text,
        createdAt: capture.created_at,
      });
    }
  }
  return out;
}

/**
 * The best few saved lines for `question`, phrased as an offline answer, or
 * null when nothing saved matches (the caller then says it needs a connection).
 */
export async function answerOffline(
  question: string,
  reason: 'offline' | 'slow' = 'offline'
): Promise<string | null> {
  const wanted = keywords(question);
  if (wanted.length === 0) return null;

  const lists = await readAllCached<CaptureNote[]>('captures:list:');
  const singles = await readAllCached<CaptureNote | null>('captures:one:');
  const captures = [...lists.flat(), ...singles.filter((c): c is CaptureNote => !!c)];

  const seen = new Set<string>();
  const scored = candidatesFrom(captures)
    .filter((candidate) => !seen.has(candidate.id) && seen.add(candidate.id))
    .map((candidate) => {
      const words = new Set(keywords(candidate.text));
      const score = wanted.filter(
        (word) => words.has(word) || [...words].some((w) => w.startsWith(word) || word.startsWith(w))
      ).length;
      return { candidate, score };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Date.parse(b.candidate.createdAt) - Date.parse(a.candidate.createdAt)
    )
    .slice(0, 3);

  if (scored.length === 0) return null;

  const lines = scored.map(({ candidate }) => {
    const line = candidate.text.trim();
    return /[.!?]$/.test(line) ? line : `${line}.`;
  });
  // Said honestly: offline is the phone; slow is Kandoo taking too long.
  const lead =
    reason === 'slow'
      ? "Kandoo is slow right now, so this is from what's saved on your phone."
      : "You're offline, so this is from what's saved.";
  return `${lead} ${lines.join(' ')}`;
}
