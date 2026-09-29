import { useEffect } from 'react';
import { typingIn } from '../utils/keys';
import { useLatest } from './useLatest';

interface Hotkeys {
  /** `/`: open the finder. */
  openSearch: () => void;
  /** `?`: toggle the docs overlay. */
  toggleDocs: () => void;
  /** `g`: toggle the proposals panel. */
  toggleGovernance: () => void;
  /** `Esc`: close one thing, the one `escapeLayer` (utils/keys.ts) names. */
  escape: () => void;
}

/**
 * The global hotkeys. Inside a field only Escape does anything, and there it
 * blurs the field instead of clearing the selection behind it.
 */
export function useHotkeys(keys: Hotkeys) {
  const latest = useLatest(keys);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const k = latest.current;
      const target = e.target as HTMLElement;
      if (typingIn(target)) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        k.openSearch();
      } else if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        k.toggleDocs();
      } else if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        k.toggleGovernance();
      } else if (e.key === 'Escape') {
        k.escape();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [latest]);
}
