import { Router } from 'express';

import {
  authenticateRequest,
  type AuthenticatedRequest,
} from '../middleware/authenticateRequest';
import { aiRateLimit } from '../middleware/rateLimit';
import { resolveTimezone } from '../utils/timezone';

import { AiUnavailableError, aiProvider } from '../modules/ai';
import { attachNote, createCapture } from '../modules/captures/captureService';
import { getUserTier } from '../modules/entitlements/entitlementService';
import { createMemory } from '../modules/memories/memoryService';
import {
  PhotoInputError,
  addPhotoLinks,
  decodeJpeg,
  deletePhoto,
  entitiesForActions,
  listPhotos,
  ownedEntityIds,
  presentPhoto,
  savePhoto,
  type Photo,
} from '../modules/photos/photoService';
import { createReminder } from '../modules/reminders/reminderService';

import type { KandooAction } from '../modules/ai/interpretationSchema';

/**
 * Show Kandoo — photos as captures — and the photo library.
 *
 * The AI only reads the photo and PROPOSES actions (AGENTS §3.1): reminders
 * come back `pending` for the review card, exactly like a spoken capture. The
 * photo itself is kept on Pro and Elite; on Free it is read and discarded.
 */

const router = Router();
const isProduction = process.env.NODE_ENV === 'production';

const AI_BUSY = {
  code: 'ai_busy',
  error: 'Kandoo’s AI is busy right now. Try showing it that photo again in a moment.',
} as const;

const MAX_CAPTION_CHARS = 500;

function dimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 20000
    ? Math.round(value)
    : null;
}

function caption(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, MAX_CAPTION_CHARS);
  return trimmed || null;
}

type SavedResult =
  | { kind: 'reminder'; status: 'ok'; reminder: unknown }
  | { kind: 'memory'; status: 'ok'; memory: unknown }
  | { kind: KandooAction['kind']; status: 'failed'; reason: string };

router.post('/interpret/photo', authenticateRequest, aiRateLimit, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;

  let bytes: Buffer;
  try {
    bytes = decodeJpeg(req.body?.image);
  } catch (error) {
    if (error instanceof PhotoInputError) return res.status(400).json({ error: error.message });
    throw error;
  }

  const clientTime =
    typeof req.body?.clientTime === 'string' && !Number.isNaN(Date.parse(req.body.clientTime))
      ? req.body.clientTime
      : new Date().toISOString();
  const timezone = resolveTimezone(req.body?.timezone);
  const said = caption(req.body?.caption);

  try {
    let interpretation;
    try {
      interpretation = await aiProvider.interpretPhoto(
        { base64: bytes.toString('base64'), mimeType: 'image/jpeg', caption: said },
        { clientTime, timezone }
      );
    } catch (aiError) {
      if (aiError instanceof AiUnavailableError) return res.status(502).json(AI_BUSY);
      throw aiError;
    }

    // The capture's text is what the photo was (and what was said with it):
    // it is what Recently shows and what extraction can be re-run against.
    const capture = await createCapture(userId, {
      text: said ? `Photo: ${interpretation.description}\n${said}` : `Photo: ${interpretation.description}`,
      clientTime,
      timezone,
      source: 'photo',
    });

    if (!isProduction) {
      console.log(
        `[photo] capture=${capture.id} actions=${interpretation.actions.map((a) => a.kind).join(',')}`
      );
    }

    const results: SavedResult[] = [];
    for (const action of interpretation.actions) {
      try {
        if (action.kind === 'reminder') {
          const reminder = await createReminder(userId, capture.id, action, clientTime);
          results.push({ kind: 'reminder', status: 'ok', reminder });
        } else if (action.kind === 'memory') {
          const memory = await createMemory(userId, capture.id, action);
          results.push({ kind: 'memory', status: 'ok', memory });
        }
      } catch (actionError) {
        // One bad action must not discard the others.
        console.error(`Photo action ${action.kind} failed:`, actionError);
        results.push({ kind: action.kind, status: 'failed', reason: 'Could not save this item.' });
      }
    }

    if (interpretation.note) await attachNote(userId, capture.id, interpretation.note);

    // Keep the photo for paying users; a failure to keep it never loses the
    // actions already saved — the reply just says it wasn't kept.
    const tier = await getUserTier(userId);
    let photo: Photo | null = null;
    let kept = false;
    if (tier !== 'free') {
      try {
        const entityIds = await entitiesForActions(userId, interpretation.actions, req.body?.placeIds);
        const row = await savePhoto(userId, {
          bytes,
          width: dimension(req.body?.width),
          height: dimension(req.body?.height),
          description: interpretation.description,
          captureId: capture.id,
          entityIds,
        });
        photo = await presentPhoto(userId, row);
        kept = true;
      } catch (error) {
        console.error('Keeping a shown photo failed:', error);
      }
    }

    return res.status(200).json({
      success: true,
      captureId: capture.id,
      summary: interpretation.summary,
      confidence: interpretation.confidence,
      note: interpretation.note ?? null,
      description: interpretation.description,
      results,
      photo,
      photoKept: kept,
      // Free: the photo was read, not kept — the app offers Pro for that.
      photoNeedsPro: tier === 'free',
    });
  } catch (error) {
    console.error('Photo interpretation error:', error);
    return res.status(500).json({ error: 'Kandoo couldn’t read that photo just now. Please try again.' });
  }
});

