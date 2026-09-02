import { useCallback, useEffect, useState } from 'react';

const SEEN_KEY = 'cg.seenGuide';

/**
 * The first-run guide. Shown once, for real configs as well as the demo — it
 * used to fire only after LOAD DEMO, so the normal path taught nothing. A link
 * can switch it off (`?guide=off`), which counts as having seen it.
 */
export function useGuide(offByLink: boolean) {
  const [showGuide, setShowGuide] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const dismissGuide = useCallback(() => {
    setShowGuide(false);
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* private mode */
    }
  }, []);
  useEffect(() => {
    if (offByLink) dismissGuide();
  }, [offByLink, dismissGuide]);
  return { showGuide, dismissGuide };
}
