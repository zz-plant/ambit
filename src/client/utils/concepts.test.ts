import { test, expect } from 'bun:test';
import concepts from '../../shared/concepts.json';

test('every concept is complete enough to teach with', () => {
  expect(concepts.concepts.length).toBeGreaterThan(5);
  for (const c of concepts.concepts) {
    expect(c.key).toMatch(/^[a-z-]+$/);
    expect(c.term.length).toBeGreaterThan(2);
    // `short` sits beside the term in the UI, so it has to stay on one line.
    expect(c.short.length).toBeLessThan(60);
    expect(c.long.length).toBeGreaterThan(80);
    expect(c.seen.length).toBeGreaterThan(3);
  }
});

test('concept keys are unique', () => {
  const keys = concepts.concepts.map(c => c.key);
  expect(new Set(keys).size).toBe(keys.length);
});
