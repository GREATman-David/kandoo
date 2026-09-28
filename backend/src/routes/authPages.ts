import path from 'node:path';

import express, { Router } from 'express';

/**
 * The web pages a new user meets outside the app: where Supabase sends them
 * after they tap "Confirm" in the sign-up email, and the logo that email
 * shows. Before this, the link landed on the API root — a black page reading
 * `{"message":"Kandoo backend is running"}`.
 *
 * Supabase appends the session (or an error) to the URL fragment. The page
 * never reads or sends the tokens; it only checks for an error so an expired
 * link says so, then clears the fragment from the address bar.
 *
 * Colours mirror src/theme/theme.ts (base, surface, ink, inkMuted, line,
 * settledFill, alarmText); this page ships without the app's token module.
 */
const router = Router();

router.use(
  '/brand',
  express.static(path.resolve(__dirname, '../../public'), { maxAge: '7d' })
);

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Kandoo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;1,9..144,600&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px 16px; background: #F7F0E6; color: #2F241B;
    font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  .card {
    width: 100%; max-width: 400px; text-align: center; background: #FFFFFF;
    border: 1px solid #E8D8C4; border-radius: 20px; padding: 40px 28px 36px;
  }
  .mark { width: 56px; height: 56px; display: block; margin: 0 auto 10px; }
  .motto { font-family: Fraunces, Georgia, serif; font-style: italic; font-weight: 600; font-size: 17px; color: #8A6A00; margin: 0 0 28px; }
  .status { width: 64px; height: 64px; display: block; margin: 0 auto 20px; }
  h1 { font-family: Fraunces, Georgia, serif; font-weight: 600; font-size: 26px; line-height: 1.25; margin: 0 0 10px; }
  p { font-size: 16px; line-height: 1.5; color: #7A6758; margin: 0; }
  .error { display: none; }
  body.failed .ok { display: none; }
  body.failed .error { display: block; }
</style>
</head>
<body>
  <main class="card">
    <img class="mark" src="/brand/kandoo-mark@2x.png" alt="Kandoo">
    <p class="motto">Yes You Kan</p>
    <div class="ok">
      <svg class="status" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="32" fill="#897800"/>
        <path d="M19 33.5l8.5 8.5L45 24.5" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <h1>Your email is confirmed</h1>
      <p>You're all set. Go back to Kandoo and sign in.</p>
    </div>
    <div class="error">
      <svg class="status" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="32" fill="#A32B12"/>
        <path d="M32 18v18M32 45v1" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/>
      </svg>
      <h1>This link has expired</h1>
      <p>Open Kandoo and sign up again to get a fresh confirmation email.</p>
    </div>
  </main>
<script>
  (function () {
    var params = new URLSearchParams(location.hash.slice(1) + '&' + location.search.slice(1));
    if (params.get('error') || params.get('error_code')) document.body.className = 'failed';
    // The fragment can carry a session; never leave it in the address bar.
    if (location.hash) history.replaceState(null, '', location.pathname);
  })();
</script>
</body>
</html>`;

router.get('/auth/confirmed', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.type('html').send(PAGE);
});

export default router;
