import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AIProvider, RecallMemory } from '../modules/ai/aiProvider';
import {
  AiUnavailableError,
  FallbackAIProvider,
  answerFromMatches,
  withDeadline,
} from '../modules/ai/fallbackProvider';
import type { KandooInterpretation } from '../modules/ai/interpretationSchema';
import { isLikelyQuestion } from '../utils/question';

/**
 * The AI-outage safety net. No network: stub providers stand in for Gemini and
 * OpenAI, and failures are immediate so nothing waits on a real time budget.
 */

const OK: KandooInterpretation = { summary: 'ok', confidence: 'high', note: null, actions: [] };

function stub(overrides: Partial<AIProvider>): AIProvider {
  const fail = () => Promise.reject(new Error('503 high demand'));
  return {
    interpret: fail,
    interpretPhoto: fail,
    readDocument: fail,
    generateJson: fail,
    extractFileText: fail,
    writeNote: fail,
    generateRecallAnswer: fail,
    embed: fail,
    ...overrides,
  };
}


describe('FallbackAIProvider', () => {
  it('fails a document reading over to the next model too', async () => {
    const reading = { readable: true, title: 'Lecture 4', category: 'Biology Notes', body: 'Cells.' };
    const provider = new FallbackAIProvider([
      { name: 'Primary', provider: stub({}) },
      { name: 'Backup', provider: stub({ readDocument: async () => reading }) },
    ]);
    const result = await provider.readDocument(
      { base64: '', mimeType: 'image/jpeg', caption: null },
      { clientTime: '', timezone: 'UTC', categories: [], categoryHint: null }
    );
    assert.equal(result.category, 'Biology Notes');
  });

  it('fails a photo over to the next model too', async () => {
    const photo = { ...OK, description: 'A flyer' };
    const provider = new FallbackAIProvider([
      { name: 'Primary', provider: stub({}) },
      { name: 'Backup', provider: stub({ interpretPhoto: async () => photo }) },
    ]);
    const result = await provider.interpretPhoto(
      { base64: '', mimeType: 'image/jpeg', caption: null },
      { clientTime: '', timezone: 'UTC' }
    );
    assert.equal(result.description, 'A flyer');
  });

  it('uses the primary when it answers', async () => {
    const provider = new FallbackAIProvider([
      { name: 'Primary', provider: stub({ interpret: async () => ({ ...OK, summary: 'primary' }) }) },
      { name: 'Backup', provider: stub({ interpret: async () => ({ ...OK, summary: 'backup' }) }) },
    ]);
    const result = await provider.interpret('hi', { clientTime: '', timezone: 'UTC' });
    assert.equal(result.summary, 'primary');
  });

  it('falls back to the backup when the primary fails', async () => {
    const provider = new FallbackAIProvider([
      { name: 'Primary', provider: stub({}) },
      { name: 'Backup', provider: stub({ interpret: async () => ({ ...OK, summary: 'backup' }) }) },
    ]);
    const result = await provider.interpret('hi', { clientTime: '', timezone: 'UTC' });
    assert.equal(result.summary, 'backup');
  });

  it('walks the whole chain: main model, lighter model, then OpenAI', async () => {
    const provider = new FallbackAIProvider([
      { name: 'Gemini', provider: stub({}) },
      { name: 'Gemini lite', provider: stub({}) },
      { name: 'OpenAI', provider: stub({ interpret: async () => ({ ...OK, summary: 'third' }) }) },
    ]);
    const result = await provider.interpret('hi', { clientTime: '', timezone: 'UTC' });
    assert.equal(result.summary, 'third');
  });

  it('reports AiUnavailableError when every provider fails', async () => {
    const provider = new FallbackAIProvider([
      { name: 'Primary', provider: stub({}) },
      { name: 'Backup', provider: stub({}) },
    ]);
    await assert.rejects(
      provider.interpret('hi', { clientTime: '', timezone: 'UTC' }),
      AiUnavailableError
    );
  });

  it('reports AiUnavailableError with a single model', async () => {
    const provider = new FallbackAIProvider([{ name: 'Primary', provider: stub({}) }]);
    await assert.rejects(provider.writeNote('text'), AiUnavailableError);
  });

  it('still answers a recall question from the matches when every model is down', async () => {
    const provider = new FallbackAIProvider([
      { name: 'Primary', provider: stub({}) },
      { name: 'Backup', provider: stub({}) },
    ]);
    const memories: RecallMemory[] = [
      { id: '1', source: 'memory', content: 'Ada’s pottery class moved to Saturday.', person: 'Ada', location: null, due_at: null, created_at: '' },
    ];
    const answer = await provider.generateRecallAnswer('When is pottery?', memories);
    assert.match(answer, /pottery class moved to Saturday/);
  });

  it('never fails embeddings over to the backup (vectors must not mix)', async () => {
    let backupEmbedded = false;
    const provider = new FallbackAIProvider([
      { name: 'Primary', provider: stub({}) },
      {
        name: 'Backup',
        provider: stub({
          embed: async () => {
            backupEmbedded = true;
            return [[1]];
          },
        }),
      },
    ]);
    await assert.rejects(provider.embed(['x'], 'document'));
    assert.equal(backupEmbedded, false);
  });
});

describe('degraded answers', () => {
  it('answerFromMatches lists the best matches and adds no times', () => {
    const text = answerFromMatches([
      { id: 'r', source: 'reminder', content: 'Call Mummy', person: null, location: null, due_at: '2026-09-30T17:00:00Z', created_at: '' },
    ]);
    assert.match(text, /Call Mummy \(a reminder you set\)/);
    assert.doesNotMatch(text, /17:00|UTC/);
  });

  it('answerFromMatches says so when nothing matches', () => {
    assert.match(answerFromMatches([]), /couldn’t find anything/);
  });

  it('withDeadline rejects slow work and resolves fast work', async () => {
    await assert.rejects(withDeadline(new Promise(() => {}), 20, 'slow'), /longer than 20 ms/);
    assert.equal(await withDeadline(Promise.resolve(7), 1000, 'fast'), 7);
  });

  it('isLikelyQuestion tells questions from things to remember', () => {
    assert.equal(isLikelyQuestion('When is Ada’s pottery class?'), true);
    assert.equal(isLikelyQuestion('what did Jed say'), true);
    assert.equal(isLikelyQuestion('Buy tomatoes on the way home'), false);
  });
});
