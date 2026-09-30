import { Router, type Response } from 'express';

import {
  authenticateRequest,
  type AuthenticatedRequest,
} from '../middleware/authenticateRequest';
import { aiRateLimit } from '../middleware/rateLimit';
import { resolveTimezone } from '../utils/timezone';

import { AiUnavailableError, aiProvider } from '../modules/ai';
import { getUserTier } from '../modules/entitlements/entitlementService';
import { PhotoInputError, decodeJpeg } from '../modules/photos/photoInput';

import {
  LibraryInputError,
  cleanCategoryName,
  cleanNote,
  searchTerm,
} from '../modules/library/libraryInput';
import {
  DuplicateCategoryError,
  createCategory,
  createNote,
  deleteCategory,
  deleteNote,
  getCategory,
  listCategories,
  listNotes,
  renameCategory,
  updateNote,
} from '../modules/library/libraryService';

/**
 * The Library: categories of the user's own notes. Plain CRUD — nothing here
 * involves the AI, so every write is the user's own and is saved as typed.
 * Available on every plan; reading a photographed document INTO the Library
 * is the Elite part, and goes through Mr. Kandoo.
 */

const router = Router();

/** A user-facing input problem → 400 (409 for a duplicate name). Anything else rethrows. */
function inputError(res: Response, error: unknown): Response | null {
  if (error instanceof DuplicateCategoryError) return res.status(409).json({ error: error.message });
  if (error instanceof LibraryInputError) return res.status(400).json({ error: error.message });
  return null;
}

router.get('/library/categories', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    const categories = await listCategories(userId, { query: searchTerm(req.query.q) });
    return res.status(200).json({ categories });
  } catch (error) {
    console.error('Library list error:', error);
    return res.status(500).json({ error: 'Your library couldn’t load just now.' });
  }
});

router.post('/library/categories', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    const category = await createCategory(userId, cleanCategoryName(req.body?.name));
    return res.status(201).json({ category });
  } catch (error) {
    if (inputError(res, error)) return;
    console.error('Library category create error:', error);
    return res.status(500).json({ error: 'That category couldn’t be made just now.' });
  }
});

router.get('/library/categories/:id', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const id = String(req.params.id);
  try {
    const category = await getCategory(userId, id);
    if (!category) return res.status(404).json({ error: 'Category not found.' });
    const notes = await listNotes(userId, id, { query: searchTerm(req.query.q) });
    return res.status(200).json({ category, notes });
  } catch (error) {
    console.error('Library category read error:', error);
    return res.status(500).json({ error: 'That category couldn’t load just now.' });
  }
});

router.patch('/library/categories/:id', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    const category = await renameCategory(userId, String(req.params.id), cleanCategoryName(req.body?.name));
    if (!category) return res.status(404).json({ error: 'Category not found.' });
    return res.status(200).json({ category });
  } catch (error) {
    if (inputError(res, error)) return;
    console.error('Library category rename error:', error);
    return res.status(500).json({ error: 'That category couldn’t be renamed just now.' });
  }
});

router.delete('/library/categories/:id', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    const found = await deleteCategory(userId, String(req.params.id));
    if (!found) return res.status(404).json({ error: 'Category not found.' });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Library category delete error:', error);
    return res.status(500).json({ error: 'That category couldn’t be deleted just now.' });
  }
});

router.post('/library/categories/:id/notes', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    // 'document': filed from a page Mr. Kandoo read (the card the user approved).
    const source = req.body?.source === 'document' ? 'document' : 'manual';
    const note = await createNote(userId, String(req.params.id), cleanNote(req.body ?? {}), source);
    if (!note) return res.status(404).json({ error: 'Category not found.' });
    return res.status(201).json({ note });
  } catch (error) {
    if (inputError(res, error)) return;
    console.error('Library note create error:', error);
    return res.status(500).json({ error: 'That note couldn’t be saved just now.' });
  }
});

/**
 * Elite, through Mr. Kandoo: read a photographed page into a proposed note.
 * Saves NOTHING (AGENTS §3.3) — the app shows the note as a card, and only the
 * user's yes files it (through the note route above, creating the category if
 * it is new). The photo is read and discarded; it is never stored.
 */
router.post('/library/read', authenticateRequest, aiRateLimit, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;

  let bytes: Buffer;
  try {
    bytes = decodeJpeg(req.body?.image);
  } catch (error) {
    if (error instanceof PhotoInputError) return res.status(400).json({ error: error.message });
    throw error;
  }

  try {
    if ((await getUserTier(userId)) !== 'elite') {
      return res.status(402).json({
        code: 'elite_required',
        error: 'Reading pages into your Library is part of Kandoo Elite.',
      });
    }

    const clientTime =
      typeof req.body?.clientTime === 'string' && !Number.isNaN(Date.parse(req.body.clientTime))
        ? req.body.clientTime
        : new Date().toISOString();
    const hint =
      typeof req.body?.categoryName === 'string' && req.body.categoryName.trim()
        ? cleanCategoryName(req.body.categoryName)
        : null;
    const existing = await listCategories(userId);

    let reading;
    try {
      reading = await aiProvider.readDocument(
        { base64: bytes.toString('base64'), mimeType: 'image/jpeg', caption: null },
        {
          clientTime,
          timezone: resolveTimezone(req.body?.timezone),
          categories: existing.map((c) => c.name),
          categoryHint: hint,
        }
      );
    } catch (aiError) {
      if (aiError instanceof AiUnavailableError) {
        return res.status(502).json({
          code: 'ai_busy',
          error: 'Kandoo’s AI is busy right now. Try that page again in a moment.',
        });
      }
      throw aiError;
    }

    if (!reading.readable || !reading.body.trim()) {
      return res.status(422).json({
        code: 'unreadable',
        error: 'Kandoo couldn’t read any words on that photo. Try again closer, with more light.',
      });
    }

    // File it on the shelf the user named, else the model's choice; both are
    // matched against existing categories ignoring case, so nothing duplicates.
    const categoryName = cleanCategoryName(hint ?? (reading.category.trim() || 'Notes'));
    const matched = existing.find((c) => c.name.toLowerCase() === categoryName.toLowerCase()) ?? null;
    const note = cleanNote({ title: reading.title, body: reading.body });

    return res.status(200).json({
      title: note.title,
      body: note.body,
      categoryName: matched?.name ?? categoryName,
      categoryId: matched?.id ?? null,
    });
  } catch (error) {
    if (inputError(res, error)) return;
    console.error('Library document read error:', error);
    return res.status(500).json({ error: 'Kandoo couldn’t read that page just now. Please try again.' });
  }
});

router.patch('/library/notes/:id', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const moveTo = typeof req.body?.categoryId === 'string' ? req.body.categoryId : null;
  try {
    const note = await updateNote(userId, String(req.params.id), cleanNote(req.body ?? {}), moveTo);
    if (!note) return res.status(404).json({ error: 'Note not found.' });
    return res.status(200).json({ note });
  } catch (error) {
    if (inputError(res, error)) return;
    console.error('Library note update error:', error);
    return res.status(500).json({ error: 'That note couldn’t be saved just now.' });
  }
});

router.delete('/library/notes/:id', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    const found = await deleteNote(userId, String(req.params.id));
    if (!found) return res.status(404).json({ error: 'Note not found.' });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Library note delete error:', error);
    return res.status(500).json({ error: 'That note couldn’t be deleted just now.' });
  }
});

export default router;
