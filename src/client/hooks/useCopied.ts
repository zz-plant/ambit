import { useCallback, useEffect, useState } from 'react';

/**
 * A copy button's two seconds of "Copied".
 *
 * Four components each kept their own `copied` state and their own
 * `setTimeout` to clear it, with the delay agreeing in three of them. The key
 * says which of several buttons was pressed, so one hook serves a list; the
 * timer is cleared on unmount, which none of the four did.
 */
export function useCopied(ms = 2000) {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), ms);
    return () => clearTimeout(t);
  }, [copied, ms]);
  const copy = useCallback((key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
  }, []);
  return [copied, copy] as const;
}
