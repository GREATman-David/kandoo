import { Router } from 'express';

import {
  authenticateRequest,
  type AuthenticatedRequest,
} from '../middleware/authenticateRequest';
import { MAX_CAPTURE_CHARS, aiRateLimit } from '../middleware/rateLimit';
import { resolveTimezone } from '../utils/timezone';

import { aiProvider } from '../modules/ai';
import {
  attachNote,
  createCapture,
  deleteCapture,
  getCaptureNote,
  listCaptureNotes,
  updateCaptureNote,
} from '../modules/captures/captureService';
import { isProUser } from '../modules/entitlements/entitlementService';
import {
  deletePerson,
  getPerson,
  listPeople,
  mergePeople,
} from '../modules/people/peopleService';
import {
  createManualMemory,
  createMemory,
  deleteMemory,
  updateMemory,
} from '../modules/memories/memoryService';
import { answerRecall } from '../modules/memories/recallService';
import {
  confirmReminder,
  createManualReminder,
  createReminder,
  deleteReminder,
  listActiveReminders,
  listGroupedReminders,
  setReminderStatus,
  updateReminder,
} from '../modules/reminders/reminderService';

import type { KandooAction } from '../modules/ai/interpretationSchema';

const router = Router();
const isProduction = process.env.NODE_ENV === 'production';

type ActionResult =
  | { kind: 'reminder'; status: 'ok'; reminder: unknown }
  | { kind: 'memory'; status: 'ok'; memory: unknown }
  | {
      kind: 'recall';
      status: 'ok';
      answer: string;
      memories: unknown[];
      proBoundaryHit: boolean;
    }
  | { kind: KandooAction['kind']; status: 'failed'; reason: string };

router.post('/interpret', authenticateRequest, aiRateLimit, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    return res.status(400).json({ error: 'Text is required.' });
  }
  if (text.length > MAX_CAPTURE_CHARS) {
    return res.status(400).json({
      error: 'That’s a lot for one go — try telling Kandoo in a couple of parts.',
    });
  }

  // Time and timezone come from the DEVICE. Using the server clock meant a
  // reminder normalized correctly on a laptop in Accra and incorrectly on a
  // host in another zone, with no error to show for it.
  const clientTime =
    typeof req.body?.clientTime === 'string' &&
    !Number.isNaN(Date.parse(req.body.clientTime))
      ? req.body.clientTime
      : new Date().toISOString();

  const timezone = resolveTimezone(req.body?.timezone);

  const source = req.body?.source === 'voice' ? 'voice' : 'text';

  try {
    // Capture first, always. The raw utterance is the only thing we can never
    // regenerate — extraction can be re-run over it when the prompt improves.
    const capture = await createCapture(userId, {
      text,
      clientTime,
      timezone,
      source,
      transcriptConfidence:
        typeof req.body?.transcriptConfidence === 'number'
          ? req.body.transcriptConfidence
          : null,
    });

    const interpretation = await aiProvider.interpret(text, {
      clientTime,
      timezone,
    });

    if (!isProduction) {
      console.log(
        `[interpret] capture=${capture.id} actions=${interpretation.actions
          .map((a) => a.kind)
          .join(',')} confidence=${interpretation.confidence}`
      );
    }

    const results: ActionResult[] = [];

    // Embed every memory in ONE call rather than one call per memory — a recap
    // with five facts was five sequential round trips. If the batch fails, each
    // memory falls back to embedding itself (and, failing that, saves without a
    // vector), exactly as before.
    const memoryActions = interpretation.actions.filter(
      (a): a is Extract<KandooAction, { kind: 'memory' }> => a.kind === 'memory'
    );
    const batchedVectors = new Map<KandooAction, number[]>();
    if (memoryActions.length > 1) {
      try {
        const vectors = await aiProvider.embed(
          memoryActions.map((a) => a.content.trim()),
          'document'
        );
        memoryActions.forEach((action, index) => {
          const vector = vectors[index];
          if (vector) batchedVectors.set(action, vector);
        });
      } catch (error) {
        console.error('Batch embedding failed; embedding memories one by one:', error);
      }
    }

    // Resolved at most once per request, only if a recall action needs it, so
    // capture/extraction stay off the RevenueCat path entirely.
    let proStatus: boolean | null = null;
    // After a purchase the app asks for a fresh check, so the cached "free"
    // from the question that raised the paywall can't raise it again.
    const freshEntitlement = req.body?.freshEntitlement === true;
    const ensureProStatus = async () => {
      if (proStatus === null) {
        proStatus = await isProUser(userId, { fresh: freshEntitlement });
      }
      return proStatus;
    };

    for (const action of interpretation.actions) {
      try {
        switch (action.kind) {
          case 'reminder': {
            const reminder = await createReminder(
              userId,
              capture.id,
              action,
              clientTime
            );
            results.push({ kind: 'reminder', status: 'ok', reminder });
            break;
          }
          case 'memory': {
            const memory = await createMemory(
              userId,
              capture.id,
              action,
              batchedVectors.get(action)
            );
            results.push({ kind: 'memory', status: 'ok', memory });
            break;
          }
          case 'recall': {
            const pro = await ensureProStatus();
            const { answer, memories, proBoundaryHit } = await answerRecall(
              userId,
              action,
              pro
            );
            results.push({
              kind: 'recall',
              status: 'ok',
              answer,
              memories,
              proBoundaryHit,
            });
            break;
          }
        }
      } catch (actionError) {
        // One bad action must not discard the other five. Partial success is
        // the correct outcome for a multi-action utterance.
        console.error(`Action ${action.kind} failed:`, actionError);
        results.push({
          kind: action.kind,
          status: 'failed',
          // Never the raw error: it can carry Supabase/provider internals and
          // this repository is public. The real cause is logged just above.
          reason: 'Could not save this item.',
        });
      }
    }

    // A substantial capture also produces a cleaned-up note. Persisting it is
    // best-effort — the actions above are the real work, and a note write must
    // never fail the response.
    if (interpretation.note) {
      await attachNote(userId, capture.id, interpretation.note);
    }

    return res.status(200).json({
      success: true,
      captureId: capture.id,
      summary: interpretation.summary,
      confidence: interpretation.confidence,
      note: interpretation.note ?? null,
      results,
    });
  } catch (error) {
    console.error('Interpretation error:', error);
    // Never return error.message to the client: it leaks Supabase and OpenAI
    // internals, and this repository is public.
    return res.status(500).json({
      error: 'Kandoo could not process that just now. Please try again.',
    });
  }
});

