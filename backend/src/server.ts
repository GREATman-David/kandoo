import cors from 'cors';
import 'dotenv/config';
import express from 'express';

import {
  authenticateRequest,
  type AuthenticatedRequest,
} from './middleware/authenticateRequest';

import { createCapture } from './modules/captures/captureService';
import interpretRouter from './routes/interpret';

const app = express();

// Railway, Render and Fly inject PORT and health-check that exact port.
// A hardcoded 3000 means the platform kills the container on deploy.
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

if (!isProduction) {
  console.log('Supabase URL loaded:', !!process.env.SUPABASE_URL);
  console.log('Supabase secret loaded:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log('OpenAI key loaded:', !!process.env.OPENAI_API_KEY);
  console.log('OpenAI model:', process.env.OPENAI_MODEL ?? '(not set)');
}

// There is no web client, only native callers that don't send an Origin
// header and aren't subject to CORS anyway. `{ origin: false }` disables the
// CORS headers entirely, which blocks every browser-based cross-origin caller.
app.use(cors({ origin: false }));
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({ message: 'Kandoo backend is running' });
});

/** Liveness probe for the host platform. */
app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/**
 * Standalone capture. Used by the offline queue: the device saves the raw
 * utterance now and calls /interpret when it has connectivity.
 */
app.post('/captures', authenticateRequest, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user.id;

    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim()) {
      return res.status(400).json({ error: 'Text is required.' });
    }

    const capture = await createCapture(userId, {
      text,
      clientTime:
        typeof req.body?.clientTime === 'string' &&
        !Number.isNaN(Date.parse(req.body.clientTime))
          ? req.body.clientTime
          : new Date().toISOString(),
      timezone:
        typeof req.body?.timezone === 'string' && req.body.timezone
          ? req.body.timezone
          : 'UTC',
      source: req.body?.source === 'voice' ? 'voice' : 'text',
    });

    return res.status(201).json({ success: true, capture });
  } catch (error) {
    console.error('Create capture error:', error);
    // Never return error.message: it leaks Supabase internals, and this
    // repository is public at submission.
    return res.status(500).json({ error: 'Failed to save capture.' });
  }
});

// /interpret, /reminders/:id/confirm, /reminders/:id/dismiss, /reminders/active
app.use('/', interpretRouter);

/**
 * The 30-second setInterval scheduler is gone.
 *
 * It had no lock and no idempotency, so two instances — which any host gives
 * you during a rolling deploy — fired every reminder twice. More importantly,
 * it made every reminder depend on a server being awake. Time reminders are now
 * scheduled as local notifications on the device: they fire offline, instantly,
 * and with this process stopped.
 */

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Kandoo backend running on port ${PORT}`);
});
