import { type RefObject, useEffect, useState } from 'react';

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

/** What a card laid over the map marks itself with, so the map can see around it. */
export const OCCLUDES_MAP = 'data-occludes-map';

/**
 * How many pixels at the bottom of `ref` are covered by a card laid across it:
 * the tour, the first-run card, a detail panel that became a bottom sheet.
 * Only a card spanning most of the width and resting on the bottom edge
 * counts, since a card in one corner leaves the rest of the map in view. Re-measured when a card mounts, resizes
 * or leaves, which is also when a tour step changes its text.
 */
export function useBottomOcclusion(ref: RefObject<HTMLElement | null>): number {
  const [covered, setCovered] = useState(0);
  useEffect(() => {
    const host = ref.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const observed = new Set<Element>();
    const sizes = new ResizeObserver(() => schedule());
    const measure = () => {
      const box = host.getBoundingClientRect();
      let most = 0;
      for (const el of document.querySelectorAll(`[${OCCLUDES_MAP}]`)) {
        if (!observed.has(el)) {
          observed.add(el);
          sizes.observe(el);
        }
        const r = el.getBoundingClientRect();
        const across = Math.min(r.right, box.right) - Math.max(r.left, box.left);
        if (r.height === 0 || across < box.width * 0.6) continue;
        // Anchored to the bottom edge; a headline at the top is not a sheet.
        if (r.bottom < box.bottom - 48 || r.top <= box.top + box.height * 0.25) continue;
        if (r.top >= box.bottom) continue;
        most = Math.max(most, box.bottom - r.top);
      }
      setCovered(Math.round(most));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const tree = new MutationObserver(schedule);
    tree.observe(document.body, { childList: true, subtree: true });
    sizes.observe(host);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      tree.disconnect();
      sizes.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [ref]);
  return covered;
}
