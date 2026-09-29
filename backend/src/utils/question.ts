/**
 * Does this look like a question to Kandoo rather than something to remember?
 * Used only when every AI model is unavailable, to still answer a question
 * from the user's memories. Mirrors isLikelyQuestion in the app
 * (src/services/offlineRecall.ts) so the two degrade the same way.
 */
const QUESTION_WORDS = new Set([
  'what', 'when', 'where', 'who', 'whom', 'whose', 'which', 'why', 'how',
  'did', 'do', 'does', 'is', 'are', 'was', 'were', 'have', 'has', 'had',
  'can', 'could', 'should', 'will', 'would', 'tell', 'find',
]);

export function isLikelyQuestion(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.endsWith('?')) return true;
  const first = trimmed.split(/\s+/)[0] ?? '';
  return QUESTION_WORDS.has(first);
}
