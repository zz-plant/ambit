/**
 * `npm run check` is only an answer to "will CI pass" while it runs what CI
 * runs, so the list is held to ci.yml and to package.json.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { STEPS, stepsFor, tail } from './check.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8');

test('the full run covers every npm script the CI check job runs', () => {
  const ci = [...read('.github/workflows/ci.yml').matchAll(/run: npm run (\S+)/g)].map(m => m[1]);
  expect(ci.length).toBeGreaterThan(5);
  const full = stepsFor(false).map(s => s.script);
  expect(ci.filter(script => !full.includes(script))).toEqual([]);
});

test('every step is a script package.json has', () => {
  const scripts = Object.keys(JSON.parse(read('package.json')).scripts);
  expect(STEPS.map(s => s.script).filter(s => !scripts.includes(s))).toEqual([]);
});

test('the fast run is lint, typecheck and the suite', () => {
  expect(stepsFor(true).map(s => s.script)).toEqual(['lint', 'typecheck', 'test']);
});

test('a failure shows the end of the output, where the runner says what failed', () => {
  const output = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
  expect(tail(`${output}\n\n`, 3)).toBe('line 48\nline 49\nline 50');
});
