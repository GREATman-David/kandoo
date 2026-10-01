import { randomUUID } from 'node:crypto';

import mammoth from 'mammoth';

import { supabase } from '../../services/supabase';
import { aiProvider, withDeadline } from '../ai';
import { createManualReminder, type CreatedReminder } from '../reminders/reminderService';

import { TeamInputError, newInviteCode } from './teamInput';

/**
 * Teams (Elite): a shared space for files. The service role bypasses RLS, so
 * EVERY read and write here checks membership first (roleIn) — that check is
 * the only thing between one team's files and everyone else (AGENTS §4).
 */

const BUCKET = 'team-files';
const SIGNED_URL_SECONDS = 60 * 60;

export type Role = 'owner' | 'admin' | 'member';

export class TeamAccessError extends Error {
  constructor(message = 'That team isn’t one of yours.') {
    super(message);
    this.name = 'TeamAccessError';
  }
}

export type TeamSummary = {
  id: string;
  name: string;
  purpose: string | null;
  role: Role;
  memberCount: number;
  fileCount: number;
  lastActivity: string;
  /** Only admins and the owner see the code behind the invite link. */
  inviteCode: string | null;
};

export type TeamMember = { userId: string; name: string; role: Role; joinedAt: string; isMe: boolean };

export type TeamFile = {
  id: string;
  teamId: string;
  kind: 'note' | 'research' | 'document' | 'photo';
  title: string;
  message: string | null;
  senderName: string;
  fromMe: boolean;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  /** Signed, short-lived link for stored files. */
  url: string | null;
  /** Notes and research carry their text. */
  body: string | null;
  /** True once a document's text has been read (for recall and Mr. Kandoo). */
  readable: boolean;
  createdAt: string;
};

export type TeamTask = {
  id: string;
  teamId: string;
  task: string;
  dueAt: string | null;
  senderName: string;
  fromMe: boolean;
  /** Where the current user is with it (null: it wasn't sent to them). */
  myStatus: 'sent' | 'accepted' | 'declined' | 'done' | null;
  counts: { sent: number; accepted: number; declined: number; done: number };
  createdAt: string;
};

const isAdmin = (role: Role | null) => role === 'owner' || role === 'admin';

/** The user's role in a team, or null if they aren't in it. */
export async function roleIn(userId: string, teamId: string): Promise<Role | null> {
  const { data, error } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.role as Role | undefined) ?? null;
}

async function requireRole(userId: string, teamId: string, admin = false): Promise<Role> {
  const role = await roleIn(userId, teamId);
  if (!role) throw new TeamAccessError();
  if (admin && !isAdmin(role)) throw new TeamAccessError('Only the team’s admins can do that.');
  return role;
}

// ── Teams and members ───────────────────────────────────────────────────────

export async function createTeam(
  userId: string,
  input: { name: string; purpose: string | null; displayName: string }
): Promise<TeamSummary> {
  let team: { id: string; created_at: string; invite_code: string } | null = null;
  // A fresh code collides about never; retry rather than assume.
  for (let attempt = 0; attempt < 3 && !team; attempt++) {
    const { data, error } = await supabase
      .from('teams')
      .insert({ name: input.name, purpose: input.purpose, owner_id: userId, invite_code: newInviteCode() })
      .select('id, created_at, invite_code')
      .single();
    if (error && error.code !== '23505') throw error;
    team = data;
  }
  if (!team) throw new Error('Could not create a unique invite code.');

  const { error: memberError } = await supabase
    .from('team_members')
    .insert({ team_id: team.id, user_id: userId, role: 'owner', display_name: input.displayName });
  if (memberError) {
    // Don't leave an ownerless team behind.
    await supabase.from('teams').delete().eq('id', team.id);
    throw memberError;
  }
  return {
    id: team.id,
    name: input.name,
    purpose: input.purpose,
    role: 'owner',
    memberCount: 1,
    fileCount: 0,
    lastActivity: team.created_at,
    inviteCode: team.invite_code,
  };
}

