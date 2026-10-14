/**
 * The evaluation set behind the judge's floor and the figures in docs/jev.md
 * has to keep naming nodes the tree holds: a renamed node would otherwise
 * count as every model's miss, and the next measurement would be wrong
 * without anything saying so.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadTechTree } from '../src/engine/paths.ts';

const EVAL = JSON.parse(readFileSync(join(import.meta.dirname, 'judge-eval.json'), 'utf8'));

test('every sentence the set places names a node the tree holds', () => {
  const ids = new Set(loadTechTree().nodes.map((n: { id: string }) => n.id));
  const missing = EVAL.placed.filter((p: { want: string }) => !ids.has(p.want));
  expect(missing).toEqual([]);
});

test('no sentence is in the set twice, and none is a goal phrase the tree authors', () => {
  const texts = [...EVAL.placed.map((p: { text: string }) => p.text), ...EVAL.offTree];
  expect(new Set(texts).size).toBe(texts.length);
  // A goal phrase is routed by the vocabulary and never reaches the model.
  const phrases = new Set(loadTechTree().nodes.flatMap((n: { goal?: string[] }) => n.goal ?? []));
  expect(texts.filter(t => phrases.has(t))).toEqual([]);
});
