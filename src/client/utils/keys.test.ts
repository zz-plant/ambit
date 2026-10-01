/**
 * The page's rules for keys: what one press of Escape closes, where the page's
 * own keys stand aside, and where Tab goes inside a dialog.
 *
 * The shell and the map each listened for the key, and what a person got
 * depended on which listener ran first: with a selection, a simulation and a
 * spotlight on the map, three presses cleared them in the reverse of the map's
 * order, and one press closed the docs and cleared the selection behind them.
 * One listener now asks `escapeLayer`, so the order is this function's, and it
 * is tested here by pressing until nothing is left open.
 */
import { expect, test } from 'vitest';
import {
  type EscapeLayer,
  type EscapeState,
  escapeLayer,
  mapKey,
  pageKey,
  trapTab,
  typingIn,
  wrapTab,
} from './keys';

const NOTHING: EscapeState = {
  docs: false,
  proposals: false,
  finder: false,
  onMap: true,
  key: false,
  spotlight: false,
  simulation: false,
  selection: false,
};

/** Press Escape until nothing closes, and list what each press closed. */
function presses(open: Partial<EscapeState>): EscapeLayer[] {
  const state = { ...NOTHING, ...open };
  const closed: EscapeLayer[] = [];
  for (let layer = escapeLayer(state); layer; layer = escapeLayer(state)) {
    closed.push(layer);
    state[layer] = false;
  }
  return closed;
}

test('on the map each press peels one layer: the spotlight, the simulation, then the selection', () => {
  expect(presses({ selection: true, simulation: true, spotlight: true })).toEqual([
    'spotlight',
    'simulation',
    'selection',
  ]);
  expect(presses({ selection: true, simulation: true })).toEqual(['simulation', 'selection']);
});

test('the key closes before the highlight it set, and the map keeps both until asked', () => {
  // Pressing a key lights its nodes with the key still open; the first press
  // takes the key away, the second the highlight.
  expect(presses({ key: true, spotlight: true, selection: true })).toEqual([
    'key',
    'spotlight',
    'selection',
  ]);
  expect(presses({ onMap: false, key: true, selection: true })).toEqual(['selection']);
});

test('an era ladder and a spotlight take two presses, not one', () => {
  // The ladder is the panel's selection, and closes with it.
  expect(presses({ selection: true, spotlight: true })).toEqual(['spotlight', 'selection']);
});

test('an overlay closes first and takes the press, leaving the map as it was', () => {
  expect(presses({ docs: true, selection: true })).toEqual(['docs', 'selection']);
  expect(presses({ proposals: true, spotlight: true, selection: true })).toEqual([
    'proposals',
    'spotlight',
    'selection',
  ]);
  expect(presses({ finder: true, simulation: true })).toEqual(['finder', 'simulation']);
  // The topmost first: the docs open over Proposals, which open over the finder.
  expect(presses({ docs: true, proposals: true, finder: true })).toEqual([
    'docs',
    'proposals',
    'finder',
  ]);
});

test('off the map a spotlight and a simulation are drawn nowhere, so the selection closes', () => {
  expect(presses({ onMap: false, spotlight: true, simulation: true, selection: true })).toEqual([
    'selection',
  ]);
});

test('with nothing open, Escape closes nothing', () => {
  expect(escapeLayer(NOTHING)).toBeNull();
  expect(escapeLayer({ ...NOTHING, onMap: false })).toBeNull();
});

// ── Where the page's keys stand aside ────────────────────────────────────────
// `g`, `?`, `/` and the map's letters and arrows are the page's everywhere a
// key is not typing or choosing. A `<select>` was not on the list, so `g`
// pressed on the run chooser in Time & cost opened Proposals.

const target = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable });

test('a field, a text area, a select and anything editable take their own keys', () => {
  expect(typingIn(target('INPUT'))).toBe(true);
  expect(typingIn(target('TEXTAREA'))).toBe(true);
  expect(typingIn(target('SELECT'))).toBe(true);
  expect(typingIn(target('DIV', true))).toBe(true);
});

