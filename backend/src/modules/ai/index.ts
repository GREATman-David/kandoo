import type { AIProvider } from './aiProvider';
import { type AiLink, FallbackAIProvider } from './fallbackProvider';
import { GeminiProvider } from './geminiProvider';
import { MockAIProvider } from './mockProvider';
import { OpenAIProvider } from './openaiProvider';

/**
 * The lighter Gemini model tried when the main one fails. Verified on the
 * acceptance test (B1: 2 memories + 2 reminders, correct times) in ~5 s.
 */
const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

/**
 * Provider selection lives here now. The old `aiProviderFactory.ts` and
 * `interpretationService.ts` are deleted: the factory was one function, and the
 * service was a pass-through that trimmed strings before delegating.
 *
 * The abstraction itself is preserved — swapping providers is still a one-line
 * env change, and nothing downstream knows which one it is talking to.
 */
function createAIProvider(): AIProvider {
  const provider = (process.env.AI_PROVIDER ?? 'openai').toLowerCase();

  switch (provider) {
    case 'mock':
      return new MockAIProvider();
    case 'openai':
      return new FallbackAIProvider([{ name: 'OpenAI', provider: new OpenAIProvider() }]);
    case 'gemini': {
      // The chain: the main Gemini model, then a lighter Gemini model (its own
      // quota and capacity — it kept answering through a 3.x Flash overload),
      // then OpenAI when its key and model are configured. Set
      // GEMINI_FALLBACK_MODEL=none to drop the lighter model.
      const links: AiLink[] = [{ name: 'Gemini', provider: new GeminiProvider() }];
      const lite = process.env.GEMINI_FALLBACK_MODEL ?? DEFAULT_GEMINI_FALLBACK_MODEL;
      if (lite && lite !== 'none' && lite !== process.env.GEMINI_MODEL) {
        links.push({ name: `Gemini (${lite})`, provider: new GeminiProvider(lite) });
      }
      if (process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) {
        links.push({ name: 'OpenAI', provider: new OpenAIProvider() });
      }
      return new FallbackAIProvider(links);
    }
    default:
      throw new Error(
        `Unknown AI_PROVIDER "${provider}". Expected "openai", "gemini" or "mock".`
      );
  }
}

/** Single shared instance. Import this, never the concrete classes. */
export const aiProvider: AIProvider = createAIProvider();

export * from './aiProvider';
export { AiUnavailableError, withDeadline } from './fallbackProvider';
export * from './interpretationSchema';

