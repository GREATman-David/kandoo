import type { NextFunction, Request, Response } from 'express';

import type { AuthenticatedRequest } from './authenticateRequest';

/**
 * Per-user limits on the routes that spend model or embedding quota. The repo
 * and the API URL are public; without this, one account (or one runaway
 * client loop) could exhaust the shared Gemini free tier — ~1000 embeddings a
 * day — and take every other user down with it.
 *
 * In-memory is deliberate: the backend runs as a single instance, and a limit
 * that resets on redeploy errs on the side of letting people in. Must run
 * AFTER authenticateRequest, since it keys on the verified user id.
 */

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Generous for a person, tight for a loop. */
const PER_MINUTE = 12;
const PER_DAY = 250;

const hits = new Map<string, number[]>();

export function aiRateLimit(req: Request, res: Response, next: NextFunction) {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) return next();

  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((at) => now - at < DAY_MS);
  const lastMinute = recent.filter((at) => now - at < MINUTE_MS).length;

  if (lastMinute >= PER_MINUTE || recent.length >= PER_DAY) {
    hits.set(userId, recent);
    const retryAfterS = lastMinute >= PER_MINUTE ? 60 : 60 * 60;
    res.setHeader('Retry-After', String(retryAfterS));
    return res.status(429).json({
      error:
        lastMinute >= PER_MINUTE
          ? 'That’s a lot at once — give Kandoo a minute, then try again.'
          : 'You’ve reached today’s limit. Kandoo will be ready again tomorrow.',
    });
  }

  recent.push(now);
  hits.set(userId, recent);
  next();
}

/** Longest single capture Kandoo will interpret: a few minutes of speech. */
export const MAX_CAPTURE_CHARS = 4000;
