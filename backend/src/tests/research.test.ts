import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { referencesBlock, renumberCitations } from '../modules/research/citations';
import { rebuildAbstract, type ResearchSource } from '../modules/research/sources';

/** Mr. Kandoo's research: no reference can be invented, and every link is real. */

const source = (title: string, url: string, extra: Partial<ResearchSource> = {}): ResearchSource => ({
  title,
  url,
  publisher: null,
  authors: null,
  year: null,
  excerpt: '',
  kind: 'encyclopedia',
  ...extra,
});

const S = [
  source('Churn', 'https://en.wikipedia.org/wiki/Churn_rate', { publisher: 'Wikipedia' }),
  source('Freemium', 'https://en.wikipedia.org/wiki/Freemium', { publisher: 'Wikipedia' }),
  source('Why people subscribe', 'https://doi.org/10.1111/isj.12262', {
    kind: 'paper',
    authors: 'A. Author et al.',
    publisher: 'Information Systems Journal',
    year: 2019,
  }),
];

describe('citations', () => {
  it('renumbers in order of first use and lists only the sources cited', () => {
    const out = renumberCitations('Annual plans cut churn [3]. Trials help [1][3].', S);
    assert.equal(out.text, 'Annual plans cut churn [1]. Trials help [2][1].');
    assert.deepEqual(out.sources.map((s) => s.title), ['Why people subscribe', 'Churn']);
  });

  it('drops a citation to a source that was never fetched', () => {
    const out = renumberCitations('A claim [7]. Another [2].', S);
    assert.equal(out.text, 'A claim. Another [1].');
    assert.deepEqual(out.sources.map((s) => s.title), ['Freemium']);
  });

  it('writes the reference list from the sources, with their real links', () => {
    const block = referencesBlock([S[2], S[0]]);
    assert.equal(
      block,
      'References:\n' +
        '[1] Why people subscribe — A. Author et al., Information Systems Journal (2019). https://doi.org/10.1111/isj.12262\n' +
        '[2] Churn — Wikipedia. https://en.wikipedia.org/wiki/Churn_rate'
    );
    assert.equal(referencesBlock([]), '');
  });
});

describe('OpenAlex abstracts', () => {
  it('puts an inverted-index abstract back in word order', () => {
    assert.equal(rebuildAbstract({ subscriptions: [1], Annual: [0], reduce: [2], churn: [3] }), 'Annual subscriptions reduce churn');
    assert.equal(rebuildAbstract(null), '');
  });
});