router.post('/reminders/:id/confirm', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
        const reminder = await confirmReminder(userId, String(req.params.id), {
      task: typeof req.body?.task === 'string' ? req.body.task : undefined,
      dueAt: req.body?.dueAt === undefined ? undefined : req.body.dueAt,
    });
    return res.json({ success: true, reminder });
  } catch (error) {
    console.error('Confirm failed:', error);
    return res.status(500).json({ error: 'Could not confirm that reminder.' });
  }
});

router.post('/reminders/:id/dismiss', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    await setReminderStatus(userId, String(req.params.id), 'dismissed');
    return res.json({ success: true });
  } catch (error) {
    console.error('Dismiss failed:', error);
    return res.status(500).json({ error: 'Could not dismiss that reminder.' });
  }
});

/** The Reminders tab: needsReview / active / history (device splits Today/Upcoming). */
router.get('/reminders', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    const groups = await listGroupedReminders(userId);
    return res.json({ success: true, ...groups });
  } catch (error) {
    console.error('List reminders failed:', error);
    return res.status(500).json({ error: 'Could not load your reminders.' });
  }
});

/**
 * `repeatDays` from a request body: undefined when absent (leave as is), null to
 * stop repeating, else the unique weekdays 0 (Sunday) … 6 (Saturday), sorted.
 * Anything else is 'invalid'.
 */
function parseRepeatDays(value: unknown): number[] | null | undefined | 'invalid' {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return 'invalid';
  if (!value.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return 'invalid';
  const days = [...new Set(value as number[])].sort((a, b) => a - b);
  return days.length ? days : null;
}

/** Manual reminder from the + button. Confirmed at once; the device schedules it. */
router.post('/reminders', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const task = typeof req.body?.task === 'string' ? req.body.task : '';
  const dueAt =
    typeof req.body?.dueAt === 'string' && !Number.isNaN(Date.parse(req.body.dueAt))
      ? req.body.dueAt
      : null;
  const person = typeof req.body?.person === 'string' ? req.body.person : null;
  const repeatDays = parseRepeatDays(req.body?.repeatDays);

  if (!task.trim()) return res.status(400).json({ error: 'A task is required.' });
  if (!dueAt) return res.status(400).json({ error: 'A time is required.' });
  if (repeatDays === 'invalid') return res.status(400).json({ error: 'Invalid repeat days.' });

  try {
    const reminder = await createManualReminder(userId, { task, dueAt, person, repeatDays });
    return res.json({ success: true, reminder });
  } catch (error) {
    console.error('Create manual reminder failed:', error);
    return res.status(500).json({ error: 'Could not create that reminder.' });
  }
});

