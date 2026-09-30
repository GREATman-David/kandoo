/**
 * "Where am I?" — answered on the phone from GPS and the user's drawn places,
 * never sent to the server (where you are is a device fact, AGENTS §3.2/§3.5).
 * The words live here as pure functions (tested in whereAmIText.test.ts); the
 * GPS and place lookups are in whereAmI.ts.
 */

export type WhereQuestion =
  | { kind: 'where' }
  /** "Am I at school?" — about one named place. */
  | { kind: 'at'; place: string };

const WHERE_PATTERNS = [
  /\bwhere am i\b/,
  /\bwhere are we\b/,
  /\bwhat place is this\b/,
  /\bwhere is this\b/,
  /\bwhat(?:'s| is) (?:here|this place)\b/,
  /\bmy (?:current )?location\b/,
];
const AT_PATTERN = /\bam i (?:at|in|near|inside) (?:the |my )?([a-z0-9' -]{2,40}?)\s*\??$/;

/** Is this a question about where the user is right now? */
export function parseWhereQuestion(text: string): WhereQuestion | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, '');
  const at = AT_PATTERN.exec(t);
  if (at) return { kind: 'at', place: at[1].trim() };
  return WHERE_PATTERNS.some((p) => p.test(t)) ? { kind: 'where' } : null;
}

export type HerePlace = {
  name: string;
  waitingCount: number;
  latestMemory: string | null;
};

export type WhereFacts = {
  /** Places the user is inside, most specific (smallest) first. */
  inside: HerePlace[];
  /** Nearest drawn place when inside none. */
  nearest: { name: string; distanceM: number } | null;
  /** "East Legon, Accra" — from the phone's geocoder, when it answers. */
  area: string | null;
};

/** "about 300 m", "about 1.2 km". */
export function formatDistance(m: number): string {
  if (m < 1000) return `about ${Math.max(50, Math.round(m / 50) * 50)} m`;
  return `about ${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

function sentence(line: string): string {
  const t = line.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** Beyond this, the nearest of the user's places isn't worth mentioning. */
export const NEAREST_MAX_M = 50_000;

export function composeWhereAnswer(question: WhereQuestion, facts: WhereFacts): string {
  const [here, ...around] = facts.inside;

  if (question.kind === 'at') {
    const wanted = question.place.toLowerCase();
    const match = facts.inside.find((p) => p.name.toLowerCase() === wanted);
    if (match) return `Yes — you're at ${match.name}.`;
    if (here) return `No — you're at ${here.name}, not ${question.place}.`;
    return facts.area
      ? `No — you're around ${facts.area}, not at ${question.place}.`
      : `No, you're not at ${question.place} right now.`;
  }

  if (!here) {
    const where = facts.area ? `You're around ${facts.area}` : 'You’re not at any of your places';
    // "School is 11,293 km away" is noise: only a place within reach is worth naming.
    const nearest = facts.nearest && facts.nearest.distanceM <= NEAREST_MAX_M ? facts.nearest : null;
    const tail = nearest
      ? `${facts.area ? ' — not at any of your places. ' : '. '}${nearest.name} is ${formatDistance(nearest.distanceM)} away.`
      : '.';
    return `${where}${tail}`;
  }

  const parts = [
    around.length > 0 ? `You're at ${here.name}, inside ${around.map((p) => p.name).join(' and ')}.` : `You're at ${here.name}.`,
  ];
  if (here.waitingCount > 0) {
    parts.push(`${here.waitingCount} ${here.waitingCount === 1 ? 'thing is' : 'things are'} waiting for you here.`);
  }
  if (here.latestMemory) parts.push(`Last time: ${sentence(here.latestMemory)}`);
  return parts.join(' ');
}
