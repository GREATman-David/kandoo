import { z } from 'zod';

/**
 * Kandoo interpretation contract (v2).
 *
 * The old schema allowed exactly one intent, one task, one person and one time
 * per utterance. That made the flagship use case — "I just came out of a
 * meeting..." followed by 90 seconds of speech containing several tasks and
 * several facts — impossible to represent.
 *
 * v2 returns a LIST of actions. One utterance, N actions.
 */

const isoDateTime = z.string().datetime({ offset: true });

export const reminderActionSchema = z
  .object({
    kind: z.literal('reminder'),
    /** What the user must do. Imperative, short. */
    task: z.string().min(1),
    /**
     * Absolute instant, resolved by the model against the user's local time.
     * Null when the reminder is anchored to a place rather than a time.
     */
    dueAt: isoDateTime.nullable(),
    /** Raw place phrase as spoken, e.g. "the engineering department". */
    placeHint: z.string().nullable(),
    people: z.array(z.string()).default([]),
    /** True only for alarms / wake-ups / explicit urgency. */
    insistent: z.boolean().default(false),
  })
  .strict();

export const memoryActionSchema = z
  .object({
    kind: z.literal('memory'),
    /**
     * ONE standalone statement that still makes sense in six months.
     * Pronouns resolved, filler stripped.
     */
    content: z.string().min(1),
    people: z.array(z.string()).default([]),
    placeHint: z.string().nullable(),
    topics: z.array(z.string()).default([]),
  })
  .strict();

export const recallActionSchema = z
  .object({
    kind: z.literal('recall'),
    /** Search intent, not the raw question. */
    query: z.string().min(1),
    scopePerson: z.string().nullable(),
    scopePlace: z.string().nullable(),
  })
  .strict();

export const kandooActionSchema = z.discriminatedUnion('kind', [
  reminderActionSchema,
  memoryActionSchema,
  recallActionSchema,
]);

export const kandooInterpretationSchema = z
  .object({
    /** One-line gist of the whole utterance. Shown above the review card. */
    summary: z.string().nullable(),
    confidence: z.enum(['high', 'low']),
    actions: z.array(kandooActionSchema),
  })
  .strict();

export type ReminderAction = z.infer<typeof reminderActionSchema>;
export type MemoryAction = z.infer<typeof memoryActionSchema>;
export type RecallAction = z.infer<typeof recallActionSchema>;
export type KandooAction = z.infer<typeof kandooActionSchema>;
export type KandooInterpretation = z.infer<typeof kandooInterpretationSchema>;

/**
 * The JSON Schema we hand to the model. Kept beside the Zod schema so the two
 * cannot drift. If you edit one, edit the other.
 */
export const KANDOO_JSON_SHAPE = `{
  "summary": string | null,
  "confidence": "high" | "low",
  "actions": [
    { "kind": "reminder", "task": string, "dueAt": string|null,
      "placeHint": string|null, "people": string[], "insistent": boolean }
    | { "kind": "memory", "content": string, "people": string[],
        "placeHint": string|null, "topics": string[] }
    | { "kind": "recall", "query": string,
        "scopePerson": string|null, "scopePlace": string|null }
  ]
}`;
