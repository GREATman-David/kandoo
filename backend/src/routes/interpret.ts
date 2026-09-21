import { Router } from 'express';

import {
  authenticateRequest,
  type AuthenticatedRequest,
} from '../middleware/authenticateRequest';

import { aiProvider } from '../modules/ai';
import { createCapture } from '../modules/captures/captureService';
import { isProUser } from '../modules/entitlements/entitlementService';
import { createMemory } from '../modules/memories/memoryService';
import { answerRecall } from '../modules/memories/recallService';
import {
  confirmReminder,
  createReminder,
  listActiveReminders,
  setReminderStatus,
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

router.post('/interpret', authenticateRequest, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user.id;

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    return res.status(400).json({ error: 'Text is required.' });
  }

  // Time and timezone come from the DEVICE. Using the server clock meant a
  // reminder normalized correctly on a laptop in Accra and incorrectly on a
  // host in another zone, with no error to show for it.
  const clientTime =
    typeof req.body?.clientTime === 'string' &&
    !Number.isNaN(Date.parse(req.body.clientTime))
      ? req.body.clientTime
      : new Date().toISOString();

  const timezone =
    typeof req.body?.timezone === 'string' && req.body.timezone
      ? req.body.timezone
      : 'UTC';

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

    // Resolved at most once per request, only if a recall action needs it, so
    // capture/extraction stay off the RevenueCat path entirely.
    let proStatus: boolean | null = null;
    const ensureProStatus = async () => {
      if (proStatus === null) proStatus = await isProUser(userId);
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
            const memory = await createMemory(userId, capture.id, action);
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
          reason:
            actionError instanceof Error
              ? actionError.message
              : 'Could not process this item.',
        });
      }
    }

    return res.status(200).json({
      success: true,
      captureId: capture.id,
      summary: interpretation.summary,
      confidence: interpretation.confidence,
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

export default router;
