import { Router } from 'express';

import {
  authenticateRequest,
  type AuthenticatedRequest,
} from '../middleware/authenticateRequest';
import { aiRateLimit } from '../middleware/rateLimit';
import { isProUser } from '../modules/entitlements/entitlementService';
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
 *   - speaks text in Kandoo's voice, so Free answers sound like the agent.
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

/** A conversation token for the private Kandoo agent. Pro only, checked here. */
router.get('/agent/session', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const { apiKey, agentId } = config();
  if (!apiKey || !agentId) {
    console.error('Kandoo Agent is not configured (ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID).');
    return res.status(503).json({ error: 'Kandoo Agent is not available right now.' });
  }
  if (!(await isProUser(userId, { fresh: req.query.fresh === '1' }))) {
    return res.status(402).json({ code: 'pro_required', error: 'Talking with Kandoo is part of Kandoo Pro.' });
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
    return res.json({ success: true, token: body.token });
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
 * Kandoo's voice for spoken answers (Free and Pro alike), as MP3. The app
 * falls back to the phone's own voice if this fails, so it is never load-bearing.
 */
router.post('/speak', authenticateRequest, aiRateLimit, async (req, res) => {
  const { apiKey, voiceId } = config();
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
