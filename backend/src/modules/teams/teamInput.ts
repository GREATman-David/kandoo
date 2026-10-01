import { randomBytes } from 'node:crypto';

/**
 * What Teams accepts from the phone. Pure, so the rules are tested without a
 * database; limits mirror 013_teams.sql.
 */

export class TeamInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamInputError';
  }
}

export const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** What a member may upload, by MIME type, and how it is shown. */
export const FILE_TYPES: Record<string, { ext: string; label: string }> = {
  'application/pdf': { ext: 'pdf', label: 'PDF' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', label: 'Word' },
  'application/msword': { ext: 'doc', label: 'Word' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: 'pptx', label: 'Slides' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', label: 'Sheet' },
  'text/plain': { ext: 'txt', label: 'Text' },
  'image/jpeg': { ext: 'jpg', label: 'Photo' },
  'image/png': { ext: 'png', label: 'Image' },
};

function oneLine(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function cleanTeamName(value: unknown): string {
  const name = oneLine(value);
  if (!name) throw new TeamInputError('Give the team a name.');
  if (name.length > 80) throw new TeamInputError('Keep the team name under 80 characters.');
  return name;
}

export function cleanOptional(value: unknown, max: number, what: string): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  if (text.length > max) throw new TeamInputError(`Keep the ${what} under ${max} characters.`);
  return text;
}

export function cleanDisplayName(value: unknown, fallback: string): string {
  const name = oneLine(value) || oneLine(fallback) || 'A teammate';
  return name.slice(0, 60);
}

/**
 * Join codes: 8 characters from an alphabet with no look-alikes (no 0/O, 1/I/L),
 * so a code read aloud or typed from a screenshot just works.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newInviteCode(): string {
  const bytes = randomBytes(8);
  let code = '';
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

/** "abcd-2345 " → "ABCD2345"; null if it can't be a code. */
export function normaliseInviteCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{8}$/.test(code) ? code : null;
}

/** A file name safe for a storage path and a download header. */
export function safeFileName(name: unknown, ext: string): string {
  const base = (typeof name === 'string' ? name : 'file')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[^\p{L}\p{N} _().-]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+/, '')
    .trim()
    .slice(0, 80);
  return `${base || 'file'}.${ext}`;
}

/** Decode an upload; refuses unknown types and oversized files before decoding. */
export function decodeUpload(base64: unknown, mimeType: unknown): { bytes: Buffer; mime: string; ext: string; label: string } {
  if (typeof mimeType !== 'string' || !FILE_TYPES[mimeType]) {
    throw new TeamInputError('That kind of file can’t be shared yet. PDFs, Word, slides, sheets, text and images can.');
  }
  if (typeof base64 !== 'string' || !base64) throw new TeamInputError('The file didn’t come through. Try again.');
  if ((base64.length * 3) / 4 > MAX_FILE_BYTES + 4) {
    throw new TeamInputError('That file is over 15 MB — too large to share here.');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) throw new TeamInputError('The file is empty.');
  return { bytes, mime: mimeType, ...FILE_TYPES[mimeType] };
}
