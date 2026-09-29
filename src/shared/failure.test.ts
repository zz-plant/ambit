import { expect, test } from 'vitest';
import { isFailure } from './failure.ts';

test('a top-level string error is a failure', () => {
  expect(isFailure({ error: 'No capability "x" in this graph.' })).toBe(true);
  expect(isFailure({ error: 'usage', did_you_mean: ['combo:a'] })).toBe(true);
});

test('an error inside a report that otherwise stands is not', () => {
  // One failing check among many, and one id refused in a batch.
  expect(isFailure({ checked: 2, results: [{ id: 'a', error: 'boom' }] })).toBe(false);
  expect(isFailure({ results: [], approved: 1, error_count: 1 })).toBe(false);
});

test('only a string counts, and only on a plain object', () => {
  expect(isFailure({ error: true })).toBe(false);
  expect(isFailure({ error: null })).toBe(false);
  expect(isFailure({ error: { message: 'x' } })).toBe(false);
  expect(isFailure([{ error: 'x' }])).toBe(false);
  for (const v of [null, undefined, 'error', 7, true]) expect(isFailure(v)).toBe(false);
});
