import type { AIProvider } from './aiProvider';
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
      return new OpenAIProvider();
    default:
      throw new Error(
        `Unknown AI_PROVIDER "${provider}". Expected "openai" or "mock".`
      );
  }
}

/** Single shared instance. Import this, never the concrete classes. */
export const aiProvider: AIProvider = createAIProvider();

export * from './aiProvider';
export * from './interpretationSchema';

