import type { KandooInterpretation } from './interpretationSchema';

/**
 * A hit from recall. Despite the name it may be a saved memory OR a scheduled
 * reminder — `source` says which, and `due_at` is set only for reminders. The
 * answer model needs both to say "you said you'd call Mummy at 5pm" rather than
 * treating a commitment as a plain fact.
 */
export type RecallMemory = {
  id: string;
  source: 'memory' | 'reminder';
  content: string;
  person: string | null;
  location: string | null;
  /** Set only when `source` is 'reminder': the scheduled time. */
  due_at: string | null;
  created_at: string;
  /** Present only when the row came from hybrid retrieval. */
  score?: number;
};

export type InterpretContext = {
  /** ISO 8601 with offset, taken from the DEVICE, never the server. */
  clientTime: string;
  /** IANA zone, e.g. "Africa/Accra". */
  timezone: string;
};

/**
 * Whether a text is being stored or searched with. Asymmetric embedding models
 * (Gemini) encode the two differently and retrieval degrades when they are
 * mixed; symmetric ones (OpenAI) ignore this.
 */
export type EmbedTaskType = 'document' | 'query';

export interface AIProvider {
  interpret(
    text: string,
    context: InterpretContext
  ): Promise<KandooInterpretation>;

  generateRecallAnswer(
    question: string,
    memories: RecallMemory[]
  ): Promise<string>;

  /**
   * Returns one vector per input string, in the same order.
   * Dimension must match the `vector(1536)` column on memories.
   */
  embed(texts: string[], taskType?: EmbedTaskType): Promise<number[][]>;
}
