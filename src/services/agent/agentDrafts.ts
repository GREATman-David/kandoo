import { userMessage } from '@/services/interpretationService';
import type { LatLng } from '@/utils/geo';

/**
 * Kandoo Agent's drafts. Nothing the agent proposes is saved until the user
 * agrees (AGENTS §3.3): every change first appears as a card in the
 * conversation, which the user can edit, then saves on a spoken yes (the agent
 * calls save_draft) or a tap on Save.
 *
 * The review rule is enforced HERE, not only in the prompt: the agent may only
 * save a draft after the user has spoken since it appeared — it can't approve
 * its own proposal in the same breath.
 */

export type DraftFieldKind = 'text' | 'long' | 'time';

export type DraftField = {
  key: string;
  label: string;
  value: string | null;
  kind: DraftFieldKind;
  editable: boolean;
};

/** A place's outline, for the card's map preview. */
export type DraftShape = { center: LatLng; radiusM: number; area?: LatLng[] | null };

export type DraftStatus = 'draft' | 'saving' | 'saved' | 'discarded' | 'failed';

export type Draft = {
  id: string;
  tool: string;
  /** "New reminder", "Delete memory" … */
  title: string;
  destructive: boolean;
  fields: DraftField[];
  shape: DraftShape | null;
  status: DraftStatus;
  error: string | null;
  createdAt: number;
  /** Where the saved thing lives in the app, for the card's Open link. */
  open: { pathname: string; params?: Record<string, string> } | null;
};

export type DraftValues = Record<string, string | null>;

/** What saving does. Returns a small object the agent reads back. */
export type DraftCommit = (
  values: DraftValues,
  shape: DraftShape | null
) => Promise<{ result: Record<string, unknown>; open?: Draft['open'] }>;

type Proposal = Pick<Draft, 'tool' | 'title' | 'destructive' | 'fields'> & {
  shape?: DraftShape | null;
  commit: DraftCommit;
};

let drafts: Draft[] = [];
const commits = new Map<string, DraftCommit>();
const listeners = new Set<(drafts: Draft[]) => void>();
let lastUserSpokeAt = 0;
let counter = 0;

function emit() {
  drafts = [...drafts];
  listeners.forEach((listener) => listener(drafts));
}

function patch(id: string, change: Partial<Draft>) {
  drafts = drafts.map((d) => (d.id === id ? { ...d, ...change } : d));
  emit();
}

export function subscribeDrafts(listener: (drafts: Draft[]) => void): () => void {
  listeners.add(listener);
  listener(drafts);
  return () => {
    listeners.delete(listener);
  };
}

export function getDraft(id: string): Draft | undefined {
  return drafts.find((d) => d.id === id);
}

/** A fresh conversation starts with no cards. */
export function resetDrafts(): void {
  drafts = [];
  commits.clear();
  lastUserSpokeAt = 0;
  emit();
}

/** The conversation screen calls this for every user turn (spoken or typed). */
export function markUserSpoke(): void {
  lastUserSpokeAt = Date.now();
}

export function proposeDraft(proposal: Proposal): Draft {
  counter += 1;
  const draft: Draft = {
    id: `d${counter}`,
    tool: proposal.tool,
    title: proposal.title,
    destructive: proposal.destructive,
    fields: proposal.fields,
    shape: proposal.shape ?? null,
    status: 'draft',
    error: null,
    createdAt: Date.now(),
    open: null,
  };
  commits.set(draft.id, proposal.commit);
  drafts = [...drafts, draft];
  emit();
  return draft;
}

export function editDraftField(id: string, key: string, value: string | null): void {
  const draft = getDraft(id);
  if (!draft || draft.status !== 'draft') return;
  patch(id, { fields: draft.fields.map((f) => (f.key === key && f.editable ? { ...f, value } : f)) });
}

export function setDraftShape(id: string, shape: DraftShape): void {
  const draft = getDraft(id);
  if (!draft || draft.status !== 'draft') return;
  patch(id, { shape });
}

export function discardDraft(id: string): boolean {
  const draft = getDraft(id);
  if (!draft || draft.status !== 'draft') return false;
  commits.delete(id);
  patch(id, { status: 'discarded' });
  return true;
}

export type SaveOutcome =
  | { ok: true; result: Record<string, unknown>; alreadySaved?: boolean }
  | { ok: false; error: string };

/**
 * Save a draft with its current (possibly edited) values.
 * `by: 'agent'` requires the user to have spoken since the card appeared.
 */
export async function saveDraft(id: string, by: 'agent' | 'user'): Promise<SaveOutcome> {
  const draft = getDraft(id);
  if (!draft) return { ok: false, error: 'There is no card with that id.' };
  if (draft.status === 'saved') return { ok: true, result: {}, alreadySaved: true };
  if (draft.status === 'discarded') return { ok: false, error: 'That card was discarded.' };
  if (draft.status === 'saving') return { ok: false, error: 'That card is already being saved.' };
  if (by === 'agent' && lastUserSpokeAt < draft.createdAt) {
    return { ok: false, error: 'Not saved: ask the user if the card looks right, and save only after they say yes.' };
  }
  const commit = commits.get(id);
  if (!commit) return { ok: false, error: 'That card can no longer be saved.' };

  patch(id, { status: 'saving', error: null });
  const values = Object.fromEntries(draft.fields.map((f) => [f.key, f.value]));
  try {
    const { result, open } = await commit(values, draft.shape);
    commits.delete(id);
    patch(id, { status: 'saved', open: open ?? null });
    return { ok: true, result };
  } catch (error) {
    // Reported to the caller (the tool turns it into words); the card offers a retry.
    console.warn('Saving an agent draft failed:', error);
    const message = userMessage(error, 'That did not save just now.');
    patch(id, { status: 'draft', error: message });
    return { ok: false, error: message };
  }
}

/** How a draft reads to the agent: its title and field values. */
export function describeDraft(draft: Draft): Record<string, unknown> {
  return {
    draft_id: draft.id,
    card: draft.title,
    ...Object.fromEntries(draft.fields.filter((f) => f.value).map((f) => [f.key, f.value])),
  };
}
