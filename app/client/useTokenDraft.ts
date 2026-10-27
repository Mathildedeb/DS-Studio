import { useEffect, useState } from 'react';
import type { TokenKey, TokenValue } from '../shared/model.js';

const storageKey = 'ds-studio-token-draft-v2';
export function useTokenDraft(key: TokenKey, current: TokenValue | undefined) {
  const [draft, setDraft] = useState('');
  const [recovered, setRecovered] = useState(false);
  useEffect(() => {
    if (current === undefined) return;
    let value = String(current);
    let restored = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (
        saved?.key === key &&
        typeof saved.value === 'string' &&
        saved.value.length <= 100 &&
        saved.value !== value
      ) {
        value = saved.value;
        restored = true;
      }
    } catch {
      /* Le stockage navigateur est facultatif, jamais le disque de référence. */
    }
    setDraft(value);
    setRecovered(restored);
  }, [key, current]);
  function update(value: string) {
    setDraft(value);
    setRecovered(false);
    try {
      if (value === String(current)) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify({ key, value }));
    } catch {
      /* Mode privé / stockage refusé : édition en mémoire seulement. */
    }
  }
  function discard() {
    update(String(current ?? ''));
  }
  return { draft, setDraft: update, recovered, discard };
}
