import { Router, type NextFunction, type Request, type Response } from 'express';

import {
  authenticateRequest,
  type AuthenticatedRequest,
} from '../middleware/authenticateRequest';

import { getUserTier } from '../modules/entitlements/entitlementService';
import { LibraryInputError, cleanNote } from '../modules/library/libraryInput';
import { getNote } from '../modules/library/libraryService';
import { searchTerm } from '../modules/library/libraryInput';
import { docxName, noteToDocx } from '../modules/teams/docxExport';
import {
  TeamInputError,
  cleanDisplayName,
  cleanOptional,
  cleanTeamName,
  decodeUpload,
  normaliseInviteCode,
  safeFileName,
} from '../modules/teams/teamInput';
import {
  TeamAccessError,
  createTeam,
  deleteFile,
  deleteTeam,
  getFile,
  getTeam,
  joinTeam,
  leaveTeam,
  listFiles,
  listTasks,
  listTeams,
  markTaskDone,
  regenerateInvite,
  removeMember,
  respondToTask,
  sendTask,
  setMemberRole,
  shareText,
  taskInbox,
  uploadFile,
} from '../modules/teams/teamService';

/**
 * Teams (Elite): a shared space for files and tasks. Every route checks Elite
 * here and membership in the service. Errors shown to the user are written
 * for the user; internals are only logged (AGENTS §10 — the repo is public).
 */

const router = Router();

const PUBLIC_URL = process.env.PUBLIC_URL ?? 'https://kandoo-toow.onrender.com';

async function requireElite(req: Request, res: Response, next: NextFunction) {
  try {
    if ((await getUserTier((req as AuthenticatedRequest).user.id)) !== 'elite') {
      return res.status(402).json({ code: 'elite_required', error: 'Teams are part of Kandoo Elite.' });
    }
    return next();
  } catch (error) {
    console.error('Teams tier check failed:', error);
    return res.status(500).json({ error: 'Teams couldn’t load just now.' });
  }
}

const guard = [authenticateRequest, requireElite];

/** A user-facing refusal → 400/403; anything else is logged and becomes a plain 500. */
function fail(res: Response, error: unknown, what: string) {
  if (error instanceof TeamInputError || error instanceof LibraryInputError) return res.status(400).json({ error: error.message });
  if (error instanceof TeamAccessError) return res.status(403).json({ error: error.message });
  console.error(`Teams: ${what} failed:`, error);
  return res.status(500).json({ error: `That couldn’t be done just now (${what}). Please try again.` });
}

const me = (req: Request) => (req as AuthenticatedRequest).user;
const fallbackName = (req: Request) => {
  const user = me(req) as { email?: string; user_metadata?: { name?: string } };
  return user.user_metadata?.name ?? user.email?.split('@')[0] ?? 'A teammate';
};

/** The link an admin shares: an https page that opens Kandoo at the join screen. */
const inviteLink = (code: string) => `${PUBLIC_URL}/join/${code}`;

// ── Teams ───────────────────────────────────────────────────────────────────

router.get('/teams', ...guard, async (req, res) => {
  try {
    const teams = await listTeams(me(req).id);
    return res.json({ teams: teams.map((t) => ({ ...t, inviteLink: t.inviteCode ? inviteLink(t.inviteCode) : null })) });
  } catch (error) {
    return fail(res, error, 'loading your teams');
  }
});

router.post('/teams', ...guard, async (req, res) => {
  try {
    const team = await createTeam(me(req).id, {
      name: cleanTeamName(req.body?.name),
      purpose: cleanOptional(req.body?.purpose, 300, 'purpose'),
      displayName: cleanDisplayName(req.body?.displayName, fallbackName(req)),
    });
    return res.status(201).json({ team: { ...team, inviteLink: inviteLink(team.inviteCode as string) } });
  } catch (error) {
    return fail(res, error, 'creating the team');
  }
});

router.post('/teams/join', ...guard, async (req, res) => {
  const code = normaliseInviteCode(req.body?.code);
  if (!code) return res.status(400).json({ error: 'That doesn’t look like a team code. It has 8 letters and numbers.' });
  try {
    const team = await joinTeam(me(req).id, code, cleanDisplayName(req.body?.displayName, fallbackName(req)));
    return res.json({ team });
  } catch (error) {
    return fail(res, error, 'joining the team');
  }
});

