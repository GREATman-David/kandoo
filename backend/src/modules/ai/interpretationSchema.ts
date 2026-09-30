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
    /**
     * Place reminders only: fires on arriving at (default) or leaving the place.
     * Optional so output from before places existed still validates.
     */
    placeTrigger: z.enum(['arrive', 'leave']).default('arrive'),
    /**
     * Place reminders only: the earliest instant it may fire, for "when I get
     * to school TOMORROW" (start of that day, local). Null = any arrival.
     */
    notBefore: isoDateTime.nullable().default(null),
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

/**
 * A cleaned-up written note for a SUBSTANTIAL capture — a recap, several facts,
 * more than a couple of sentences. It reorganises what was said into complete
 * sentences in a professional tone; it never adds anything that was not spoken.
 * Null for short, single-action inputs, which do not warrant a note.
 */
export const noteSchema = z
  .object({
    title: z.string().min(1),
    body: z.string().min(1),
  })
  .strict();

export const kandooInterpretationSchema = z
  .object({
    /** One-line gist of the whole utterance. Shown above the review card. */
    summary: z.string().nullable(),
    confidence: z.enum(['high', 'low']),
    /** Present only for substantial captures; null otherwise. */
    note: noteSchema.nullable().default(null),
    actions: z.array(kandooActionSchema),
  })
  .strict();

/**
 * A photo the user SHOWED Kandoo (a flyer, a business card, a whiteboard):
 * the same contract, plus one line naming what the photo is. That line
 * becomes the capture's text and the photo's caption in its library.
 */
export const photoInterpretationSchema = kandooInterpretationSchema.extend({
  description: z.string().min(1).max(160),
});

/**
 * A photographed page read INTO the Library (Elite, through Mr. Kandoo): notes,
 * a document, slides, a whiteboard. Not actions — one organised note and the
 * category it belongs in. `readable: false` when the photo is not a page with
 * words on it (the other fields are then ignored). Limits match 011_library.sql.
 */
export const documentReadingSchema = z
  .object({
    readable: z.boolean(),
    title: z.string().max(200),
    category: z.string().max(80),
    body: z.string().max(20000),
  })
  .strict();

export type DocumentReading = z.infer<typeof documentReadingSchema>;

export type ReminderAction = z.infer<typeof reminderActionSchema>;
export type MemoryAction = z.infer<typeof memoryActionSchema>;
export type RecallAction = z.infer<typeof recallActionSchema>;
export type KandooAction = z.infer<typeof kandooActionSchema>;
export type KandooNote = z.infer<typeof noteSchema>;
export type KandooInterpretation = z.infer<typeof kandooInterpretationSchema>;
export type PhotoInterpretation = z.infer<typeof photoInterpretationSchema>;

/**
 * The JSON Schema we hand to the model. Kept beside the Zod schema so the two
 * cannot drift. If you edit one, edit the other.
 */
export const KANDOO_JSON_SHAPE = `{
  "summary": string | null,
  "confidence": "high" | "low",
  "note": { "title": string, "body": string } | null,
  "actions": [
    { "kind": "reminder", "task": string, "dueAt": string|null,
      "placeHint": string|null, "placeTrigger": "arrive"|"leave",
      "notBefore": string|null, "people": string[], "insistent": boolean }
    | { "kind": "memory", "content": string, "people": string[],
        "placeHint": string|null, "topics": string[] }
    | { "kind": "recall", "query": string,
        "scopePerson": string|null, "scopePlace": string|null }
  ]
}`;
