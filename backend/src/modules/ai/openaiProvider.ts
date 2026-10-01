import OpenAI from 'openai';

import {
    documentReadingSchema,
    kandooInterpretationSchema,
    noteSchema,
    photoInterpretationSchema,
    type DocumentReading,
    type KandooInterpretation,
    type KandooNote,
    type PhotoInterpretation,
} from './interpretationSchema';

import {
    EMPTY_RECALL_ANSWER,
    NOTE_SYSTEM_PROMPT,
    RECALL_SYSTEM_PROMPT,
    documentReadingPrompt,
    extractionPrompt,
    photoExtractionPrompt,
    recallUserPrompt,
} from './prompts';

import type {
    AIProvider,
    DocumentContext,
    InterpretContext,
    PhotoInput,
    RecallMemory,
} from './aiProvider';

/**
 * No silent fallback model. A missing env var used to fall back to a hardcoded
 * string, which meant a judge cloning the public repo inherited whatever was
 * baked in. Fail loudly at first use instead.
 */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';

/** Dimension of EMBEDDING_MODEL. Must match memories.embedding vector(N). */
export const EMBEDDING_DIMENSIONS = 1536;

let cachedClient: OpenAI | null = null;

function client(): OpenAI {
  if (!cachedClient) {
    cachedClient = new OpenAI({
      apiKey: requiredEnv('OPENAI_API_KEY'),
      timeout: 20_000,
      maxRetries: 2,
    });
  }
  return cachedClient;
}

export class OpenAIProvider implements AIProvider {
  private get model(): string {
    return requiredEnv('OPENAI_MODEL');
  }

  async interpret(
    text: string,
    context: InterpretContext
  ): Promise<KandooInterpretation> {
    const system = extractionPrompt(context);

    const first = await this.completeJson([
      { role: 'system', content: system },
      { role: 'user', content: text },
    ]);

    const parsed = kandooInterpretationSchema.safeParse(first.value);
    if (parsed.success) return parsed.data;

    /**
     * One repair attempt. Models emit malformed or extra-field JSON a small but
     * non-zero fraction of the time; over a long multi-action utterance that is
     * a real risk. Feeding the validation error back fixes most of them.
     */
    const repaired = await this.completeJson([
      { role: 'system', content: system },
      { role: 'user', content: text },
      { role: 'assistant', content: first.raw },
      {
        role: 'user',
        content: [
          'That JSON failed validation with the following errors:',
          JSON.stringify(parsed.error.issues, null, 2),
          '',
          'Return corrected JSON only. No prose, no markdown fences.',
          'Include no fields beyond the specified shape.',
        ].join('\n'),
      },
    ]);

    const second = kandooInterpretationSchema.safeParse(repaired.value);
    if (second.success) return second.data;

    throw new Error(
      `Interpretation failed validation after repair: ${second.error.message}`
    );
  }

  /** The same photo contract, through OpenAI's vision input (a data URL). */
  async interpretPhoto(
    photo: PhotoInput,
    context: InterpretContext
  ): Promise<PhotoInterpretation> {
    const { value } = await this.completeJson([
      { role: 'system', content: photoExtractionPrompt(context) },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${photo.mimeType};base64,${photo.base64}` } },
          { type: 'text', text: photo.caption ? `Caption: ${photo.caption}` : 'No caption.' },
        ],
      },
    ]);
    const parsed = photoInterpretationSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`Photo interpretation failed validation: ${parsed.error.message}`);
    }
    return { ...parsed.data, actions: parsed.data.actions.filter((a) => a.kind !== 'recall') };
  }

  /** A photographed page → one Library note, through OpenAI's vision input. */
  async readDocument(photo: PhotoInput, context: DocumentContext): Promise<DocumentReading> {
    const { value } = await this.completeJson(
      [
        { role: 'system', content: documentReadingPrompt(context, context.categories, context.categoryHint) },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${photo.mimeType};base64,${photo.base64}` } },
            { type: 'text', text: photo.caption ? `The user said: ${photo.caption}` : 'Read this page.' },
          ],
        },
      ],
      4000
    );
    const parsed = documentReadingSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`Document reading failed validation: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  /** Chat completions can't read a PDF inline; the fallback chain moves on. */
  async extractFileText(_file: { base64: string; mimeType: string }): Promise<string> {
    throw new Error('OpenAI file transcription is not set up.');
  }

  async generateJson(system: string, user: string, maxOutputTokens: number): Promise<unknown> {
    const { value } = await this.completeJson(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxOutputTokens
    );
    return value;
  }

  async writeNote(text: string): Promise<KandooNote> {
    const { value } = await this.completeJson([
      { role: 'system', content: NOTE_SYSTEM_PROMPT },
      { role: 'user', content: text },
    ]);
    const parsed = noteSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`Note failed validation: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  private async completeJson(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    maxTokens = 2000
  ): Promise<{ raw: string; value: unknown }> {
    const response = await client().chat.completions.create({
      model: this.model,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0,
      // A 90-second meeting recap produces far more JSON than the old 500-token
      // ceiling allowed. Truncated JSON throws a raw SyntaxError.
      max_completion_tokens: maxTokens,
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) {
      throw new Error('OpenAI returned an empty interpretation.');
    }

    const cleaned = raw
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();

    try {
      return { raw: cleaned, value: JSON.parse(cleaned) };
    } catch {
      throw new Error('OpenAI returned content that was not valid JSON.');
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

    const response = await client().chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: RECALL_SYSTEM_PROMPT },
        { role: 'user', content: recallUserPrompt(trimmed, memories) },
      ],
      max_completion_tokens: 400,
    });

    const answer = response.choices[0]?.message?.content;
    if (!answer) {
      throw new Error('OpenAI returned an empty recall answer.');
    }
    return answer.trim();
  }

  /** `taskType` is ignored: OpenAI's embeddings are symmetric. */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await client().embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
    });

    return response.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding as number[]);
  }
}
