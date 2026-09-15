import { useEffect, useState } from 'react';

/** Matches the mobile breakpoint in App.css, where the panels become sheets. */
const NARROW = '(max-width: 768px)';

/** Whether this document is on a narrow screen, read once and kept current. */
export function isNarrowScreen(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(NARROW).matches;
}

/**
 * Whether the screen is narrow.
 *
 * On a phone the map is a wall of nodes at forty percent and the detail panel
 * is a bottom sheet, so the shell lands narrow screens on My Setup, a list,
 * and keeps the map one tap away.
 */
export function useNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState(isNarrowScreen);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(NARROW);
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isNarrow;
}
