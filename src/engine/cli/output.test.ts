/**
 * The text view renders nested objects all the way down.
 *
 * It used to stop one level in, so `ambit goal --judge` printed that it had a
 * suggestion and not what the suggestion was, and `ambit can` once printed six
 * of nine fields the same way. A nested record keeps its fields as fields: an
 * `id` inside a block is a line, not a bold headline.
 */
import { afterEach, expect, test, vi } from 'vitest';
import { asProcess } from '../testing/terminal.ts';
import {
  C,
  PLAIN,
  colorOn,
  emit,
  emitRaw,
  formatGeneric,
  raiseExitCode,
  setSink,
  terminalPalette,
} from './output.ts';

/** The colour codes the text view wraps labels in, built from the escape character. */
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
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

/**
 * Colour is for a terminal, and only one that has not asked to go without.
 * Everything else, a pipe, a file, a CI log, gets the same lines with nothing
 * painted on, so `ambit status | grep failing` matches what was written.
 */
test('colour needs a terminal, and NO_COLOR turns it off', () => {
  const terminal = { isTTY: true };
  expect(colorOn(terminal, {})).toBe(true);
  // A pipe has no isTTY at all; a redirect can say false outright.
  expect(colorOn({}, {})).toBe(false);
  expect(colorOn({ isTTY: false }, {})).toBe(false);
  expect(colorOn(terminal, { NO_COLOR: '1' })).toBe(false);
  // Any value counts, including one that reads like a no.
  expect(colorOn(terminal, { NO_COLOR: '0' })).toBe(false);
  // Empty is unset, which is how no-color.org words it.
  expect(colorOn(terminal, { NO_COLOR: '' })).toBe(true);
  expect(colorOn(terminal, { NO_COLOR: undefined })).toBe(true);
});

test('the palette a command draws with follows the process it runs in', () => {
  expect(asProcess(true, undefined, terminalPalette)).toBe(C);
  expect(asProcess(true, '1', terminalPalette)).toBe(PLAIN);
  expect(asProcess(false, undefined, terminalPalette)).toBe(PLAIN);
  // Nothing in the plain palette can put an escape on the line.
  expect(Object.keys(PLAIN)).toEqual(Object.keys(C));
  expect(Object.values(PLAIN).every(code => code === '')).toBe(true);
});

test('the generic view takes its colour from the palette it is given', () => {
  const data = {
    name: 'Shell Execution',
    state: 'reached',
    evidence: { proven: 0, unproven: 14 },
    domains: [{ domain: 'infra', total: 4, reached: 2 }],
  };
  const painted = formatGeneric(data, C);
  const bare = formatGeneric(data, PLAIN);
  expect(painted.some(line => line.includes(ESC))).toBe(true);
  expect(bare.some(line => line.includes(ESC))).toBe(false);
  // Colour is a coat over the same words.
  expect(painted.map(plain)).toEqual(bare);
  // Given nothing, as `emit` gives it for every command without a layout of
  // its own, it paints for a terminal and for nothing else.
  expect(asProcess(true, undefined, () => formatGeneric(data))).toEqual(painted);
  expect(asProcess(false, undefined, () => formatGeneric(data))).toEqual(bare);
  expect(asProcess(true, '1', () => formatGeneric(data))).toEqual(bare);
});

/**
 * A command with a layout of its own hands `emit` a function for the human
 * path. Tests and scripts read the data, so it must run there and nowhere else.
 */
test('a command that draws itself is drawn on the human path only', () => {
  const draw = vi.fn((data: { n: number }) => [`drawn ${data.n}`, '']);
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
    lines.push(String(line ?? ''));
  });

  // The sink is how a test reads a result.
  const seen: unknown[] = [];
  const previous = setSink(data => void seen.push(data));
  try {
    emit({ n: 1 }, draw);
  } finally {
    setSink(previous);
  }
  expect(seen).toEqual([{ n: 1 }]);
  expect(lines).toEqual([]);

  // --json is how a script does.
  process.argv.push('--json');
  try {
    emit({ n: 2 }, draw);
  } finally {
    process.argv.pop();
  }
  expect(lines).toEqual([JSON.stringify({ n: 2 }, null, 2)]);
  expect(draw).not.toHaveBeenCalled();

  // A person gets the drawing, one console line for each of its lines.
  lines.length = 0;
  emit({ n: 3 }, draw);
  expect(lines).toEqual(['drawn 3', '']);
  expect(draw).toHaveBeenCalledTimes(1);
});

/**
 * `{ error }` at the top of a result is a command saying it failed, and a
 * printed one exits 1. Only a printed one: the sink is a test or a program
 * reading the result in-process, and the process is not the command's to mark.
 */
test('a failed result exits 1 on the way out, and never through the sink', () => {
  const before = process.exitCode;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const codeAfter = (print: () => void, start?: number) => {
    process.exitCode = start;
    print();
    return process.exitCode;
  };
  try {
    expect(codeAfter(() => emit({ error: 'Usage: ambit sync' }))).toBe(1);
    expect(codeAfter(() => emitRaw({ error: 'Usage: ambit sync' }))).toBe(1);
    // An answer that reports an error per item still stands as an answer.
    const queue = { refused: 1, results: [{ id: 'prop-a', error: 'No proposal prop-a.' }] };
    expect(codeAfter(() => emit(queue))).toBeUndefined();
    expect(codeAfter(() => emit({ decision: 'DENY', reason: 'forbidden' }))).toBeUndefined();
    // Raised and never lowered, so a command that set its own code keeps it.
    expect(codeAfter(() => emit({ error: 'x' }), 3)).toBe(3);

    // Through the sink the code is left alone, including one a command asks
    // for directly, as an unknown verb does.
    const previous = setSink(() => {});
    try {
      expect(codeAfter(() => emit({ error: 'x' }))).toBeUndefined();
      expect(codeAfter(() => raiseExitCode(2))).toBeUndefined();
    } finally {
      setSink(previous);
    }
  } finally {
    process.exitCode = before;
  }
});
