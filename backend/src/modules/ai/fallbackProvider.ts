import type { AIProvider, EmbedTaskType, InterpretContext, PhotoInput, RecallMemory } from './aiProvider';
import type { KandooInterpretation, KandooNote, PhotoInterpretation } from './interpretationSchema';

/**
 * Every model we use failed or ran out of time. Routes turn this into a clear
 * "Kandoo's AI is busy" answer (HTTP 503 + code `ai_busy`) — never a hang, and
 * never mistaken by the app for the phone being offline.
 */
export class AiUnavailableError extends Error {
  constructor(message = 'All AI providers are unavailable.') {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

class DeadlineError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} took longer than ${ms} ms.`);
    this.name = 'DeadlineError';
  }
}

/**
 * Resolve with `work`, or reject once `ms` pass. The abandoned promise keeps
 * running, so its eventual rejection is caught and logged here — an unhandled
 * rejection would take the whole server down.
 */
export function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError(label, ms)), ms);
  });
  work.catch((error: unknown) => {
    console.warn(`${label} failed after its deadline or alongside it:`, error);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Time budgets. The app waits 45 s for an AI request (AI_TIMEOUT_MS on the
 * device), so the server must answer — with a result or a clear "busy" — well
 * inside that: every model in the chain, plus the database work around them.
 * The first link gets a short leash (when it is healthy it answers in a few
 * seconds; when it is overloaded, waiting longer only delays the fallback);
 * the rest share what is left, capped per link.
 */
const CHAIN_BUDGET_MS = 36_000;
const FIRST_LINK_MS = 12_000;
const LINK_CAP_MS = 22_000;
/**
 * A model that just failed is skipped for this long, so the next request goes
 * straight to the one that is working instead of spending its budget
 * rediscovering the outage. It is tried again afterwards, and it is never
 * skipped when every model is cooling down.
 */
const COOL_DOWN_MS = 2 * 60_000;
const EMBED_MS = 10_000;

/** One model in the chain, with a name for the logs. */
export type AiLink = { name: string; provider: AIProvider };

/**
 * A chain of models, tried in order. Gemini is first; when it fails — overload
 * (503), quota (429 / per-day), a timeout, or a bad response — the same request
 * goes to the next link: a lighter Gemini model (its own quota and capacity),
 * then OpenAI. Every link uses the same shared prompts and the same Zod
 * contract, so behaviour is the same whichever answers. When every link fails
 * it throws AiUnavailableError — never a hang.
 *
 * Embeddings are NEVER failed over. Vectors from different models are not
 * comparable (AGENTS §4); mixing them would quietly break recall. They stay on
 * the first link, and every embedding caller already copes with a failure.
 *
 * The recall answer degrades one step further: with every model down it is
 * written from the matched memories directly, so a question is still answered.
 */
export class FallbackAIProvider implements AIProvider {
  private readonly failedAt = new Map<string, number>();

  constructor(private readonly links: AiLink[]) {
    if (links.length === 0) throw new Error('FallbackAIProvider needs at least one model.');
  }

  /** Time for the link at `position` in this request's order. */
  private budgetFor(position: number, count: number): number {
    if (count === 1) return LINK_CAP_MS;
    if (position === 0) return FIRST_LINK_MS;
    return Math.min(LINK_CAP_MS, Math.floor((CHAIN_BUDGET_MS - FIRST_LINK_MS) / (count - 1)));
  }

  private coolingDown(link: AiLink): boolean {
    const at = this.failedAt.get(link.name);
    return at !== undefined && Date.now() - at < COOL_DOWN_MS;
  }

  private async run<T>(label: string, call: (provider: AIProvider) => Promise<T>): Promise<T> {
    const ready = this.links.filter((link) => !this.coolingDown(link));
    const order = ready.length > 0 ? ready : this.links;
    for (const [index, link] of order.entries()) {
      try {
        const ms = this.budgetFor(index, order.length);
        const result = await withDeadline(call(link.provider), ms, `${link.name} ${label}`);
        this.failedAt.delete(link.name);
        return result;
      } catch (error) {
        console.error(`${link.name} ${label} failed:`, error);
        this.failedAt.set(link.name, Date.now());
        const next = order[index + 1];
        if (next) console.warn(`Falling back to ${next.name} for ${label}.`);
      }
    }
    throw new AiUnavailableError();
  }

  interpret(text: string, context: InterpretContext): Promise<KandooInterpretation> {
    return this.run('interpret', (p) => p.interpret(text, context));
  }

  writeNote(text: string): Promise<KandooNote> {
    return this.run('note', (p) => p.writeNote(text));
  }

  interpretPhoto(photo: PhotoInput, context: InterpretContext): Promise<PhotoInterpretation> {
    return this.run('photo', (p) => p.interpretPhoto(photo, context));
  }

  async generateRecallAnswer(question: string, memories: RecallMemory[]): Promise<string> {
    try {
      return await this.run('recall answer', (p) => p.generateRecallAnswer(question, memories));
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) throw error;
      return answerFromMatches(memories);
    }
  }

  /**
   * Bounded, so an overloaded embedding model can't hold a save past the
   * app's patience. Every caller already treats failure as "save without a
   * vector" (backfilled later) or "lexical-only recall".
   */
  embed(texts: string[], taskType?: EmbedTaskType): Promise<number[][]> {
    const first = this.links[0];
    return withDeadline(first.provider.embed(texts, taskType), EMBED_MS, `${first.name} embed`);
  }
}

/**
 * A recall answer written without any model: the best matches, as the user
 * said them. Plain, honest and still useful — the question is answered from
 * what Kandoo holds, even while every AI is down.
 */
export function answerFromMatches(memories: RecallMemory[]): string {
  if (memories.length === 0) {
    return 'I couldn’t find anything about that in what you’ve told me.';
  }
  // No times here: the server doesn't know the user's clock, and times are only
  // ever shown in the device's own (AGENTS §3.4). The reminder list has them.
  const lines = memories
    .slice(0, 3)
    .map((m) => (m.source === 'reminder' ? `• ${m.content} (a reminder you set)` : `• ${m.content}`));
  return ['Here’s what you told me that matches:', ...lines].join('\n');
}