/** Edit a reminder (task/time/person) or change status (done, snooze). */
router.patch('/reminders/:id', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const patch: {
    task?: string;
    dueAt?: string | null;
    person?: string | null;
    status?: 'pending' | 'confirmed' | 'fired' | 'dismissed' | 'cancelled';
    repeatDays?: number[] | null;
  } = {};
  if (typeof req.body?.task === 'string') patch.task = req.body.task;
  if (req.body?.dueAt === null || typeof req.body?.dueAt === 'string') {
    patch.dueAt = req.body.dueAt;
  }
  if (req.body?.person === null || typeof req.body?.person === 'string') {
    patch.person = req.body.person;
  }
  const STATUSES = ['pending', 'confirmed', 'fired', 'dismissed', 'cancelled'];
  if (typeof req.body?.status === 'string' && STATUSES.includes(req.body.status)) {
    patch.status = req.body.status;
  }
  const repeatDays = parseRepeatDays(req.body?.repeatDays);
  if (repeatDays === 'invalid') return res.status(400).json({ error: 'Invalid repeat days.' });
  if (repeatDays !== undefined) patch.repeatDays = repeatDays;

  try {
    const reminder = await updateReminder(userId, String(req.params.id), patch);
    return res.json({ success: true, reminder });
  } catch (error) {
    console.error('Update reminder failed:', error);
    return res.status(500).json({ error: 'Could not update that reminder.' });
  }
});

/** Hard-delete a reminder. The device cancels its local notification after. */
router.delete('/reminders/:id', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    await deleteReminder(userId, String(req.params.id));
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete reminder failed:', error);
    return res.status(500).json({ error: 'Could not delete that reminder.' });
  }
});

/** The device calls this on launch to rebuild its local schedule. */
router.get('/reminders/active', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    const reminders = await listActiveReminders(userId);
    return res.json({ success: true, reminders });
  } catch (error) {
    console.error('List reminders failed:', error);
    return res.status(500).json({ error: 'Could not load reminders.' });
  }
});

/**
 * The Memory screen: captures that produced a note, each with the memories and
 * reminders it created. Read-only.
 */
router.get('/captures', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50)
    : undefined;
  // Home ▸ Recently passes ?noted=false to include one-line captures too.
  // Memory passes ?content=true to list everything with a note OR a memory
  // (dropping bare recall queries), regardless of the noted filter.
  const requireContent = req.query.content === 'true';
  // Recently passes ?actions=true to drop captures that produced nothing
  // (questions, unparseable remarks). Older app builds omit it and are unchanged.
  const requireActions = req.query.actions === 'true';
  // Memory's "Show older": a created_at cursor from the last row it holds.
  const before =
    typeof req.query.before === 'string' && !Number.isNaN(Date.parse(req.query.before))
      ? req.query.before
      : undefined;
  const notedOnly =
    requireContent || requireActions ? false : req.query.noted !== 'false';
  try {
    const captures = await listCaptureNotes(userId, {
      limit,
      notedOnly,
      requireContent,
      requireActions,
      before,
    });
    return res.json({ success: true, captures });
  } catch (error) {
    console.error('List captures failed:', error);
    return res.status(500).json({ error: 'Could not load your notes.' });
  }
});

/**
 * Manual entry from the + button: a Note, a Memory, or Both. Creates one
 * `manual`-source capture, attaches the note if given, and embeds the memory if
 * given (extraction is OFF for manual input, but embedding is not — recall must
 * still find it). Returns the assembled row so the list can prepend it.
 */
router.post('/captures/manual', authenticateRequest, aiRateLimit, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;

  const noteTitle = typeof req.body?.note?.title === 'string' ? req.body.note.title.trim() : '';
  const noteBody = typeof req.body?.note?.body === 'string' ? req.body.note.body.trim() : '';
  const memoryContent =
    typeof req.body?.memory?.content === 'string' ? req.body.memory.content.trim() : '';
  const hasNote = !!(noteTitle && noteBody);
  const hasMemory = !!memoryContent;

  if (noteBody.length > MAX_CAPTURE_CHARS * 3 || memoryContent.length > MAX_CAPTURE_CHARS) {
    return res.status(400).json({ error: 'That’s too long to save in one entry.' });
  }

  if (!hasNote && !hasMemory) {
    return res.status(400).json({ error: 'Add a note or a memory first.' });
  }

  const clientTime =
    typeof req.body?.clientTime === 'string' && !Number.isNaN(Date.parse(req.body.clientTime))
      ? req.body.clientTime
      : new Date().toISOString();
  const timezone = resolveTimezone(req.body?.timezone);

  try {
    // The capture's verbatim text is whatever the user typed — the note body, or
    // the memory content when there's no note.
    const capture = await createCapture(userId, {
      text: hasNote ? noteBody : memoryContent,
      clientTime,
      timezone,
      source: 'manual',
    });

    if (hasNote) {
      await updateCaptureNote(userId, capture.id, { title: noteTitle, body: noteBody });
    }
    if (hasMemory) {
      await createManualMemory(userId, capture.id, memoryContent);
    }

    const saved = await getCaptureNote(userId, capture.id);
    return res.json({ success: true, capture: saved });
  } catch (error) {
    console.error('Create manual capture failed:', error);
    return res.status(500).json({ error: 'Could not save that just now.' });
  }
});

