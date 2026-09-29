/**
 * The page's rules for keys, apart from any listener that applies them: what
 * one press of Escape closes, where the page's own keys stand aside, and where
 * Tab goes inside a dialog. Free of the DOM's types, so the rules are checked
 * and tested with the client's other pure code.
 */

/** What one press of Escape closes. */
export type EscapeLayer =
  | 'docs'
  | 'proposals'
  | 'finder'
  | 'spotlight'
  | 'simulation'
  | 'selection';

/** What is open when Escape is pressed. */
export interface EscapeState {
  docs: boolean;
  proposals: boolean;
  finder: boolean;
  /** Whether the map is the view on screen: its spotlight and simulation are drawn nowhere else. */
  onMap: boolean;
  spotlight: boolean;
  simulation: boolean;
  /** A node, or an era's ladder, open in the detail panel. */
  selection: boolean;
}

/**
 * The one thing a press of Escape closes.
 *
 * The shell and the map each listened for Escape, and whichever ran second
 * found the first one's work already done: the shell cleared the selection,
 * the re-render took the map's listener away, and the map's own order
 * (spotlight, then simulation, then selection) came out reversed. One press
 * could also close two things, the docs and the selection behind them. Now one
 * owner asks this, and a press closes one layer: the topmost overlay first,
 * then the map's layers in their order. Clearing the selection ends a focus
 * and closes an era's ladder with it, as it always has.
 */
export function escapeLayer(s: EscapeState): EscapeLayer | null {
  if (s.docs) return 'docs';
  if (s.proposals) return 'proposals';
  if (s.finder) return 'finder';
  if (s.onMap && s.spotlight) return 'spotlight';
  if (s.onMap && s.simulation) return 'simulation';
  if (s.selection) return 'selection';
  return null;
}

/**
 * Whether a key pressed on this target is typing, or choosing in a control
 * that takes letters and arrows: a text field, a text area, a `<select>`, or
 * anything editable. The page's own keys leave those alone. A `<select>` was
 * missing, so `g` on the run chooser opened Proposals.
 */
export function typingIn(target: unknown): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable === true
  );
}

/** What Tab can reach inside a dialog, in document order. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Where Tab goes from stop `index` of `count` inside a dialog, when it has to
 * be told: on from the last stop round to the first, and back from the first
 * (or from the dialog itself, which is -1) round to the last. Null leaves the
 * step to the browser, whose next stop is still inside. A dialog with no stop
 * keeps the focus itself, which is -1 again.
 */
export function wrapTab(index: number, count: number, back: boolean): number | null {
  if (count === 0) return -1;
  if (back) return index <= 0 ? count - 1 : null;
  return index === count - 1 ? 0 : null;
}

/** Something that can take the focus: a control, or the dialog itself. */
interface Focusable {
  focus: () => void;
}

/** The parts of a key event `trapTab` reads, as a dialog's own handler has them. */
interface TabEvent {
  key: string;
  shiftKey: boolean;
  currentTarget: Focusable & { querySelectorAll: (selectors: string) => ArrayLike<unknown> };
  preventDefault: () => void;
}

/**
 * Keep Tab inside the dialog whose key handler calls this. `active` is what
 * has the focus, `document.activeElement` on the page.
 */
export function trapTab(e: TabEvent, active: unknown): void {
  if (e.key !== 'Tab') return;
  const dialog = e.currentTarget;
  const stops = Array.from(dialog.querySelectorAll(FOCUSABLE)) as Focusable[];
  const to = wrapTab(stops.indexOf(active as Focusable), stops.length, e.shiftKey);
  if (to === null) return;
  e.preventDefault();
  (to === -1 ? dialog : stops[to]).focus();
}
