/**
 * Where Mr. Kandoo's research comes from: public, keyless sources whose links
 * are real — Wikipedia for background and OpenAlex (an open index of ~250M
 * scholarly works) for professional references. Only the planner's GENERAL
 * topic queries are sent (never the user's notes or names).
 *
 * Each fetch is bounded and best-effort: a source that is down or slow is
 * logged and skipped, and research carries on with the others.
 */

export type ResearchSource = {
  title: string;
  url: string;
  /** "Wikipedia", or the journal / publisher for a paper. */
  publisher: string | null;
  authors: string | null;
  year: number | null;
  /** What the writer reads: an intro or an abstract, trimmed. */
  excerpt: string;
  kind: 'encyclopedia' | 'paper';
};

const USER_AGENT = 'Kandoo/1.0 (personal memory assistant; research feature)';
const FETCH_TIMEOUT_MS = 8_000;
const MAX_EXCERPT = 1200;

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function trim(text: string, max = MAX_EXCERPT): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

type WikiPage = { title?: string; extract?: string; fullurl?: string; index?: number };

/** The top articles for a query, with their plain-text introductions. */
export async function searchWikipedia(query: string, limit = 2): Promise<ResearchSource[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: String(limit),
    prop: 'extracts|info',
    exintro: '1',
    explaintext: '1',
    inprop: 'url',
    format: 'json',
    formatversion: '2',
  });
  try {
    const data = (await getJson(`https://en.wikipedia.org/w/api.php?${params}`)) as {
      query?: { pages?: WikiPage[] };
    };
    return (data.query?.pages ?? [])
      .filter((p) => p.title && p.fullurl && p.extract && p.extract.length > 80)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((p) => ({
        title: p.title as string,
        url: p.fullurl as string,
        publisher: 'Wikipedia',
        authors: null,
        year: null,
        excerpt: trim(p.extract as string),
        kind: 'encyclopedia' as const,
      }));
  } catch (error) {
    console.error('Wikipedia search failed:', error instanceof Error ? error.message : error);
    return [];
  }
}

type OpenAlexWork = {
  title?: string | null;
  doi?: string | null;
  id?: string;
  publication_year?: number | null;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string } | null; landing_page_url?: string | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
};

/** OpenAlex stores abstracts as word → positions; put the words back in order. */
export function rebuildAbstract(index: Record<string, number[]> | null | undefined): string {
  if (!index) return '';
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const at of positions) words[at] = word;
  }
  return words.filter(Boolean).join(' ');
}

function authorLine(work: OpenAlexWork): string | null {
  const names = (work.authorships ?? [])
    .map((a) => a.author?.display_name)
    .filter((n): n is string => Boolean(n));
  if (names.length === 0) return null;
  return names.length > 2 ? `${names[0]} et al.` : names.join(' & ');
}

/** Well-cited papers with an abstract, for a query. */
export async function searchOpenAlex(query: string, limit = 3): Promise<ResearchSource[]> {
  const params = new URLSearchParams({
    search: query,
    per_page: String(limit * 2),
    filter: 'has_abstract:true',
    sort: 'relevance_score:desc',
    select: 'id,doi,title,publication_year,authorships,primary_location,abstract_inverted_index',
  });
  try {
    const data = (await getJson(`https://api.openalex.org/works?${params}`)) as { results?: OpenAlexWork[] };
    return (data.results ?? [])
      .map((work) => ({ work, abstract: rebuildAbstract(work.abstract_inverted_index) }))
      .filter(({ work, abstract }) => work.title && abstract.length > 120)
      .slice(0, limit)
      .map(({ work, abstract }) => ({
        title: work.title as string,
        url: work.doi ?? work.primary_location?.landing_page_url ?? work.id ?? '',
        publisher: work.primary_location?.source?.display_name ?? null,
        authors: authorLine(work),
        year: work.publication_year ?? null,
        excerpt: trim(abstract),
        kind: 'paper' as const,
      }))
      .filter((s) => s.url);
  } catch (error) {
    console.error('OpenAlex search failed:', error instanceof Error ? error.message : error);
    return [];
  }
}
