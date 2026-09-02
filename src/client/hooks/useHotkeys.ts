import { useEffect } from 'react';
import { useLatest } from './useLatest';

interface Hotkeys {
  /** `/` — open the console and focus its search box. */
  openSearch: () => void;
  /** `\` — toggle the console. */
  toggleSidebar: () => void;
  /** `?` — toggle the docs overlay. */
  toggleDocs: () => void;
  /** `g` — toggle the proposals panel. */
  toggleGovernance: () => void;
  /** `Esc` — close whatever is open and clear the selection. */
  escape: () => void;
}

/**
 * The global hotkeys. Inside an input only Escape does anything, and there it
 * blurs the field rather than clearing the selection behind it.
 */
export function useHotkeys(keys: Hotkeys) {
  const latest = useLatest(keys);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const k = latest.current;
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        k.openSearch();
      } else if (e.key === '\\') {
        e.preventDefault();
        k.toggleSidebar();
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
