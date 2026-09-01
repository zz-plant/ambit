/**
 * How a command's result reaches whoever asked for it.
 *
 * Split out of cli.ts, which had grown to 911 lines holding the formatter, the
 * help text, two reports, the seeding routine, the command grouping and a
 * forty-case switch. This is the part that decides what a person sees.
 */

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  grey: '\x1b[90m',
  blue: '\x1b[36m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
};

/**
 * Where a command's result goes when something other than a terminal is
 * asking. `runCommand` is the whole switch below, and a test that wants the
 * data rather than the rendering swaps this in rather than spawning a process
 * and parsing stdout. Null means print, which is every real invocation.
 */
let sink: ((data: unknown) => void) | null = null;

/**
 * A result that is JSON on the terminal as well — the machine-readable views
 * (`graph surface`, `graph export`, `federation export`) are consumed by other
 * programs, so they do not go through the human formatter even without --json.
 */
function emitRaw(data: unknown, pretty = true): void {
  if (sink) {
    sink(data);
    return;
  }
  console.log(pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
}

/**
 * Prints a result for a person to read, or raw JSON with --json.
 *
 * Every command used to dump JSON.stringify unconditionally, which meant the
 * primary surface spoke machine and the reader had to parse it themselves —
 * the single biggest reason this tool needed explaining. Formatting is generic
 * rather than per-command so no command can drift back to raw output.
 */
function emit(data: any): void {
  if (sink) {
    sink(data);
    return;
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const HEADLINE = ['name', 'title', 'capability_id', 'domain', 'id', 'type'];
  const label = (k: string) => k.replace(/_/g, ' ');
  const scalar = (v: any) =>
    Array.isArray(v) ? v.filter(x => typeof x !== 'object').join(', ') : String(v);
  const skip = (_k: string, v: any) =>
    v === null ||
    v === undefined ||
    v === '' ||
    (Array.isArray(v) && v.length === 0) ||
    (Array.isArray(v) && v.some(x => typeof x === 'object'));

  const renderOne = (row: any, indent = '  ') => {
    if (typeof row !== 'object' || row === null) {
      console.log(indent + String(row));
      return;
    }
    const headKey = HEADLINE.find(k => row[k] !== undefined);
    if (headKey) console.log(`${indent}${C.bold}${row[headKey]}${C.reset}`);
    // Arrays of scalars are values, not nesting. Skipping every object dropped
    // them, which `scalar`'s array branch shows was never the intent — and it
    // silently removed the answer from the commands whose answer is a list:
    // `tt authority` printed its note and its per-row detail and not the four
    // lists the note is about. Plain objects are still skipped; an array of
    // objects is rendered as nesting by the loop below.
    for (const [k, v] of Object.entries(row)) {
      if (k === headKey || skip(k, v)) continue;
      if (typeof v === 'object' && !Array.isArray(v)) continue;
      console.log(`${indent}  ${C.grey}${label(k)}:${C.reset} ${scalar(v)}`);
    }
    for (const [k, v] of Object.entries(row)) {
      if (Array.isArray(v) && v.some(x => typeof x === 'object')) {
        console.log(`${indent}  ${C.grey}${label(k)}:${C.reset}`);
        for (const child of v.slice(0, 5)) renderOne(child, indent + '    ');
      }
    }
  };

  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log(`${C.grey}Nothing to report.${C.reset}`);
      return;
    }
    console.log('');
    for (const row of data) {
      renderOne(row);
      console.log('');
    }
    console.log(
      `${C.grey}${data.length} result${data.length === 1 ? '' : 's'} · --json for machine output${C.reset}`
    );
    return;
  }

  console.log('');
  renderOne(data);
  console.log('');
}

/** Swap the destination — `capture` uses this to take the data instead. */
export function setSink(next: ((data: unknown) => void) | null): ((data: unknown) => void) | null {
  const previous = sink;
  sink = next;
  return previous;
}

export { C, emit, emitRaw };
