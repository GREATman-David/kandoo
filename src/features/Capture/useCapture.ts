import { useState } from 'react';

import { saveCapture } from '../../services/captureService';
import type { Capture } from './types';

export function useCapture() {
  const [items, setItems] = useState<Capture[]>([]);

  async function addCapture(text: string) {
    const trimmedText = text.trim();

    if (!trimmedText) {
      return;
    }

    const newCapture: Capture = {
      text: trimmedText,
      createdAt: new Date().toISOString(),
    };

    await saveCapture(newCapture);

    setItems((currentItems) => [
      ...currentItems,
      newCapture,
    ]);
  }

  return {
    items,
    addCapture,
  };
}