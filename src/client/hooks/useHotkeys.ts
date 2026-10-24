import { useEffect } from 'react';
import { pageKey, typingIn } from '../utils/keys';
import { useLatest } from './useLatest';

interface Hotkeys {
  /** `/`: open the finder. */
  openSearch: () => void;
  /** `?`: toggle the docs overlay. */
  toggleDocs: () => void;
  /** `g`: go to the Proposals view, and back to the map from there. */
  proposals: () => void;
  /** `[` and `]`: step to the previous or next view. */
  viewStep: (dir: 1 | -1) => void;
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
        k.proposals();
      } else if (key === 'viewPrev') {
        e.preventDefault();
        k.viewStep(-1);
      } else if (key === 'viewNext') {
        e.preventDefault();
        k.viewStep(1);
      } else if (key === 'escape') {
        k.escape();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [latest]);
}
