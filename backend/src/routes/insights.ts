import { Router } from 'express';

import {
  authenticateRequest,
  type AuthenticatedRequest,
} from '../middleware/authenticateRequest';
import { getUserTier } from '../modules/entitlements/entitlementService';
import { monthInsights } from '../modules/insights/insightsService';
import { usageInsights } from '../modules/insights/usageService';
import { resolveTimezone } from '../utils/timezone';

/**
 * GET /insights/month?from=<ISO>&to=<ISO> — the recap's server half. The
 * DEVICE sends its own month boundaries (AGENTS §3.4: time is a device fact;
 * "September" starts at midnight where the user is, not where the server is).
 */
const router = Router();

const MAX_WINDOW_MS = 62 * 24 * 60 * 60 * 1000;

router.get('/insights/month', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const from = Date.parse(String(req.query.from ?? ''));
  const to = Date.parse(String(req.query.to ?? ''));
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from || to - from > MAX_WINDOW_MS) {
    return res.status(400).json({ error: 'A month is needed.' });
  }
  try {
    const insights = await monthInsights(userId, new Date(from).toISOString(), new Date(to).toISOString());
    return res.json({ success: true, insights });
  } catch (error) {
    console.error('Month insights failed:', error);
    return res.status(500).json({ error: 'Could not put your month together.' });
  }
});

/**
 * GET /insights/usage?from=<ISO>&to=<ISO>&tz=<IANA> — Insights (Pro and
 * Elite): activity over a week or a month, shaped for charts. Counts only.
 */
router.get('/insights/usage', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const from = Date.parse(String(req.query.from ?? ''));
  const to = Date.parse(String(req.query.to ?? ''));
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from || to - from > MAX_WINDOW_MS) {
    return res.status(400).json({ error: 'A week or a month is needed.' });
  }
  try {
    if ((await getUserTier(userId)) === 'free') {
      return res.status(402).json({ code: 'pro_required', error: 'Insights are part of Kandoo Pro.' });
    }
    const usage = await usageInsights(userId, {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      timeZone: resolveTimezone(req.query.tz),
    });
    return res.json({ success: true, usage });
  } catch (error) {
    console.error('Usage insights failed:', error);
    return res.status(500).json({ error: 'Your insights couldn’t load just now.' });
  }
});

export default router;