/**
 * "Take note": write a clean note for one capture on the user's request. The
 * model only writes the text; this route loads the user's own capture and
 * persists the result. A capture that already has a note returns it as-is, so
 * a double tap never spends a second model call or overwrites an edited note.
 */
router.post('/captures/:id/note', authenticateRequest, aiRateLimit, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const captureId = String(req.params.id);
  try {
    const capture = await getCaptureNote(userId, captureId);
    if (!capture) {
      return res.status(404).json({ error: 'That capture could not be found.' });
    }
    if (capture.note) {
      return res.json({ success: true, note: capture.note });
    }

    const note = await aiProvider.writeNote(capture.text);
    await updateCaptureNote(userId, captureId, note);
    return res.json({ success: true, note });
  } catch (error) {
    console.error('Take note failed:', error);
    return res.status(500).json({ error: 'Kandoo could not take a note just now.' });
  }
});

/** Edit a capture's note (title + body only; memories are left untouched). */
router.patch('/captures/:id/note', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!title || !body) {
    return res.status(400).json({ error: 'A title and body are required.' });
  }
  try {
    await updateCaptureNote(userId, String(req.params.id), { title, body });
    return res.json({ success: true });
  } catch (error) {
    console.error('Update capture note failed:', error);
    return res.status(500).json({ error: 'Could not update that note.' });
  }
});

/** Delete a capture (a note) and the memories it produced. */
router.delete('/captures/:id', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    await deleteCapture(userId, String(req.params.id));
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete capture failed:', error);
    return res.status(500).json({ error: 'Could not delete that note.' });
  }
});

/** One capture with its note, memories and reminders — the note-detail screen. */
router.get('/captures/:id', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    const capture = await getCaptureNote(userId, String(req.params.id));
    if (!capture) return res.status(404).json({ error: 'Note not found.' });
    return res.json({ success: true, capture });
  } catch (error) {
    console.error('Get capture failed:', error);
    return res.status(500).json({ error: 'Could not load that note.' });
  }
});

// ---- Memories ----

/** Edit a memory's text; re-embeds on save so recall matches the new wording. */
router.patch('/memories/:id', authenticateRequest, aiRateLimit, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  if (!content.trim()) {
    return res.status(400).json({ error: 'Memory text is required.' });
  }
  try {
    const memory = await updateMemory(userId, String(req.params.id), content);
    return res.json({ success: true, memory });
  } catch (error) {
    console.error('Update memory failed:', error);
    return res.status(500).json({ error: 'Could not update that memory.' });
  }
});

/** Delete one memory. */
router.delete('/memories/:id', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    await deleteMemory(userId, String(req.params.id));
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete memory failed:', error);
    return res.status(500).json({ error: 'Could not delete that memory.' });
  }
});

// ---- People ----

router.get('/people', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    const people = await listPeople(userId);
    return res.json({ success: true, people });
  } catch (error) {
    console.error('List people failed:', error);
    return res.status(500).json({ error: 'Could not load people.' });
  }
});

/** Merge must be declared before /people/:id so "merge" isn't read as an id. */
router.post('/people/merge', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  const survivorId =
    typeof req.body?.survivorId === 'string' ? req.body.survivorId : '';
  const otherIds = Array.isArray(req.body?.otherIds)
    ? req.body.otherIds.filter((x: unknown): x is string => typeof x === 'string')
    : [];
  if (!survivorId || otherIds.length === 0) {
    return res.status(400).json({ error: 'A survivor and at least one other are required.' });
  }
  try {
    await mergePeople(userId, survivorId, otherIds);
    return res.json({ success: true });
  } catch (error) {
    console.error('Merge people failed:', error);
    return res.status(500).json({ error: 'Could not merge those people.' });
  }
});

router.get('/people/:id', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    const person = await getPerson(userId, String(req.params.id));
    if (!person) return res.status(404).json({ error: 'Person not found.' });
    return res.json({ success: true, person });
  } catch (error) {
    console.error('Get person failed:', error);
    return res.status(500).json({ error: 'Could not load that person.' });
  }
});

router.delete('/people/:id', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;
  try {
    await deletePerson(userId, String(req.params.id));
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete person failed:', error);
    return res.status(500).json({ error: 'Could not delete that person.' });
  }
});

export default router;
