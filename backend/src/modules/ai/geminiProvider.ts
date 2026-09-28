import { GoogleGenAI } from '@google/genai';

import {
  kandooInterpretationSchema,
  noteSchema,
  type KandooInterpretation,
  type KandooNote,
} from './interpretationSchema';

import {
  EMPTY_RECALL_ANSWER,
  NOTE_SYSTEM_PROMPT,
  RECALL_SYSTEM_PROMPT,
  extractionPrompt,
  recallUserPrompt,
} from './prompts';

import type {
  AIProvider,
  EmbedTaskType,
  InterpretContext,
  RecallMemory,
} from './aiProvider';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

/**
 * Matryoshka-trained, so 1536 is a truncation of the native 3072 rather than a
 * different model. That is what lets this drop into the existing
 * `vector(1536)` column with no migration.
 */
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Gemini 3.x Flash thinks by default, and the reasoning tokens are charged
 * against maxOutputTokens before any visible text. Extraction is strict JSON
 * at temperature 0 and recall is three sentences; neither gains from it, and
 * with it on the recall answer was being cut off mid-sentence.
 */
const NO_THINKING = { thinkingBudget: 0 };

const TASK_TYPES: Record<EmbedTaskType, string> = {
  document: 'RETRIEVAL_DOCUMENT',
  query: 'RETRIEVAL_QUERY',
};

/**
 * Free-tier quota is per Google Cloud PROJECT, not per key. Keys on separate
 * projects (GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3, ...) each carry
 * their own daily budget, so rotating on exhaustion multiplies it — the free
 * tier's ~20 generate/day is otherwise the top risk to filming a demo.
 */
function loadKeys(): string[] {
  const keys: string[] = [];
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  for (let i = 2; ; i++) {
    const next = process.env[`GEMINI_API_KEY_${i}`];
    if (!next) break;
    keys.push(next);
  }
  if (keys.length === 0) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }
  return keys;
}

let keys: string[] | null = null;
let clients: (GoogleGenAI | null)[] = [];
let activeKeyIndex = 0;

function getKeys(): string[] {
  if (!keys) {
    keys = loadKeys();
    clients = keys.map(() => null);
  }
  return keys;
}

function activeClient(): GoogleGenAI {
  const all = getKeys();
  if (!clients[activeKeyIndex]) {
    clients[activeKeyIndex] = new GoogleGenAI({ apiKey: all[activeKeyIndex] });
  }
  return clients[activeKeyIndex] as GoogleGenAI;
}

/**
 * Transient upstream failures worth retrying: 429 (rate limit), and 500/503
 * ("high demand" / "internal"). On the free tier a 503 during a demo is common,
 * and dropping the user's whole recap to one is the worst failure this app has.
 * A 400/404 (bad request, retired model) is a real error and is rethrown.
 */
function isRetryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { status?: unknown }).status;
  if (status === 429 || status === 500 || status === 503) return true;
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === 'string' &&
    (message.includes('429') ||
      message.includes('RESOURCE_EXHAUSTED') ||
      message.includes('503') ||
      message.includes('UNAVAILABLE') ||
      message.includes('500') ||
      message.includes('INTERNAL'))
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A per-minute limit clears in under a minute; a per-day limit clears at
 * midnight Pacific. Retrying the latter only burns wall-clock time and makes
 * the caller look hung, so it is surfaced immediately instead.
 */
function isDailyQuota(error: unknown): boolean {
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' && message.includes('PerDay');
}

/**
 * Google's 429 carries a RetryInfo with the exact wait it wants. The free
 * tier is a per-minute window, so that value is often ~30s — far longer than
 * any sane exponential ladder, and guessing shorter just burns attempts.
 */
function statedRetryDelayMs(error: unknown): number | null {
  const message = (error as { message?: unknown })?.message;
  if (typeof message !== 'string') return null;
  const match = message.match(/"retryDelay":"(\d+(?:\.\d+)?)s"/);
  return match ? Math.ceil(parseFloat(match[1]) * 1000) : null;
}

/**
 * The free tier rate-limits by requests per minute, and "high demand" 503s are
 * routine, so a burst failure is normal operation rather than a real error.
 * Non-transient errors (bad request, retired model) are rethrown immediately.
 */
