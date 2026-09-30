import { Router } from 'express';

import {
  authenticateRequest,
  type AuthenticatedRequest,
} from '../middleware/authenticateRequest';
import { aiRateLimit } from '../middleware/rateLimit';
import { getUserTier, type Tier } from '../modules/entitlements/entitlementService';
import { recallMemories } from '../modules/memories/recallService';

/**
 * Kandoo Agent (Pro) and Kandoo's voice.
 *
 * The agent itself runs in ElevenLabs and ACTS through client tools inside the
 * app — the same code the buttons call (AGENTS §3.1: the model decides, the
 * app's own logic acts). The backend only:
 *   - issues a short-lived conversation token, to Pro users only, so the agent
 *     is private and the ElevenLabs key never leaves this server;
 *   - searches memories for the agent (the hybrid recall, without a capture);
 *   - speaks text in Kandoo's voice, so paid answers sound like the agent.
 *
 * Who gets what (each Agent minute has a real cost, so allowances are enforced
 * here, not in the app): Free — no Agent, phone voice; Pro — Kandoo's voice and
 * a 5-minute Agent taste each month; Elite — 45 Agent minutes a month. Minutes
 * are counted from ElevenLabs' own conversation records for this user, so no
 * database table is needed.
 *
 * Env: ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, KANDOO_VOICE_ID.
 */

const router = Router();

const ELEVENLABS = 'https://api.elevenlabs.io/v1';
/**
 * Kandoo's voice. George (a built-in ElevenLabs voice) for now: Nathaniel
 * (Wq15xSaY3gWvazBRaGEU) is a library voice, which the free plan can't use over
 * the API. To switch back on a paid plan, set KANDOO_VOICE_ID and give the
 * ElevenLabs agent the same voice — no app release needed.
 */
const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
const MAX_SPEAK_CHARS = 600;
const TIMEOUT_MS = 15_000;

/** Agent seconds included each calendar month (UTC), by tier. */
const AGENT_ALLOWANCE_SECS: Record<Tier, number> = { free: 0, pro: 5 * 60, elite: 45 * 60 };

function monthStartUnix(now = new Date()): number {
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
}

/**
 * Agent seconds this user has used this month, from ElevenLabs' conversation
 * list (the app starts every session with the Supabase user id). Null when it
 * can't be read — the caller decides what that means.
 */
async function agentSecondsThisMonth(userId: string, apiKey: string, agentId: string): Promise<number | null> {
  let total = 0;
  let cursor: string | null = null;
  try {
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({
        agent_id: agentId,
        user_id: userId,
        call_start_after_unix: String(monthStartUnix()),
        page_size: '100',
      });
      if (cursor) query.set('cursor', cursor);
      const response = await elevenlabs(`/convai/conversations?${query}`, { headers: { 'xi-api-key': apiKey } });
      if (!response.ok) {
        console.error('ElevenLabs conversation list failed:', response.status);
        return null;
      }
      const body = (await response.json()) as {
        conversations?: { call_duration_secs?: number }[];
        has_more?: boolean;
        next_cursor?: string | null;
      };
      for (const c of body.conversations ?? []) total += c.call_duration_secs ?? 0;
      if (!body.has_more || !body.next_cursor) break;
      cursor = body.next_cursor;
    }
    return total;
  } catch (error) {
    console.error('Counting Agent minutes failed:', error);
    return null;
  }
}

function config() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  return { apiKey, agentId, voiceId: process.env.KANDOO_VOICE_ID || DEFAULT_VOICE_ID };
}