// Before /teams/:id, so "inbox" isn't taken for an id.
router.get('/teams/inbox', ...guard, async (req, res) => {
  try {
    return res.json({ tasks: await taskInbox(me(req).id) });
  } catch (error) {
    return fail(res, error, 'loading your team tasks');
  }
});

router.get('/teams/:id', ...guard, async (req, res) => {
  try {
    const { team, members } = await getTeam(me(req).id, String(req.params.id));
    return res.json({ team: { ...team, inviteLink: team.inviteCode ? inviteLink(team.inviteCode) : null }, members });
  } catch (error) {
    return fail(res, error, 'loading the team');
  }
});

router.delete('/teams/:id', ...guard, async (req, res) => {
  try {
    await deleteTeam(me(req).id, String(req.params.id));
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'deleting the team');
  }
});

router.post('/teams/:id/leave', ...guard, async (req, res) => {
  try {
    await leaveTeam(me(req).id, String(req.params.id));
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'leaving the team');
  }
});

router.post('/teams/:id/invite', ...guard, async (req, res) => {
  try {
    const code = await regenerateInvite(me(req).id, String(req.params.id));
    return res.json({ inviteCode: code, inviteLink: inviteLink(code) });
  } catch (error) {
    return fail(res, error, 'making a new invite link');
  }
});

router.patch('/teams/:id/members/:userId', ...guard, async (req, res) => {
  const role = req.body?.role === 'admin' ? 'admin' : req.body?.role === 'member' ? 'member' : null;
  if (!role) return res.status(400).json({ error: 'A role is admin or member.' });
  try {
    await setMemberRole(me(req).id, String(req.params.id), String(req.params.userId), role);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'changing the role');
  }
});

router.delete('/teams/:id/members/:userId', ...guard, async (req, res) => {
  try {
    await removeMember(me(req).id, String(req.params.id), String(req.params.userId));
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'removing the member');
  }
});

// ── Files ───────────────────────────────────────────────────────────────────

router.get('/teams/:id/files', ...guard, async (req, res) => {
  try {
    return res.json({ files: await listFiles(me(req).id, String(req.params.id), searchTerm(req.query.q)) });
  } catch (error) {
    return fail(res, error, 'loading the team’s files');
  }
});

/** Share a note or research write-up (text), or upload a document or photo (base64). */
router.post('/teams/:id/files', ...guard, async (req, res) => {
  const teamId = String(req.params.id);
  try {
    const message = cleanOptional(req.body?.message, 500, 'message');
    if (req.body?.file) {
      const upload = decodeUpload(req.body.file.base64, req.body.file.mimeType);
      const fileName = safeFileName(req.body.file.name, upload.ext);
      const title = cleanOptional(req.body?.title, 200, 'title') ?? fileName.replace(/\.[a-z0-9]+$/i, '');
      const file = await uploadFile(me(req).id, teamId, { ...upload, fileName, title, message });
      return res.status(201).json({ file });
    }
    const kind = req.body?.kind === 'research' ? 'research' : 'note';
    const note = cleanNote({ title: req.body?.title, body: req.body?.body });
    const file = await shareText(me(req).id, teamId, {
      kind,
      title: note.title ?? note.body.split('\n')[0].slice(0, 120),
      body: note.body,
      message,
    });
    return res.status(201).json({ file });
  } catch (error) {
    return fail(res, error, 'sharing it');
  }
});

router.get('/teams/files/:fileId', ...guard, async (req, res) => {
  try {
    const { file, text, teamName } = await getFile(me(req).id, String(req.params.fileId));
    return res.json({ file, text, teamName });
  } catch (error) {
    return fail(res, error, 'opening the file');
  }
});

router.delete('/teams/files/:fileId', ...guard, async (req, res) => {
  try {
    await deleteFile(me(req).id, String(req.params.fileId));
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'removing the file');
  }
});

function sendDocx(res: Response, buffer: Buffer, title: string) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(docxName(title))}"`);
  return res.send(buffer);
}

