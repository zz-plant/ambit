/**
 * What one press of Escape closes.
 *
 * The shell and the map each listened for the key, and what a person got
 * depended on which listener ran first: with a selection, a simulation and a
 * spotlight on the map, three presses cleared them in the reverse of the map's
 * order, and one press closed the docs and cleared the selection behind them.
 * One listener now asks `escapeLayer`, so the order is this function's, and it
 * is tested here by pressing until nothing is left open.
 */
import { expect, test } from 'vitest';
import { type EscapeLayer, type EscapeState, escapeLayer } from './keys';

const NOTHING: EscapeState = {
  docs: false,
  proposals: false,
  finder: false,
  onMap: true,
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
