/**
 * Runs a function as if stdout were, or were not, a terminal.
 *
 * Whether a command may colour what it prints depends on two facts about the
 * process: whether stdout is a terminal, and whether NO_COLOR is set. A test
 * runner has neither, so a test that asks about colour has to supply both and
 * put them back. Kept apart from ./cli.ts because that module registers a
 * temporary directory for every test that imports it, and a formatter test has
 * no graph to hold.
 */
export function asProcess<T>(isTTY: boolean, noColor: string | undefined, fn: () => T): T {
  const had = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  const before = process.env.NO_COLOR;
  Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, configurable: true });
  if (noColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = noColor;
  try {
    return fn();
  } finally {
    if (had) Object.defineProperty(process.stdout, 'isTTY', had);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
    if (before === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = before;
  }
}
