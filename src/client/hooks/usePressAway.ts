import { type RefObject, useEffect } from 'react';

/**
 * Calls `onAway` on a press anywhere outside `box`, for a panel opened from a
 * button. A press on whatever `toggle` matches is left alone: that button
 * closes the panel by its own click, and closing it here first would have the
 * click open it again.
 */
export function usePressAway(
  box: RefObject<HTMLElement | null>,
  onAway: (() => void) | undefined,
  toggle: string
): void {
  useEffect(() => {
    if (!onAway) return;
    const away = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (box.current?.contains(target) || target?.closest?.(toggle)) return;
      onAway();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [box, onAway, toggle]);
}
