import OpenAI from 'openai';

import {
    KANDOO_JSON_SHAPE,
    kandooInterpretationSchema,
    type KandooInterpretation,
} from './interpretationSchema';

import type {
    AIProvider,
    InterpretContext,
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

function extractionPrompt(context: InterpretContext): string {
  return `
You are Kandoo's extraction engine. You convert ONE utterance into a list of
structured actions. You do not converse and you do not answer the user.

Current local time: ${context.clientTime}
User timezone: ${context.timezone}

Return JSON only, matching exactly this shape:
${KANDOO_JSON_SHAPE}

ACTION KINDS

reminder — something the user must DO later.
memory   — a fact worth keeping.
recall   — the user is ASKING what they previously said.

RULES

1. ONE UTTERANCE MAY CONTAIN MANY ACTIONS. Extract every one of them.
   A meeting recap typically yields SEVERAL reminders AND SEVERAL memories.
   Never stop after the first action you find.
2. dueAt must be a complete ISO 8601 timestamp WITH timezone offset, resolved
   against the current local time above. Never return "4 PM" or "tomorrow".
   Resolve relative times yourself: "in 20 minutes", "tomorrow morning" (09:00),
   "tonight" (20:00), "end of day" (17:00).
3. A reminder tied to a place but not a time: dueAt = null, placeHint set.
   A reminder with neither a time nor a place: dueAt = null, placeHint = null.
4. memory.content must be ONE standalone statement that still makes sense in six
   months. Resolve pronouns to names. Strip filler and hesitation. Never put
   reminder text inside memory content — split them into separate actions.
   Two unrelated facts are two memory actions, not one.
5. insistent = true only for alarms, wake-ups, or explicit urgency.
6. people = names as spoken, one entry each. No titles unless the title is the
   only identifier available ("the doctor").
7. confidence = "low" if a time is ambiguous, a name is unclear, or you are
   unsure how to split the utterance. The user reviews low-confidence output.
8. If nothing actionable was said, return "actions": [].
9. Never invent facts, times, people or places that are not in the utterance.

EXAMPLE

Utterance: "Just came out of the standup. Jed's pushing the API migration to Q1
because of the vendor thing. I need to send Michael the updated spec before 5,
and remind me to book the review room tomorrow morning."

{
  "summary": "Standup recap: API migration slipping, two follow-ups.",
  "confidence": "high",
  "actions": [
    { "kind": "memory",
      "content": "Jed is pushing the API migration to Q1 because of a vendor issue.",
      "people": ["Jed"], "placeHint": null,
      "topics": ["API migration", "vendor"] },
    { "kind": "reminder", "task": "Send Michael the updated spec",
      "dueAt": "2026-09-18T17:00:00+00:00", "placeHint": null,
      "people": ["Michael"], "insistent": false },
    { "kind": "reminder", "task": "Book the review room",
      "dueAt": "2026-09-19T09:00:00+00:00", "placeHint": null,
      "people": [], "insistent": false }
  ]
}
`.trim();
}

function humaniseDate(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'at an unknown time';

  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
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

  private async completeJson(
    messages: OpenAI.Chat.ChatCompletionMessageParam[]
  ): Promise<{ raw: string; value: unknown }> {
    const response = await client().chat.completions.create({
      model: this.model,
      messages,
      response_format: { type: 'json_object' },
      // A 90-second meeting recap produces far more JSON than the old 500-token
      // ceiling allowed. Truncated JSON throws a raw SyntaxError.
      max_completion_tokens: 2000,
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
      return "I don't have anything saved about that yet.";
    }

    const context = memories
      .map((memory, index) =>
        [
          `[${index + 1}] ${memory.content}`,
          `    when: ${humaniseDate(memory.created_at)}`,
          memory.person ? `    who: ${memory.person}` : null,
          memory.location ? `    where: ${memory.location}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      )
      .join('\n\n');

    const response = await client().chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `
You are Kandoo, answering the user about their own saved memories.

Use ONLY the memories provided. Never invent or infer facts that are not there.
If they do not answer the question, say plainly that you do not have it saved.

Speak naturally and briefly, as a person would — two or three sentences.
Mention when something was said if it is relevant ("you mentioned last week...").
Do not list the memories back. Do not cite index numbers.
          `.trim(),
        },
        {
          role: 'user',
          content: `Question:\n${trimmed}\n\nMemories:\n${context}`,
        },
      ],
      max_completion_tokens: 400,
    });

    const answer = response.choices[0]?.message?.content;
    if (!answer) {
      throw new Error('OpenAI returned an empty recall answer.');
    }
    return answer.trim();
  }

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