export async function listTeams(userId: string): Promise<TeamSummary[]> {
  const { data: mine, error } = await supabase.from('team_members').select('team_id, role').eq('user_id', userId);
  if (error) throw error;
  const ids = (mine ?? []).map((m) => m.team_id as string);
  if (ids.length === 0) return [];
  const roleOf = new Map((mine ?? []).map((m) => [m.team_id as string, m.role as Role]));

  const [teams, members, files] = await Promise.all([
    supabase.from('teams').select('id, name, purpose, invite_code, created_at').in('id', ids),
    supabase.from('team_members').select('team_id').in('team_id', ids),
    supabase.from('team_files').select('team_id, created_at').in('team_id', ids).order('created_at', { ascending: false }).limit(2000),
  ]);
  for (const r of [teams, members, files]) if (r.error) throw r.error;

  const count = (rows: { team_id: string }[] | null, id: string) => (rows ?? []).filter((r) => r.team_id === id).length;
  return (teams.data ?? [])
    .map((t) => {
      const role = roleOf.get(t.id) as Role;
      const latest = (files.data ?? []).find((f) => f.team_id === t.id)?.created_at as string | undefined;
      return {
        id: t.id as string,
        name: t.name as string,
        purpose: (t.purpose as string | null) ?? null,
        role,
        memberCount: count(members.data as { team_id: string }[], t.id),
        fileCount: count(files.data as { team_id: string }[], t.id),
        lastActivity: latest ?? (t.created_at as string),
        inviteCode: isAdmin(role) ? (t.invite_code as string) : null,
      };
    })
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

export async function getTeam(userId: string, teamId: string): Promise<{ team: TeamSummary; members: TeamMember[] }> {
  await requireRole(userId, teamId);
  const team = (await listTeams(userId)).find((t) => t.id === teamId);
  if (!team) throw new TeamAccessError();
  const { data, error } = await supabase
    .from('team_members')
    .select('user_id, display_name, role, joined_at')
    .eq('team_id', teamId)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  const order: Record<Role, number> = { owner: 0, admin: 1, member: 2 };
  const members = (data ?? [])
    .map((m) => ({
      userId: m.user_id as string,
      name: m.display_name as string,
      role: m.role as Role,
      joinedAt: m.joined_at as string,
      isMe: m.user_id === userId,
    }))
    .sort((a, b) => order[a.role] - order[b.role] || a.joinedAt.localeCompare(b.joinedAt));
  return { team, members };
}

/** Join by the code in an invite link. Joining twice is harmless. */
export async function joinTeam(userId: string, code: string, displayName: string): Promise<TeamSummary> {
  const { data: team, error } = await supabase.from('teams').select('id').eq('invite_code', code).maybeSingle();
  if (error) throw error;
  if (!team) throw new TeamInputError('That invite link isn’t valid any more. Ask the team admin for a new one.');
  if (!(await roleIn(userId, team.id))) {
    const { error: joinError } = await supabase
      .from('team_members')
      .insert({ team_id: team.id, user_id: userId, role: 'member', display_name: displayName });
    if (joinError && joinError.code !== '23505') throw joinError;
  }
  return (await getTeam(userId, team.id)).team;
}

export async function regenerateInvite(userId: string, teamId: string): Promise<string> {
  await requireRole(userId, teamId, true);
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newInviteCode();
    const { error } = await supabase.from('teams').update({ invite_code: code }).eq('id', teamId);
    if (!error) return code;
    if (error.code !== '23505') throw error;
  }
  throw new Error('Could not create a unique invite code.');
}

export async function setMemberRole(userId: string, teamId: string, memberId: string, role: 'admin' | 'member'): Promise<void> {
  if ((await requireRole(userId, teamId)) !== 'owner') throw new TeamAccessError('Only the team’s owner can change roles.');
  if (memberId === userId) throw new TeamInputError('The owner’s own role can’t change.');
  const { error } = await supabase.from('team_members').update({ role }).eq('team_id', teamId).eq('user_id', memberId);
  if (error) throw error;
}

export async function removeMember(userId: string, teamId: string, memberId: string): Promise<void> {
  await requireRole(userId, teamId, true);
  if ((await roleIn(memberId, teamId)) === 'owner') throw new TeamInputError('The owner can’t be removed.');
  const { error } = await supabase.from('team_members').delete().eq('team_id', teamId).eq('user_id', memberId);
  if (error) throw error;
}

/** Leave a team. The owner can only leave by deleting it, unless they hand it on first. */
export async function leaveTeam(userId: string, teamId: string): Promise<void> {
  const role = await requireRole(userId, teamId);
  if (role === 'owner') {
    throw new TeamInputError('You own this team. Delete it, or make someone else the owner first.');
  }
  const { error } = await supabase.from('team_members').delete().eq('team_id', teamId).eq('user_id', userId);
  if (error) throw error;
}

