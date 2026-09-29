import { useEffect } from 'react';
import { pageKey, typingIn } from '../utils/keys';
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
      // A key held with Ctrl, Cmd or Alt is the browser's: see pageKey.
      const key = pageKey(e);
      if (key === 'search') {
        e.preventDefault();
        k.openSearch();
      } else if (key === 'docs') {
        e.preventDefault();
        k.toggleDocs();
      } else if (key === 'proposals') {
        e.preventDefault();
        k.toggleGovernance();
      } else if (key === 'escape') {
        k.escape();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [latest]);
}