async function withBackoff<T>(
  operation: () => Promise<T>,
  attempts = 5
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error)) throw error;
      // A per-day quota will not clear on any timescale worth waiting for, so
      // surface it immediately and let withKeyFailover rotate to another key.
      if (isDailyQuota(error)) throw error;

      lastError = error;
      if (attempt === attempts - 1) break;

      // Honour the server's stated wait when it gives one; otherwise 1s, 2s,
      // 4s... Jitter keeps parallel callers from retrying in lockstep.
      const ladder = 1000 * 2 ** attempt;
      const stated = statedRetryDelayMs(error);
      const delay = Math.max(ladder, stated ?? 0) + Math.random() * 250;
      console.warn(
        `Gemini rate limited, retrying in ${Math.round(delay)}ms ` +
          `(attempt ${attempt + 1}/${attempts})`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Wraps an operation so a per-day quota exhaustion rotates to the next key
 * (on a different project, hence a fresh daily budget) instead of failing.
 * withBackoff still handles per-minute 429s and 503s within a single key; this
 * layer only reacts to per-day exhaustion. Only the active key INDEX is logged,
 * never the key. When every key is exhausted the error finally surfaces.
 */
async function withKeyFailover<T>(operation: () => Promise<T>): Promise<T> {
  const total = getKeys().length;
  let lastError: unknown;

  for (let attempt = 0; attempt < total; attempt++) {
    try {
      return await withBackoff(operation);
    } catch (error) {
      if (!isDailyQuota(error)) throw error;
      lastError = error;
      activeKeyIndex = (activeKeyIndex + 1) % total;
      if (process.env.NODE_ENV !== 'production') {
        console.debug(
          `Gemini key index ${activeKeyIndex} now active ` +
            `(previous hit its per-day quota)`
        );
      }
    }
  }

  throw new Error(
    `All ${total} Gemini key(s) hit their per-day quota; resets midnight Pacific.`,
    { cause: lastError }
  );
}

/**
 * Truncating to 1536 leaves the vector un-normalised, which Google's own
 * guidance says to correct before using it for similarity. Doing it here keeps
 * the stored vectors comparable regardless of which distance operator the
 * `match_memories` RPC ends up using.
 */
function normalise(vector: number[]): number[] {
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0)
  );
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

export class GeminiProvider implements AIProvider {
  private get model(): string {
    return requiredEnv('GEMINI_MODEL');
  }

  async interpret(
    text: string,
    context: InterpretContext
  ): Promise<KandooInterpretation> {
    const system = extractionPrompt(context);

    const first = await this.completeJson(system, [
      { role: 'user', parts: [{ text }] },
    ]);

    const parsed = kandooInterpretationSchema.safeParse(first.value);
    if (parsed.success) return parsed.data;

    /**
     * One repair attempt. Models emit malformed or extra-field JSON a small but
     * non-zero fraction of the time; over a long multi-action utterance that is
     * a real risk. Feeding the validation error back fixes most of them.
     */
    const repaired = await this.completeJson(system, [
      { role: 'user', parts: [{ text }] },
      { role: 'model', parts: [{ text: first.raw }] },
      {
        role: 'user',
        parts: [
          {
            text: [
              'That JSON failed validation with the following errors:',
              JSON.stringify(parsed.error.issues, null, 2),
              '',
              'Return corrected JSON only. No prose, no markdown fences.',
              'Include no fields beyond the specified shape.',
            ].join('\n'),
          },
        ],
      },
    ]);

    const second = kandooInterpretationSchema.safeParse(repaired.value);
    if (second.success) return second.data;

    throw new Error(
      `Interpretation failed validation after repair: ${second.error.message}`
    );
  }

  async writeNote(text: string): Promise<KandooNote> {
    const { value } = await this.completeJson(NOTE_SYSTEM_PROMPT, [
      { role: 'user', parts: [{ text }] },
    ]);
    const parsed = noteSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`Note failed validation: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  private async completeJson(
    system: string,
    contents: { role: string; parts: { text: string }[] }[]
  ): Promise<{ raw: string; value: unknown }> {
    const response = await withKeyFailover(() =>
      activeClient().models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction: system,
          // Strict JSON out of the model, so there is no fence to strip and no
          // prose to trip the parser.
          responseMimeType: 'application/json',
          temperature: 0,
          maxOutputTokens: 2000,
          thinkingConfig: NO_THINKING,
        },
      })
    );

    const raw = response.text;
    if (!raw) {
      throw new Error('Gemini returned an empty interpretation.');
    }

    const cleaned = raw
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();

    try {
      return { raw: cleaned, value: JSON.parse(cleaned) };
    } catch {
      throw new Error('Gemini returned content that was not valid JSON.');
    }
  }

  async generateRecallAnswer(
    question: string,
    memories: RecallMemory[]
  ): Promise<string> {
    const trimmed = question.trim();
    if (!trimmed) {
      throw new Error('Recall question cannot be empty.');
    }

    if (memories.length === 0) {
      return EMPTY_RECALL_ANSWER;
    }

    const response = await withKeyFailover(() =>
      activeClient().models.generateContent({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [{ text: recallUserPrompt(trimmed, memories) }],
          },
        ],
        config: {
          systemInstruction: RECALL_SYSTEM_PROMPT,
          maxOutputTokens: 400,
          thinkingConfig: NO_THINKING,
        },
      })
    );

    const answer = response.text;
    if (!answer) {
      throw new Error('Gemini returned an empty recall answer.');
    }
    return answer.trim();
  }

  async embed(
    texts: string[],
    taskType: EmbedTaskType = 'document'
  ): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await withKeyFailover(() =>
      activeClient().models.embedContent({
        model: EMBEDDING_MODEL,
        contents: texts,
        config: {
          taskType: TASK_TYPES[taskType],
          outputDimensionality: EMBEDDING_DIMENSIONS,
        },
      })
    );

    const embeddings = response.embeddings ?? [];
    if (embeddings.length !== texts.length) {
      throw new Error(
        `Gemini returned ${embeddings.length} embeddings for ${texts.length} inputs.`
      );
    }

    return embeddings.map((embedding, index) => {
      const values = embedding.values;
      if (!values || values.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Gemini embedding ${index} had ${values?.length ?? 0} dimensions, ` +
            `expected ${EMBEDDING_DIMENSIONS}.`
        );
      }
      return normalise(values);
    });
  }
}