export async function deleteTeam(userId: string, teamId: string): Promise<void> {
  if ((await requireRole(userId, teamId)) !== 'owner') throw new TeamAccessError('Only the team’s owner can delete it.');
  const { data: stored } = await supabase.from('team_files').select('storage_path').eq('team_id', teamId).not('storage_path', 'is', null);
  const paths = (stored ?? []).map((f) => f.storage_path as string);
  if (paths.length) {
    const removed = await supabase.storage.from(BUCKET).remove(paths);
    if (removed.error) console.error('Removing a deleted team’s files failed:', removed.error);
  }
  const { error } = await supabase.from('teams').delete().eq('id', teamId);
  if (error) throw error;
}

async function displayNameIn(userId: string, teamId: string): Promise<string> {
  const { data } = await supabase.from('team_members').select('display_name').eq('team_id', teamId).eq('user_id', userId).maybeSingle();
  return (data?.display_name as string | undefined) ?? 'A teammate';
}

// ── Files ───────────────────────────────────────────────────────────────────

type FileRow = {
  id: string;
  team_id: string;
  sender_id: string;
  sender_name: string;
  kind: TeamFile['kind'];
  title: string;
  message: string | null;
  body: string | null;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  text_content: string | null;
  created_at: string;
};

const FILE_COLUMNS =
  'id, team_id, sender_id, sender_name, kind, title, message, body, storage_path, file_name, mime_type, size_bytes, text_content, created_at';

async function present(userId: string, rows: FileRow[]): Promise<TeamFile[]> {
  const paths = rows.map((r) => r.storage_path).filter((p): p is string => Boolean(p));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
    if (error) console.error('Signing team file links failed:', error);
    (data ?? []).forEach((d) => d.path && d.signedUrl && urls.set(d.path, d.signedUrl));
  }
  return rows.map((r) => ({
    id: r.id,
    teamId: r.team_id,
    kind: r.kind,
    title: r.title,
    message: r.message,
    senderName: r.sender_name,
    fromMe: r.sender_id === userId,
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    url: r.storage_path ? urls.get(r.storage_path) ?? null : null,
    body: r.body,
    readable: Boolean(r.text_content),
    createdAt: r.created_at,
  }));
}

/** Embed a file's text so members can recall it by meaning. Best-effort, reported. */
async function indexFile(fileId: string, text: string): Promise<void> {
  try {
    const [vector] = await withDeadline(aiProvider.embed([text.slice(0, 6000)], 'document'), 10_000, 'Team file embedding');
    if (!vector) throw new Error('no vector');
    const { error } = await supabase.from('team_files').update({ embedding: vector }).eq('id', fileId);
    if (error) throw error;
  } catch (error) {
    console.error('Indexing a team file failed (it is still found by its words):', error);
  }
}

export async function shareText(
  userId: string,
  teamId: string,
  input: { kind: 'note' | 'research'; title: string; body: string; message: string | null }
): Promise<TeamFile> {
  await requireRole(userId, teamId);
  const { data, error } = await supabase
    .from('team_files')
    .insert({
      team_id: teamId,
      sender_id: userId,
      sender_name: await displayNameIn(userId, teamId),
      kind: input.kind,
      title: input.title,
      message: input.message,
      body: input.body,
      text_content: input.body,
    })
    .select(FILE_COLUMNS)
    .single();
  if (error) throw error;
  void indexFile(data.id, `${input.title}\n${input.body}`);
  return (await present(userId, [data as FileRow]))[0];
}

/** Read a stored file's text, by type, for recall and Mr. Kandoo. Null when it has none. */
async function readText(bytes: Buffer, mime: string): Promise<string | null> {
  if (mime === 'text/plain') return bytes.toString('utf8');
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return (await mammoth.extractRawText({ buffer: bytes })).value;
  }
  if (mime === 'application/pdf' || mime.startsWith('image/')) {
    return aiProvider.extractFileText({ base64: bytes.toString('base64'), mimeType: mime });
  }
  return null; // slides, sheets, old .doc: stored and openable, not yet read
}

