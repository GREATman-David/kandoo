import type { AIProvider } from './aiProvider';
import { FallbackAIProvider } from './fallbackProvider';
import { GeminiProvider } from './geminiProvider';
import { MockAIProvider } from './mockProvider';
import { OpenAIProvider } from './openaiProvider';

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
      return new FallbackAIProvider(new OpenAIProvider(), null, {
        primary: 'OpenAI',
        backup: null,
      });
    case 'gemini': {
      // OpenAI backs Gemini up for understanding and answers (never for
      // embeddings) when both its key and model are configured.
      const hasBackup = !!process.env.OPENAI_API_KEY && !!process.env.OPENAI_MODEL;
      return new FallbackAIProvider(new GeminiProvider(), hasBackup ? new OpenAIProvider() : null, {
        primary: 'Gemini',
        backup: hasBackup ? 'OpenAI' : null,
      });
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

