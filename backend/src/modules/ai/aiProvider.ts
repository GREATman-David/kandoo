import type { KandooInterpretation } from './interpretationSchema';

export type RecallMemory = {
  id: string;
  content: string;
  person: string | null;
  location: string | null;
  created_at: string;
  /** Present only when the memory came from hybrid retrieval. */
  score?: number;
};

export type InterpretContext = {
  /** ISO 8601 with offset, taken from the DEVICE, never the server. */
  clientTime: string;
  /** IANA zone, e.g. "Africa/Accra". */
  timezone: string;
};

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
  embed(texts: string[]): Promise<number[][]>;
}
