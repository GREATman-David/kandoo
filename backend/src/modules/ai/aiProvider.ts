import type {
  DocumentReading,
  KandooInterpretation,
  KandooNote,
  PhotoInterpretation,
} from './interpretationSchema';

/**
 * A hit from recall. Despite the name it may be a saved memory OR a scheduled
 * reminder — `source` says which, and `due_at` is set only for reminders. The
 * answer model needs both to say "you said you'd call Mummy at 5pm" rather than
 * treating a commitment as a plain fact.
 */
export type RecallMemory = {
  id: string;
  /**
   * Also 'note' (the note Kandoo wrote up from a capture) and 'library' (a
   * Library note) since 012 — recall reaches everything the user kept.
   */
  source: 'memory' | 'reminder' | 'note' | 'library';
  /** The Library category a 'library' hit is filed in. */
  category?: string | null;
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

/** A photo for the model: JPEG bytes as base64 (re-encoded on the phone). */
export type PhotoInput = {
  base64: string;
  mimeType: 'image/jpeg';
  /** What the user typed or said with it, if anything. */
  caption: string | null;
};

/** What reading a document needs beyond the clock: where it might be filed. */
export type DocumentContext = InterpretContext & {
  /** The user's existing Library category names. */
  categories: string[];
  /** A category the user asked for ("put it in Kandoo Project"), if any. */
  categoryHint: string | null;
};

export interface AIProvider {
  interpret(
    text: string,
    context: InterpretContext
  ): Promise<KandooInterpretation>;

  /**
   * Read a photo the user showed Kandoo and propose actions from it — the same
   * contract as interpret(), plus a one-line description. Never recall.
   */
  interpretPhoto(
    photo: PhotoInput,
    context: InterpretContext
  ): Promise<PhotoInterpretation>;

  /**
   * Read a photographed page into ONE organised Library note (Elite). No
   * actions; the caller proposes the note for review and saves nothing itself.
   */
  readDocument(photo: PhotoInput, context: DocumentContext): Promise<DocumentReading>;

  /**
   * One JSON completion for a shared prompt (prompts.ts). Returns the parsed
   * value UNVALIDATED — the caller owns the Zod schema, as for research, whose
   * steps each have their own shape. Temperature 0, no thinking tokens.
   */
  generateJson(system: string, user: string, maxOutputTokens: number): Promise<unknown>;

  generateRecallAnswer(
    question: string,
    memories: RecallMemory[]
  ): Promise<string>;

  /**
   * A written note for one capture, on the user's request ("Take note"). Text
   * only — the caller validates nothing else and persists it itself.
   */
  writeNote(text: string): Promise<KandooNote>;

  /**
   * Returns one vector per input string, in the same order.
   * Dimension must match the `vector(1536)` column on memories.
   */
  embed(texts: string[], taskType?: EmbedTaskType): Promise<number[][]>;
}
