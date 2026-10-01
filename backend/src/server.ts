import cors from 'cors';
import 'dotenv/config';
import express from 'express';

import authPagesRouter from './routes/authPages';
import interpretRouter from './routes/interpret';
import agentRouter from './routes/agent';
import insightsRouter from './routes/insights';
import placesRouter from './routes/places';
import photosRouter from './routes/photos';
import libraryRouter from './routes/library';
import teamsRouter from './routes/teams';

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
// Photos (Show Kandoo, the library) carry a JPEG of a few hundred KB as
// base64; everything else stays under the tight 1 MB limit.
const jsonSmall = express.json({ limit: '1mb' });
const jsonPhoto = express.json({ limit: '8mb' });
// A shared team document is up to 15 MB, so about 20 MB as base64.
const jsonFile = express.json({ limit: '22mb' });
app.use((req, res, next) =>
  /^\/teams\/[^/]+\/files$/.test(req.path) && req.method === 'POST'
    ? jsonFile(req, res, next)
    : req.path === '/interpret/photo' || req.path === '/photos' || req.path === '/library/read'
      ? jsonPhoto(req, res, next)
      : jsonSmall(req, res, next)
);

app.get('/', (_req, res) => {
  res.json({ message: 'Kandoo backend is running' });
});

/** Liveness probe for the host platform. */
app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// /auth/confirmed (where the sign-up email lands) and /brand/* (its logo).
app.use('/', authPagesRouter);

// /interpret, /reminders/:id/confirm, /reminders/:id/dismiss, /reminders/active
app.use('/', interpretRouter);

// /places — the areas the phone watches (it, not the server, does the watching).
app.use('/', placesRouter);

// /interpret/photo, /photos — Show Kandoo and the photo library.
app.use('/', photosRouter);

// /library/... — categories of the user's own notes.
app.use('/', libraryRouter);

// /teams/..., /join/:code, /library/notes/:id/docx — Teams (Elite) and Word export.
app.use('/', teamsRouter);

// /insights/month — the monthly recap's server half (counts only).
app.use('/', insightsRouter);

// /agent/session, /agent/search, /speak — Kandoo Agent (Pro) and Kandoo's voice.
app.use('/', agentRouter);

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
