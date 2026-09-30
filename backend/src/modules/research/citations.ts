import type { ResearchSource } from './sources';

/**
 * How research findings cite their sources. Pure, so the rules that keep a
 * reference from being invented are tested without a network or database.
 */

/**
 * Keep only citations that point at a real source, renumber them 1..n in order
 * of first use, and return the sources in that order. Uncited sources drop out
 * of the reference list; a citation to a number we never gave is removed.
 */
export function renumberCitations(
  text: string,
  sources: ResearchSource[]
): { text: string; sources: ResearchSource[] } {
  const order: number[] = [];
  const renumbered = text.replace(/\[(\d{1,2})\]/g, (_match, raw: string) => {
    const n = Number(raw);
    if (n < 1 || n > sources.length) return '';
    let at = order.indexOf(n);
    if (at === -1) {
      order.push(n);
      at = order.length - 1;
    }
    return `[${at + 1}]`;
  });
  return {
    text: renumbered.replace(/[ \t]+([.,;:])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim(),
    sources: order.map((n) => sources[n - 1]),
  };
}

/** "[1] Title — Authors, Publisher (Year). https://…" — written by code, not the model. */
export function referencesBlock(sources: ResearchSource[]): string {
  if (sources.length === 0) return '';
  const lines = sources.map((s, i) => {
    const by = [s.authors, s.publisher].filter(Boolean).join(', ');
    return `[${i + 1}] ${s.title}${by ? ` — ${by}` : ''}${s.year ? ` (${s.year})` : ''}. ${s.url}`;
  });
  return `References:\n${lines.join('\n')}`;
}
