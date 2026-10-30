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
 * How much of `ref` a card laid over it covers, along each edge it rests on:
 * the tour, the readout, a detail panel that became a bottom sheet.
 *
 * `bottom` counts a card spanning most of the width and resting on the bottom
 * edge, a sheet on a phone. `right` counts a card in the right corner, as the
 * tour and the readout sit on a wider screen: it covers the map's last
 * columns, where an outage ends and where Hosting is, so the map needs that
 * much room to scroll them out from under it. Re-measured when a card mounts,
 * resizes or leaves, which is also when a tour step changes its text.
 */
export function useOcclusion(ref: RefObject<HTMLElement | null>): {
  bottom: number;
  right: number;
} {
  const [covered, setCovered] = useState({ bottom: 0, right: 0 });
  useEffect(() => {
    const host = ref.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const observed = new Set<Element>();
    const sizes = new ResizeObserver(() => schedule());
    const measure = () => {
      const box = host.getBoundingClientRect();
      let bottom = 0;
      let right = 0;
      for (const el of document.querySelectorAll(`[${OCCLUDES_MAP}]`)) {
        if (!observed.has(el)) {
          observed.add(el);
          sizes.observe(el);
        }
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.top >= box.bottom) continue;
        const across = Math.min(r.right, box.right) - Math.max(r.left, box.left);
        // Anchored to the bottom edge; a headline at the top is not a sheet.
        const onBottom = r.bottom >= box.bottom - 48 && r.top > box.top + box.height * 0.25;
        if (across >= box.width * 0.6) {
          if (onBottom) bottom = Math.max(bottom, box.bottom - r.top);
        } else if (
          r.right >= box.right - 48 &&
          r.left > box.left &&
          // A card in the corner, not the detail panel, which runs the
          // canvas's full height and has a padding of its own already.
          r.height < box.height * 0.85
        ) {
          right = Math.max(right, box.right - r.left);
        }
      }
      const next = { bottom: Math.round(bottom), right: Math.round(right) };
      setCovered(prev => (prev.bottom === next.bottom && prev.right === next.right ? prev : next));
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
