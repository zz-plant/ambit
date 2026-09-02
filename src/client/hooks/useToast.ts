import { useEffect, useState } from 'react';

/**
 * A transient notice — an approval minted in the browser broker, a proposal
 * drafted — so the negotiation surface speaks even while the graph is the
 * focus. Clears itself after a few seconds.
 */
export function useToast(ms = 6000) {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(t);
  }, [toast, ms]);
  return [toast, setToast] as const;
}