/** The library: everything, one person's or place's album, or a text search. */
router.get('/photos', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const entityId = typeof req.query.entityId === 'string' ? req.query.entityId : undefined;
  const query = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) || undefined : undefined;
  try {
    if (entityId) {
      // Someone else's person or place yields nothing, not their photos.
      const [owned] = await ownedEntityIds(userId, [entityId]);
      if (!owned) return res.status(200).json({ photos: [] });
    }
    const photos = await listPhotos(userId, { entityId, query, limit });
    return res.status(200).json({ photos });
  } catch (error) {
    console.error('Photo list error:', error);
    return res.status(500).json({ error: 'Photos couldn’t load just now.' });
  }
});

/** Add a photo straight to a person or place (not a capture). Pro and Elite. */
router.post('/photos', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  let bytes: Buffer;
  try {
    bytes = decodeJpeg(req.body?.image);
  } catch (error) {
    if (error instanceof PhotoInputError) return res.status(400).json({ error: error.message });
    throw error;
  }
  try {
    if ((await getUserTier(userId)) === 'free') {
      return res.status(402).json({ code: 'pro_required', error: 'Keeping photos comes with Kandoo Personal and up.' });
    }
    const entityIds = await ownedEntityIds(userId, req.body?.entityIds);
    if (entityIds.length === 0) {
      return res.status(400).json({ error: 'Choose who or where this photo belongs to.' });
    }
    const row = await savePhoto(userId, {
      bytes,
      width: dimension(req.body?.width),
      height: dimension(req.body?.height),
      description: caption(req.body?.description),
      captureId: null,
      entityIds,
    });
    return res.status(201).json({ photo: await presentPhoto(userId, row) });
  } catch (error) {
    console.error('Photo add error:', error);
    return res.status(500).json({ error: 'That photo couldn’t be saved just now.' });
  }
});

/** Also file an existing photo under more people or places. */
router.post('/photos/:id/links', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    const found = await addPhotoLinks(userId, String(req.params.id), req.body?.entityIds);
    if (!found) return res.status(404).json({ error: 'Photo not found.' });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Photo link error:', error);
    return res.status(500).json({ error: 'That photo couldn’t be updated just now.' });
  }
});

router.delete('/photos/:id', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    const found = await deletePhoto(userId, String(req.params.id));
    if (!found) return res.status(404).json({ error: 'Photo not found.' });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Photo delete error:', error);
    return res.status(500).json({ error: 'That photo couldn’t be deleted just now.' });
  }
});

export default router;
