/**
 * The staleness rule, which is the part of the asset check that has been wrong
 * before.
 *
 * Its first version failed CI whenever an image was older than the last commit
 * to src/client. That is true after every client commit, including ones that
 * change no pixel, and the only remedy was re-recording a 425KB binary — so the
 * check pushed half a megabyte into git history per UI commit and went red on a
 * scrollbar fix. The rule is a rot detector, not a correctness check, and these
 * pin what it treats as rot.
 */
import { expect, test } from 'vitest';
import { stalenessOf } from './check-assets.ts';

test('an image recorded after the last client change is current', () => {
  expect(stalenessOf(0)).toBe('current');
  expect(stalenessOf(0, true)).toBe('current');
});

test('a handful of client commits is drift, not rot', () => {
  // A lint pass and a CSS fix are one or two commits. Failing here is what
  // made the gate something to disable rather than something to trust.
  for (const behind of [1, 2, 5, 11]) {
    expect(stalenessOf(behind)).toBe('drifting');
  }
});

test('enough commits without a re-record is stale', () => {
  // The failure this exists to catch was fourteen commits and two UI
  // generations behind.
  expect(stalenessOf(12)).toBe('stale');
  expect(stalenessOf(14)).toBe('stale');
  expect(stalenessOf(200)).toBe('stale');
});

test('strict treats any drift as stale', () => {
  // For a release, where re-recording once is proportionate.
  expect(stalenessOf(1, true)).toBe('stale');
  expect(stalenessOf(11, true)).toBe('stale');
});
