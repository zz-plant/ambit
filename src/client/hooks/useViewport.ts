import { useEffect, useState } from 'react';

/** Matches the mobile breakpoint in App.css, where the panels become sheets. */
const NARROW = '(max-width: 768px)';

/**
 * Whether the screen is narrow, and whether the left console is open.
 *
 * The console is 340px of absolutely-positioned overlay. On a phone that is
 * the whole screen: it covered the landing page, including the button that
 * loads the demo, so the published demo was unusable on the device most
 * people follow a link from. Narrow screens start with it closed, and it opens
 * as a bottom sheet rather than a left rail. On medium screens it also closes
 * when a node is selected, so the detail panel does not squeeze the map.
 */
export function useViewport(selectedId: string | null) {
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW).matches
  );
  const [leftOpen, setLeftOpen] = useState(() => !isNarrow);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(NARROW);
    const onChange = (e: MediaQueryListEvent) => {
      setIsNarrow(e.matches);
      setLeftOpen(!e.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (selectedId && typeof window !== 'undefined' && window.innerWidth < 1200 && !isNarrow) {
      setLeftOpen(false);
    }
  }, [selectedId, isNarrow]);

  return { isNarrow, leftOpen, setLeftOpen };
}