export async function uploadFile(
  userId: string,
  teamId: string,
  input: { bytes: Buffer; mime: string; ext: string; fileName: string; title: string; message: string | null }
): Promise<TeamFile> {
  await requireRole(userId, teamId);
  const path = `${teamId}/${randomUUID()}.${input.ext}`;
  const upload = await supabase.storage.from(BUCKET).upload(path, input.bytes, { contentType: input.mime, upsert: false });
  if (upload.error) throw upload.error;

  const { data, error } = await supabase
    .from('team_files')
    .insert({
      team_id: teamId,
      sender_id: userId,
      sender_name: await displayNameIn(userId, teamId),
      kind: input.mime.startsWith('image/') ? 'photo' : 'document',
      title: input.title,
      message: input.message,
      storage_path: path,
      file_name: input.fileName,
      mime_type: input.mime,
      size_bytes: input.bytes.length,
    })
    .select(FILE_COLUMNS)
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }

  // Reading a 30-page PDF can take a while: do it after replying. The file is
  // shared either way; only its searchability waits.
  void (async () => {
    try {
      const text = (await readText(input.bytes, input.mime))?.trim();
      if (!text) return;
      const { error: textError } = await supabase.from('team_files').update({ text_content: text.slice(0, 60000) }).eq('id', data.id);
      if (textError) throw textError;
      await indexFile(data.id, `${input.title}\n${text}`);
    } catch (readError) {
      console.error('Reading a shared team file failed (it is still shared):', readError);
    }
  })();

  return (await present(userId, [data as FileRow]))[0];
}