async function elevenlabs(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${ELEVENLABS}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A conversation token for the private Kandoo agent — only for a paid tier with
 * minutes left this month, checked here. Returns what is left so the app can
 * show it.
 */
router.get('/agent/session', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const { apiKey, agentId } = config();
  if (!apiKey || !agentId) {
    console.error('Kandoo Agent is not configured (ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID).');
    return res.status(503).json({ error: 'Kandoo Agent is not available right now.' });
  }
  const tier = await getUserTier(userId, { fresh: req.query.fresh === '1' });
  const allowance = AGENT_ALLOWANCE_SECS[tier];
  if (allowance === 0) {
    return res.status(402).json({ code: 'elite_required', error: 'Talking with Kandoo is part of Kandoo Elite.' });
  }

  // If the count can't be read, a paid user still gets to talk — each call is
  // capped at a few minutes by the agent itself, so the exposure is bounded.
  const used = (await agentSecondsThisMonth(userId, apiKey, agentId)) ?? 0;
  const remaining = Math.max(0, allowance - used);
  if (remaining < 15) {
    return res.status(402).json({
      code: 'agent_minutes_used',
      tier,
      error:
        tier === 'elite'
          ? 'You’ve used this month’s Kandoo Agent minutes. They renew on the 1st.'
          : 'You’ve used your Kandoo Agent minutes for this month. Kandoo Elite includes 45 a month.',
    });
  }

  try {
    const response = await elevenlabs(
      `/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { 'xi-api-key': apiKey } }
    );
    if (!response.ok) {
      console.error('ElevenLabs conversation token failed:', response.status);
      return res.status(502).json({ error: 'Kandoo Agent is busy right now. Please try again.' });
    }
    const body = (await response.json()) as { token?: string };
    if (!body.token) throw new Error('No token in the ElevenLabs response');
    return res.json({ success: true, token: body.token, tier, remainingSeconds: remaining, allowanceSeconds: allowance });
  } catch (error) {
    console.error('Agent session failed:', error);
    return res.status(502).json({ error: 'Kandoo Agent is busy right now. Please try again.' });
  }
});

/** The agent's memory search: the same hybrid recall, returning the matches. */
router.post('/agent/search', authenticateRequest, aiRateLimit, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const query = typeof req.body?.query === 'string' ? req.body.query.trim().slice(0, 300) : '';
  if (!query) return res.status(400).json({ error: 'What should I look for?' });
  try {
    const matches = await recallMemories(userId, { kind: 'recall', query, scopePerson: null, scopePlace: null }, 8);
    return res.json({
      success: true,
      matches: matches.map((m) => ({
        id: m.id,
        kind: m.source === 'reminder' ? 'reminder' : 'memory',
        content: m.content,
        person: m.person ?? null,
        place: m.location ?? null,
        dueAt: m.due_at ?? null,
        savedAt: m.created_at,
      })),
    });
  } catch (error) {
    console.error('Agent search failed:', error);
    return res.status(500).json({ error: 'Could not search your memories just now.' });
  }
});

/**
 * Kandoo's voice for spoken answers (Pro and Elite), as MP3. The app falls back
 * to the phone's own voice if this fails, so it is never load-bearing.
 */
router.post('/speak', authenticateRequest, aiRateLimit, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const { apiKey, voiceId } = config();
  // Kandoo's own voice costs per character: it is a Pro benefit. Free answers
  // are spoken by the phone's voice, which is free.
  if ((await getUserTier(userId)) === 'free') {
    return res.status(402).json({ code: 'pro_required', error: 'Kandoo’s voice is part of Kandoo Pro.' });
  }
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, MAX_SPEAK_CHARS) : '';
  if (!text) return res.status(400).json({ error: 'Nothing to say.' });
  if (!apiKey) return res.status(503).json({ error: 'Kandoo’s voice is not available right now.' });

  try {
    const response = await elevenlabs(`/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
    });
    if (!response.ok) {
      console.error('ElevenLabs speech failed:', response.status);
      return res.status(502).json({ error: 'Kandoo’s voice is busy right now.' });
    }
    const audio = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(audio);
  } catch (error) {
    console.error('Speak failed:', error);
    return res.status(502).json({ error: 'Kandoo’s voice is busy right now.' });
  }
});

export default router;
