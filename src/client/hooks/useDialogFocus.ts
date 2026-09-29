import { type RefObject, useEffect, useRef } from 'react';

/**
 * A dialog that takes the focus when it opens and gives it back when it
 * closes, to whatever had it, while that is still on the page. Proposals and
 * the docs opened with the focus left on the page behind them, so Tab walked
 * some seventy stops of the map before it reached either, and the finder
 * dropped the focus on the body when it closed.
 *
 * The ref goes on the dialog, which takes the focus itself (tabIndex -1)
 * unless `first` names a control inside it to start on.
 */
export function useDialogFocus<T extends HTMLElement>(
  open: boolean,
  first?: RefObject<HTMLElement | null>
): RefObject<T | null> {
  const dialog = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | SVGElement | null;
    (first?.current ?? dialog.current)?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [open, first]);
  return dialog;
}