export async function listFiles(userId: string, teamId: string, query: string | null): Promise<TeamFile[]> {
  await requireRole(userId, teamId);
  let request = supabase.from('team_files').select(FILE_COLUMNS).eq('team_id', teamId).order('created_at', { ascending: false }).limit(100);
  // PostgREST filter syntax: commas, parentheses, quotes and wildcards in the
  // words would change the filter, so only plain words go in.
  const words = (query ?? '').replace(/[,()"'\\%*_.:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (words) request = request.or(`title.ilike.%${words}%,text_content.ilike.%${words}%,sender_name.ilike.%${words}%`);
  const { data, error } = await request;
  if (error) throw error;
  return present(userId, (data ?? []) as FileRow[]);
}

/** One file, with its full text for reading (Mr. Kandoo, the reader). */
export async function getFile(userId: string, fileId: string): Promise<{ file: TeamFile; text: string | null; teamName: string }> {
  const { data, error } = await supabase.from('team_files').select(FILE_COLUMNS).eq('id', fileId).maybeSingle();
  if (error) throw error;
  if (!data) throw new TeamAccessError('That file isn’t there any more.');
  await requireRole(userId, data.team_id as string);
  const { data: team } = await supabase.from('teams').select('name').eq('id', data.team_id).maybeSingle();
  return {
    file: (await present(userId, [data as FileRow]))[0],
    text: (data.text_content as string | null) ?? null,
    teamName: (team?.name as string | undefined) ?? 'Team',
  };
}

export async function deleteFile(userId: string, fileId: string): Promise<void> {
  const { data, error } = await supabase.from('team_files').select('team_id, sender_id, storage_path').eq('id', fileId).maybeSingle();
  if (error) throw error;
  if (!data) return;
  const role = await requireRole(userId, data.team_id as string);
  if (data.sender_id !== userId && !isAdmin(role)) throw new TeamAccessError('Only the sender or an admin can remove it.');
  if (data.storage_path) {
    const removed = await supabase.storage.from(BUCKET).remove([data.storage_path as string]);
    if (removed.error) console.error('Removing a team file from storage failed:', removed.error);
  }
  const { error: deleteError } = await supabase.from('team_files').delete().eq('id', fileId);
  if (deleteError) throw deleteError;
}

// ── Tasks ───────────────────────────────────────────────────────────────────

export async function sendTask(
  userId: string,
  teamId: string,
  input: { task: string; dueAt: string | null; assigneeId: string | null }
): Promise<TeamTask> {
  await requireRole(userId, teamId, true);
  const { data: members, error: membersError } = await supabase.from('team_members').select('user_id').eq('team_id', teamId);
  if (membersError) throw membersError;
  const everyone = (members ?? []).map((m) => m.user_id as string);
  if (input.assigneeId && !everyone.includes(input.assigneeId)) throw new TeamInputError('That person isn’t in this team.');
  const recipients = input.assigneeId ? [input.assigneeId] : everyone.filter((id) => id !== userId);
  if (recipients.length === 0) throw new TeamInputError('There’s no one else in the team yet. Invite someone first.');

  const { data: task, error } = await supabase
    .from('team_tasks')
    .insert({ team_id: teamId, sender_id: userId, sender_name: await displayNameIn(userId, teamId), task: input.task, due_at: input.dueAt })
    .select('id, team_id, task, due_at, sender_name, created_at')
    .single();
  if (error) throw error;
  const { error: statusError } = await supabase
    .from('team_task_status')
    .insert(recipients.map((id) => ({ task_id: task.id, user_id: id, status: 'sent' })));
  if (statusError) {
    await supabase.from('team_tasks').delete().eq('id', task.id);
    throw statusError;
  }
  return (await listTasks(userId, teamId)).find((t) => t.id === task.id) as TeamTask;
}

export async function listTasks(userId: string, teamId: string): Promise<TeamTask[]> {
  await requireRole(userId, teamId);
  const { data: tasks, error } = await supabase
    .from('team_tasks')
    .select('id, team_id, sender_id, sender_name, task, due_at, created_at')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  const ids = (tasks ?? []).map((t) => t.id as string);
  if (ids.length === 0) return [];
  const { data: statuses, error: statusError } = await supabase.from('team_task_status').select('task_id, user_id, status').in('task_id', ids);
  if (statusError) throw statusError;
  return (tasks ?? []).map((t) => {
    const mine = (statuses ?? []).filter((s) => s.task_id === t.id);
    const counts = { sent: 0, accepted: 0, declined: 0, done: 0 };
    mine.forEach((s) => (counts[s.status as keyof typeof counts] += 1));
    return {
      id: t.id as string,
      teamId: t.team_id as string,
      task: t.task as string,
      dueAt: (t.due_at as string | null) ?? null,
      senderName: t.sender_name as string,
      fromMe: t.sender_id === userId,
      myStatus: (mine.find((s) => s.user_id === userId)?.status as TeamTask['myStatus']) ?? null,
      counts,
      createdAt: t.created_at as string,
    };
  });
}

/** Tasks sent to this user that they haven't answered yet, across their teams. */
export async function taskInbox(userId: string): Promise<(TeamTask & { teamName: string })[]> {
  const { data, error } = await supabase.from('team_task_status').select('task_id').eq('user_id', userId).eq('status', 'sent').limit(50);
  if (error) throw error;
  const ids = (data ?? []).map((s) => s.task_id as string);
  if (ids.length === 0) return [];
  const { data: tasks, error: taskError } = await supabase.from('team_tasks').select('team_id').in('id', ids);
  if (taskError) throw taskError;
  const teamIds = [...new Set((tasks ?? []).map((t) => t.team_id as string))];
  const { data: teams } = await supabase.from('teams').select('id, name').in('id', teamIds);
  const out: (TeamTask & { teamName: string })[] = [];
  for (const teamId of teamIds) {
    if (!(await roleIn(userId, teamId))) continue; // left the team since
    const name = (teams ?? []).find((t) => t.id === teamId)?.name as string;
    (await listTasks(userId, teamId)).filter((t) => ids.includes(t.id)).forEach((t) => out.push({ ...t, teamName: name }));
  }
  return out;
}

async function myTaskRow(userId: string, taskId: string) {
  const { data: task, error } = await supabase.from('team_tasks').select('id, team_id, task, due_at, sender_name').eq('id', taskId).maybeSingle();
  if (error) throw error;
  if (!task) throw new TeamAccessError('That task isn’t there any more.');
  await requireRole(userId, task.team_id as string);
  const { data: status } = await supabase.from('team_task_status').select('status').eq('task_id', taskId).eq('user_id', userId).maybeSingle();
  if (!status) throw new TeamAccessError('That task wasn’t sent to you.');
  return task;
}

/**
 * Accept: the task becomes the user's OWN reminder, which the phone schedules
 * (the device owns triggers — AGENTS §3.2). Decline: noted for the admin.
 */
export async function respondToTask(userId: string, taskId: string, accept: boolean): Promise<{ reminder: CreatedReminder | null }> {
  const task = await myTaskRow(userId, taskId);
  let reminder: CreatedReminder | null = null;
  if (accept) {
    reminder = await createManualReminder(userId, {
      task: task.task as string,
      dueAt: (task.due_at as string | null) ?? null,
      person: task.sender_name as string,
    });
  }
  const { error } = await supabase
    .from('team_task_status')
    .update({ status: accept ? 'accepted' : 'declined', reminder_id: reminder?.id ?? null, updated_at: new Date().toISOString() })
    .eq('task_id', taskId)
    .eq('user_id', userId);
  if (error) throw error;
  return { reminder };
}

export async function markTaskDone(userId: string, taskId: string): Promise<void> {
  await myTaskRow(userId, taskId);
  const { error } = await supabase
    .from('team_task_status')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .eq('task_id', taskId)
    .eq('user_id', userId);
  if (error) throw error;
}
