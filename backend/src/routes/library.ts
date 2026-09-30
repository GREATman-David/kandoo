import { Router, type Response } from 'express';

import {
  authenticateRequest,
  type AuthenticatedRequest,
} from '../middleware/authenticateRequest';

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
    const note = await createNote(userId, String(req.params.id), cleanNote(req.body ?? {}));
    if (!note) return res.status(404).json({ error: 'Category not found.' });
    return res.status(201).json({ note });
  } catch (error) {
    if (inputError(res, error)) return;
    console.error('Library note create error:', error);
    return res.status(500).json({ error: 'That note couldn’t be saved just now.' });
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
