/**
 * The text view renders nested objects all the way down.
 *
 * It used to stop one level in, so `ambit goal --judge` printed that it had a
 * suggestion and not what the suggestion was, and `ambit can` once printed six
 * of nine fields the same way. A nested record keeps its fields as fields: an
 * `id` inside a block is a line, not a bold headline.
 */
import { afterEach, expect, test, vi } from 'vitest';
import { emit } from './output.ts';

/** The colour codes the text view wraps labels in, built from the escape character. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const plain = (s: string) => s.replace(ANSI, '');

afterEach(() => {
  vi.restoreAllMocks();
});

function printed(data: unknown): string {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
    lines.push(plain(String(line ?? '')));
  });
  emit(data);
  return lines.join('\n');
}

test('an object two levels down is printed, not dropped', () => {
  const out = printed({
    goal: 'triage incoming bug reports',
    judged: {
      asked: 'http://127.0.0.1:8009',
      suggested: { id: 'combo:self-hosted-stack', probability: 0.74 },
    },
  });
  expect(out).toContain('judged:');
  expect(out).toContain('suggested:');
  expect(out).toMatch(/^ +id: combo:self-hosted-stack$/m);
  expect(out).toMatch(/^ +probability: 0\.74$/m);
});

test('one level down reads exactly as it did', () => {
  const out = printed({ capability: 'x', evidence: { proven: 0, unproven: 14 } });
  expect(out.split('\n')).toEqual(
    expect.arrayContaining(['    evidence:', '      proven: 0', '      unproven: 14'])
  );
});
