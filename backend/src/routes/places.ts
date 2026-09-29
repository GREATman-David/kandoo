import { Router, type Response } from 'express';

import {
  authenticateRequest,
  type AuthenticatedRequest,
} from '../middleware/authenticateRequest';
import { isProUser } from '../modules/entitlements/entitlementService';
import { placeGeometry } from '../modules/places/geo';
import {
  PlaceInputError,
  clearPlaceArea,
  createPlace,
  deletePlace,
  getPlace,
  listPlaces,
  renamePlace,
  setPlaceArea,
} from '../modules/places/placeService';

/**
 * Places. Reading is free — a place the user has talked about, and what was said
 * there, is theirs whatever their plan. DRAWING a place (which is what makes the
 * phone watch it) is Pro, enforced here: a client boolean is trivially spoofed.
 * `code: 'pro_required'` lets the app open the paywall instead of an error.
 */

const router = Router();

const PRO_REQUIRED = {
  code: 'pro_required',
  error: 'Places are part of Kandoo Pro.',
} as const;

async function requirePro(userId: string, res: Response): Promise<boolean> {
  if (await isProUser(userId)) return true;
  res.status(402).json(PRO_REQUIRED);
  return false;
}

function placeError(res: Response, error: unknown, label: string, fallback: string) {
  if (error instanceof PlaceInputError) {
    const status = error.code === 'not_found' ? 404 : error.code === 'name_taken' ? 409 : 400;
    return res.status(status).json({ code: error.code, error: error.message });
  }
  console.error(label, error);
  return res.status(500).json({ error: fallback });
}

/** Geometry from a request body, or a 400 already sent. */
function geometryFrom(body: unknown, res: Response) {
  const b = (body ?? {}) as { area?: unknown; center?: unknown; radiusM?: unknown };
  const geometry = placeGeometry({ area: b.area, center: b.center, radiusM: b.radiusM });
  if ('error' in geometry) {
    res.status(400).json({ code: 'invalid', error: geometry.error });
    return null;
  }
  return geometry;
}

router.get('/places', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    const places = await listPlaces(userId);
    return res.json({ success: true, places });
  } catch (error) {
    return placeError(res, error, 'List places failed:', 'Could not load your places.');
  }
});

router.get('/places/:id', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    const place = await getPlace(userId, String(req.params.id));
    if (!place) return res.status(404).json({ error: 'Place not found.' });
    return res.json({ success: true, place });
  } catch (error) {
    return placeError(res, error, 'Get place failed:', 'Could not load that place.');
  }
});

/** Draw a new place: { name, area } or { name, center, radiusM }; `replace` redraws. */
router.post('/places', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  if (!name.trim()) return res.status(400).json({ code: 'invalid', error: 'Give the place a name.' });
  if (name.trim().length > 60) {
    return res.status(400).json({ code: 'invalid', error: 'That name is a little long.' });
  }

  const geometry = geometryFrom(req.body, res);
  if (!geometry) return;
  if (!(await requirePro(userId, res))) return;

  try {
    const place = await createPlace(userId, name, geometry, {
      replace: req.body?.replace === true,
    });
    return res.json({ success: true, place });
  } catch (error) {
    return placeError(res, error, 'Create place failed:', 'Could not save that place.');
  }
});

/** Rename and/or redraw. Any geometry field present means a redraw. */
router.patch('/places/:id', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const placeId = String(req.params.id);
  const name = typeof req.body?.name === 'string' ? req.body.name : undefined;
  const redraw =
    req.body?.area !== undefined || req.body?.center !== undefined;

  if (name === undefined && !redraw) {
    return res.status(400).json({ code: 'invalid', error: 'Nothing to change.' });
  }
  if (name !== undefined && name.trim().length > 60) {
    return res.status(400).json({ code: 'invalid', error: 'That name is a little long.' });
  }

  const geometry = redraw ? geometryFrom(req.body, res) : null;
  if (redraw && !geometry) return;
  if (!(await requirePro(userId, res))) return;

  try {
    if (name !== undefined) await renamePlace(userId, placeId, name);
    if (geometry) await setPlaceArea(userId, placeId, geometry);
    const place = await getPlace(userId, placeId);
    if (!place) return res.status(404).json({ error: 'Place not found.' });
    return res.json({ success: true, place });
  } catch (error) {
    return placeError(res, error, 'Update place failed:', 'Could not update that place.');
  }
});

/** Stop watching a place but keep it and everything said there. Free: it only removes. */
router.delete('/places/:id/area', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    await clearPlaceArea(userId, String(req.params.id));
    return res.json({ success: true });
  } catch (error) {
    return placeError(res, error, 'Clear place area failed:', 'Could not update that place.');
  }
});

router.delete('/places/:id', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    await deletePlace(userId, String(req.params.id));
    return res.json({ success: true });
  } catch (error) {
    return placeError(res, error, 'Delete place failed:', 'Could not delete that place.');
  }
});

export default router;
