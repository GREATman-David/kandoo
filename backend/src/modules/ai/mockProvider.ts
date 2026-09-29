import type {
  AIProvider,
  InterpretContext,
  RecallMemory,
} from './aiProvider';

import type {
  KandooAction,
  KandooInterpretation,
  KandooNote,
} from './interpretationSchema';

import { EMBEDDING_DIMENSIONS } from './openaiProvider';

/**
 * Deterministic provider for offline development and for anyone cloning this
 * repository without an OpenAI key. It is deliberately crude — it exists so the
 * app runs, not so it understands.
 *
 * The old mock had an ordering bug where generic "remember" detection shadowed
 * recall detection. Recall is now checked first, since a question is always
 * more specific than a statement.
 */
export class MockAIProvider implements AIProvider {
  async interpret(
    text: string,
    context: InterpretContext
  ): Promise<KandooInterpretation> {
    const lower = text.toLowerCase();
    const actions: KandooAction[] = [];

    const isQuestion =
      text.trim().endsWith('?') ||
      /\b(what|when|where|who|did i|do you remember|what did)\b/.test(lower);

    if (isQuestion) {
      actions.push({
        kind: 'recall',
        query: text.trim(),
        scopePerson: null,
        scopePlace: null,
      });
    } else {
      // Split on sentence boundaries so one utterance can still yield several
      // actions — the whole point of the v2 contract.
      const sentences = text
        .split(/(?<=[.!?])\s+|\band then\b|\balso\b/i)
        .map((part) => part.trim())
        .filter((part) => part.length > 3);

      for (const sentence of sentences.length > 0 ? sentences : [text.trim()]) {
        const reminderLike =
          /\b(remind|remember to|don't forget|need to|have to|must)\b/i.test(
            sentence
          );

        if (reminderLike) {
          actions.push({
            kind: 'reminder',
            task: sentence
              .replace(/^.*?\b(remind me to|remember to|i need to|i have to)\b/i, '')
              .trim() || sentence,
            dueAt: this.guessTime(sentence, context),
            placeHint: null,
            placeTrigger: 'arrive',
            notBefore: null,
            people: [],
            insistent: /\b(alarm|wake me|urgent)\b/i.test(sentence),
          });
        } else {
          actions.push({
            kind: 'memory',
            content: sentence.replace(/^remember that\s+/i, '').trim(),
            people: [],
            placeHint: null,
            topics: [],
          });
        }
      }
    }

    return {
      summary: null,
      confidence: 'low',
      note: null,
      actions,
    };
  }

  /** Handles only "in N minutes/hours". Anything else returns null. */
  private guessTime(
    sentence: string,
    context: InterpretContext
  ): string | null {
    const match = sentence.match(/\bin (\d+)\s*(minute|min|hour)s?\b/i);
    if (!match) return null;

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const ms = unit.startsWith('hour') ? 3_600_000 : 60_000;

    const base = new Date(context.clientTime);
    if (Number.isNaN(base.getTime())) return null;

    return new Date(base.getTime() + amount * ms).toISOString();
  }

  async generateRecallAnswer(
    question: string,
    memories: RecallMemory[]
  ): Promise<string> {
    if (memories.length === 0) {
      return "I don't have anything saved about that yet.";
    }
    return `Here's what you saved: ${memories
      .slice(0, 3)
      .map((memory) => memory.content)
      .join(' ')}`;
  }

  /** The words themselves, titled by their opening — enough to exercise the path. */
  async writeNote(text: string): Promise<KandooNote> {
    const body = text.trim();
    const title = body.split(/\s+/).slice(0, 5).join(' ') || 'Note';
    return { title, body };
  }

  /**
   * Stable pseudo-vectors. Same text always yields the same vector, so cosine
   * similarity is meaningful for identical strings and meaningless otherwise —
   * enough to exercise the retrieval path without an API key.
   */
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      let hash = 2166136261;

      for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
        vector[Math.abs(hash) % EMBEDDING_DIMENSIONS] += 1;
      }

      const magnitude = Math.hypot(...vector) || 1;
      return vector.map((value) => value / magnitude);
    });
  }
}