test('a button, a node of the map and the page itself leave the keys to the page', () => {
  expect(typingIn(target('BUTTON'))).toBe(false);
  expect(typingIn(target('g'))).toBe(false);
  expect(typingIn(target('BODY'))).toBe(false);
  expect(typingIn(null)).toBe(false);
});

// ── Tab inside a dialog ──────────────────────────────────────────────────────
// Proposals and the docs opened with the focus left on the page behind them,
// so Tab walked the map's seventy-odd stops before it reached either, and the
// finder let Tab walk out of it onto the page. Taking the focus and giving it
// back happen in an effect (useDialogFocus), which this suite has no DOM to
// run; where Tab goes is decided here, on stand-ins for the dialog.

test('Tab comes round from the last stop to the first, and Shift+Tab the other way', () => {
  expect(wrapTab(2, 3, false)).toBe(0);
  expect(wrapTab(0, 3, true)).toBe(2);
  // From the dialog itself, where it starts: on is the first stop, back is the last.
  expect(wrapTab(-1, 3, false)).toBeNull();
  expect(wrapTab(-1, 3, true)).toBe(2);
});

test('inside the run of stops the browser takes the step, which stays inside', () => {
  expect(wrapTab(0, 3, false)).toBeNull();
  expect(wrapTab(1, 3, false)).toBeNull();
  expect(wrapTab(1, 3, true)).toBeNull();
  expect(wrapTab(2, 3, true)).toBeNull();
});

test('a dialog with nothing to stop on keeps the focus itself', () => {
  expect(wrapTab(-1, 0, false)).toBe(-1);
  expect(wrapTab(-1, 0, true)).toBe(-1);
});

/** A dialog holding three controls, and a record of where the focus was put. */
function dialogOf(n = 3) {
  const focused: string[] = [];
  const stops = Array.from({ length: n }, (_, i) => ({ focus: () => focused.push(`stop ${i}`) }));
  const dialog = {
    querySelectorAll: () => stops,
    focus: () => focused.push('dialog'),
  };
  const press = (active: unknown, shiftKey = false, key = 'Tab') => {
    let prevented = false;
    trapTab(
      { key, shiftKey, currentTarget: dialog, preventDefault: () => (prevented = true) },
      active
    );
    return prevented;
  };
  return { stops, focused, press };
}

test('the dialog puts the focus where Tab comes round to, and takes the key', () => {
  const { stops, focused, press } = dialogOf();
  expect(press(stops[2])).toBe(true);
  expect(press(stops[0], true)).toBe(true);
  expect(focused).toEqual(['stop 0', 'stop 2']);
});

test('a step inside, and any other key, are left alone', () => {
  const { stops, focused, press } = dialogOf();
  expect(press(stops[0])).toBe(false);
  expect(press(stops[2], false, 'ArrowDown')).toBe(false);
  expect(focused).toEqual([]);

  const empty = dialogOf(0);
  expect(empty.press(null)).toBe(true);
  expect(empty.focused).toEqual(['dialog']);
});

// ── A key held with Ctrl, Cmd or Alt is the browser's ────────────────────────
// The map took Ctrl+= as its own zoom and Ctrl+J as a step, and `g` with any
// modifier opened Proposals, each with the browser's own action stopped.

const press = (
  key: string,
  held: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}
) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...held,
});

test('the page and the map take their keys plain, and leave a modified one to the browser', () => {
  expect(mapKey(press('='))).toEqual({ kind: 'zoom', to: 'in' });
  expect(mapKey(press('j'))).toEqual({ kind: 'step', by: 1 });
  expect(pageKey(press('g'))).toBe('proposals');
  expect(pageKey(press('/'))).toBe('search');
  for (const held of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    for (const key of ['=', '+', '-', '0', 'j', 'k', '1'])
      expect(mapKey(press(key, held))).toBeUndefined();
    for (const key of ['g', 'G', '/', '?']) expect(pageKey(press(key, held))).toBeUndefined();
  }
});
