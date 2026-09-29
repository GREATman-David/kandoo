import type { AIProvider, EmbedTaskType, InterpretContext, RecallMemory } from './aiProvider';
import type { KandooInterpretation, KandooNote } from './interpretationSchema';

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
 * inside that: primary + backup + the database work around them.
 */
const PRIMARY_MS_WITH_BACKUP = 15_000;
const PRIMARY_MS_ALONE = 22_000;
const BACKUP_MS = 18_000;
const EMBED_MS = 10_000;

/**
 * One AI in front of another. Gemini is the primary; when it fails — overload
 * (503), quota (429 / per-day), a timeout, or a bad response — the same request
 * goes to the backup (OpenAI) with the same shared prompts, so behaviour is the
 * same whichever answers. With no backup configured it still enforces the time
 * budget and fails with AiUnavailableError instead of hanging.
 *
 * Embeddings are NEVER failed over. Vectors from different providers are not
 * comparable (AGENTS §4); mixing them would quietly break recall. They stay on
 * the primary, and every embedding caller already copes with a failure.
 *
 * The recall answer degrades one step further: with both models down it is
 * written from the matched memories directly, so a question is still answered.
 */
export class FallbackAIProvider implements AIProvider {
  constructor(
    private readonly primary: AIProvider,
    private readonly backup: AIProvider | null,
    private readonly names: { primary: string; backup: string | null }
  ) {}

  private async run<T>(label: string, call: (provider: AIProvider) => Promise<T>): Promise<T> {
    const primaryMs = this.backup ? PRIMARY_MS_WITH_BACKUP : PRIMARY_MS_ALONE;
    try {
      return await withDeadline(call(this.primary), primaryMs, `${this.names.primary} ${label}`);
    } catch (primaryError) {
      console.error(`${this.names.primary} ${label} failed:`, primaryError);
      if (!this.backup) throw new AiUnavailableError();
      console.warn(`Falling back to ${this.names.backup} for ${label}.`);
      try {
        return await withDeadline(call(this.backup), BACKUP_MS, `${this.names.backup} ${label}`);
      } catch (backupError) {
        console.error(`${this.names.backup} ${label} failed too:`, backupError);
        throw new AiUnavailableError();
      }
    }
  }

  interpret(text: string, context: InterpretContext): Promise<KandooInterpretation> {
    return this.run('interpret', (p) => p.interpret(text, context));
  }

  writeNote(text: string): Promise<KandooNote> {
    return this.run('note', (p) => p.writeNote(text));
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
    return withDeadline(this.primary.embed(texts, taskType), EMBED_MS, `${this.names.primary} embed`);
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