/** A shared note or research write-up as a Word document. */
router.get('/teams/files/:fileId/docx', ...guard, async (req, res) => {
  try {
    const { file, teamName } = await getFile(me(req).id, String(req.params.fileId));
    if (!file.body) return res.status(400).json({ error: 'Only notes and research open in Word. Open the file itself instead.' });
    const buffer = await noteToDocx({ title: file.title, body: file.body, footer: `Shared by ${file.senderName} in ${teamName} · Kandoo` });
    return sendDocx(res, buffer, file.title);
  } catch (error) {
    return fail(res, error, 'making the Word document');
  }
});

/** One of your own Library notes as a Word document (any plan: it's your note). */
router.get('/library/notes/:id/docx', authenticateRequest, async (req, res) => {
  try {
    const note = await getNote(me(req).id, String(req.params.id));
    if (!note) return res.status(404).json({ error: 'Note not found.' });
    const title = note.title ?? note.body.split('\n')[0].slice(0, 80);
    const buffer = await noteToDocx({ title, body: note.body, footer: `${note.categoryName} · Kandoo Library` });
    return sendDocx(res, buffer, title);
  } catch (error) {
    return fail(res, error, 'making the Word document');
  }
});

// ── Tasks ───────────────────────────────────────────────────────────────────

router.get('/teams/:id/tasks', ...guard, async (req, res) => {
  try {
    return res.json({ tasks: await listTasks(me(req).id, String(req.params.id)) });
  } catch (error) {
    return fail(res, error, 'loading the team’s tasks');
  }
});

router.post('/teams/:id/tasks', ...guard, async (req, res) => {
  const task = cleanOptional(req.body?.task, 300, 'task');
  const dueAt = typeof req.body?.dueAt === 'string' && !Number.isNaN(Date.parse(req.body.dueAt)) ? req.body.dueAt : null;
  if (!task) return res.status(400).json({ error: 'Say what the task is.' });
  if (!dueAt) return res.status(400).json({ error: 'Give the task a time, so it can remind people.' });
  if (Date.parse(dueAt) < Date.now() - 60_000) return res.status(400).json({ error: 'That time has already passed.' });
  try {
    const assigneeId = typeof req.body?.assigneeId === 'string' && req.body.assigneeId ? req.body.assigneeId : null;
    return res.status(201).json({ task: await sendTask(me(req).id, String(req.params.id), { task, dueAt, assigneeId }) });
  } catch (error) {
    return fail(res, error, 'sending the task');
  }
});

router.post('/teams/tasks/:taskId/respond', ...guard, async (req, res) => {
  try {
    const result = await respondToTask(me(req).id, String(req.params.taskId), req.body?.accept === true);
    return res.json(result);
  } catch (error) {
    return fail(res, error, 'answering the task');
  }
});

router.post('/teams/tasks/:taskId/done', ...guard, async (req, res) => {
  try {
    await markTaskDone(me(req).id, String(req.params.taskId));
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'marking it done');
  }
});

// ── The invite page (public): opens Kandoo at the join screen ───────────────

router.get('/join/:code', (req, res) => {
  const code = normaliseInviteCode(req.params.code);
  if (!code) return res.status(404).send('This invite link isn’t valid.');
  const deepLink = `kandoo://join/${code}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Join a team on Kandoo</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#F7F0E6;color:#2F241B;display:flex;min-height:100vh;align-items:center;justify-content:center}
  main{max-width:360px;padding:32px;text-align:center}
  h1{font-family:Georgia,serif;font-size:28px;margin:0 0 12px}
  p{color:#7A6758;line-height:1.5}
  a.btn{display:block;margin:24px 0 12px;padding:16px;border-radius:999px;background:#DB8B00;color:#2F241B;font-weight:600;text-decoration:none}
  code{font-size:22px;letter-spacing:4px;font-weight:700;color:#2F241B}
</style></head>
<body><main>
  <h1>You’re invited to a team on Kandoo</h1>
  <p>Open Kandoo to join. Teams are part of Kandoo Elite.</p>
  <a class="btn" href="${deepLink}">Open in Kandoo</a>
  <p>Or open Memory → Team → Join, and enter<br><code>${code}</code></p>
</main>
<script>setTimeout(function(){location.href=${JSON.stringify(deepLink)}},300)</script>
</body></html>`);
});

export default router;
