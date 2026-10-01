import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';

/**
 * Documents in and out of Kandoo: pick a file to share with a team, and open
 * a file (or a note exported as Word) in the app that edits it — Microsoft
 * Word for .docx, the PDF viewer for a PDF. Android opens files through a
 * VIEW intent with a content:// URI it can grant read access to.
 */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** What a team can share (mirrors the backend's FILE_TYPES). */
export const SHAREABLE_TYPES = [
  'application/pdf',
  DOCX_MIME,
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'image/jpeg',
  'image/png',
];

const MAX_BYTES = 15 * 1024 * 1024;
const FLAG_GRANT_READ_URI_PERMISSION = 1;

export class DocumentTooLargeError extends Error {
  constructor() {
    super('That file is over 15 MB — too large to share here.');
    this.name = 'DocumentTooLargeError';
  }
}

export type PickedDocument = { name: string; mimeType: string; base64: string; size: number };

/** Choose one document from the phone. Null if the user backs out. */
export async function pickDocument(): Promise<PickedDocument | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: SHAREABLE_TYPES, copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  if (asset.size && asset.size > MAX_BYTES) throw new DocumentTooLargeError();
  const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
  return {
    name: asset.name,
    mimeType: asset.mimeType ?? 'application/octet-stream',
    base64,
    size: asset.size ?? Math.round((base64.length * 3) / 4),
  };
}

function cachePath(fileName: string): string {
  const safe = fileName.replace(/[^\p{L}\p{N} _().-]/gu, '').trim() || 'document';
  return `${FileSystem.cacheDirectory}${Date.now()}-${safe}`;
}

/** Hand a local file to the app that opens its type; fall back to the share sheet. */
async function openLocal(localUri: string, mimeType: string): Promise<void> {
  try {
    const contentUri = await FileSystem.getContentUriAsync(localUri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: mimeType,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
  } catch (error) {
    // No app registered for the type (no Word installed): let the user choose.
    console.warn('Opening the file directly failed; offering the share sheet:', error);
    if (!(await Sharing.isAvailableAsync())) throw error;
    await Sharing.shareAsync(localUri, { mimeType, dialogTitle: 'Open with' });
  }
}

/** Download a file (a signed link, or an authenticated API route) and open it. */
export async function downloadAndOpen(input: {
  url: string;
  fileName: string;
  mimeType: string;
  /** For API routes (Word export): the user's bearer token. */
  accessToken?: string;
}): Promise<void> {
  const target = cachePath(input.fileName);
  const result = await FileSystem.downloadAsync(input.url, target, {
    headers: input.accessToken ? { Authorization: `Bearer ${input.accessToken}` } : undefined,
  });
  if (result.status !== 200) {
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
    throw new Error(`Download failed (${result.status}).`);
  }
  await openLocal(result.uri, input.mimeType);
}
