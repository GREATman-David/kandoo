import type { Photo } from '@/services/interpretationService';

/**
 * What Mr. Kandoo SHOWS in the conversation besides cards: photos he found
 * (find_photos). The tool runs outside React, so this is a tiny store the
 * conversation screen subscribes to — the same pattern as the draft store.
 */

export type Shown = { id: string; photos: Photo[]; at: number };

let shown: Shown[] = [];
const listeners = new Set<(items: Shown[]) => void>();
let seq = 0;

function emit() {
  for (const listener of listeners) listener(shown);
}

export function showPhotos(photos: Photo[]): void {
  if (photos.length === 0) return;
  shown = [...shown, { id: `shown-${(seq += 1)}`, photos, at: Date.now() }];
  emit();
}

export function subscribeShown(listener: (items: Shown[]) => void): () => void {
  listeners.add(listener);
  listener(shown);
  return () => {
    listeners.delete(listener);
  };
}

/** A new conversation starts with nothing shown. */
export function resetShown(): void {
  shown = [];
  emit();
}
