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
  // The map's blue, as near as sixteen colours get: where a person should act.
  accent: '\x1b[36m',
};

/** The colour codes a surface may use, or the same names holding nothing. */
type Palette = typeof C;

/** Every name in `C` with nothing behind it, for output no terminal is reading. */
const PLAIN = Object.fromEntries(Object.keys(C).map(name => [name, ''])) as Palette;

/**
 * Whether what this process prints may carry colour codes: on a terminal, and
 * not when NO_COLOR is set to anything (no-color.org counts an empty value as
 * unset). A pipe, a file and a CI log all get plain text, so `ambit status |
 * grep failing` matches what was written and not what was painted.
 */
function colorOn(
  stream: { isTTY?: boolean } = process.stdout,
  env: Record<string, string | undefined> = process.env
): boolean {
  return Boolean(stream.isTTY) && !env.NO_COLOR;
}

/** `C` where colour is welcome and `PLAIN` where it is not. */
function terminalPalette(): Palette {
  return colorOn() ? C : PLAIN;
}

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
 * A result that is already prose.
 *
 * The briefing is written for a reader — an agent quoting a sentence, a person
 * skimming one — so putting it through the key/value formatter would take the
 * one command whose output is deliberately a paragraph and turn it back into
 * fields. Still goes through the sink, so a test reads the same string a
 * terminal shows.
 */
function emitText(text: string): void {
  if (sink) {
    sink(text);
    return;
  }
  console.log(text);
}

/**
 * Prints a result for a person to read, or raw JSON with --json.
 *
 * Every command used to dump JSON.stringify unconditionally, which meant the
 * primary surface spoke machine and the reader had to parse it themselves —
 * the single biggest reason this tool needed explaining. Formatting is generic
 * rather than per-command so no command can drift back to raw output.
 *
 * A command whose answer deserves a layout of its own passes `human`, which
 * turns the data into the lines a person reads. It runs on that path only:
 * the sink and --json both get the data itself, so a test and a script are
 * never reading the rendering.
 */
function emit(data: any, human: (data: any) => string[] = formatGeneric): void {
  if (sink) {
    sink(data);
    return;
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  for (const line of human(data)) console.log(line);
}

/**
 * The generic rendering, as the lines a terminal shows.
 *
 * Lines and not prints, so a command with a layout of its own can put this
 * beneath its head for whatever the head does not say, and a test can read
 * what would be shown without spying on the console.
 */
function formatGeneric(data: any, c: Palette = C): string[] {
  const lines: string[] = [];
  const say = (line: string) => void lines.push(line);

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

  // A list of counts against totals — the per-domain rows of `status` — reads
  // as a bar, not as five nested "total / reached" pairs. bootstrap.sh used to
  // draw this on its own from the JSON, so the first-run report and the
  // command a minute later showed the same numbers two different ways.
  const isProgressRow = (v: any) =>
    typeof v === 'object' &&
    v !== null &&
    typeof v.total === 'number' &&
    typeof v.reached === 'number' &&
    Object.keys(v).length <= 4;
  const bar = (reached: number, total: number) => {
    const n = total > 0 ? Math.round((reached / total) * 10) : 0;
    return '█'.repeat(n) + '░'.repeat(10 - n);
  };
  const renderProgress = (rows: any[], indent: string) => {
    const width = Math.max(...rows.map(r => String(r.domain ?? r.name ?? r.id ?? '').length), 0);
    for (const r of rows) {
      const name = String(r.domain ?? r.name ?? r.id ?? '').padEnd(width);
      say(
        `${indent}${c.grey}${bar(r.reached, r.total)}${c.reset} ${name}  ${r.reached}/${r.total}`
      );
    }
  };

  const renderOne = (row: any, indent = '  ', headline = true) => {
    if (typeof row !== 'object' || row === null) {
      say(indent + String(row));
      return;
    }
    const headKey = headline ? HEADLINE.find(k => row[k] !== undefined) : undefined;
    if (headKey) say(`${indent}${c.bold}${row[headKey]}${c.reset}`);
    // Arrays of scalars are values, not nesting. Skipping every object dropped
    // them, which `scalar`'s array branch shows was never the intent — and it
    // silently removed the answer from the commands whose answer is a list:
    // `tt authority` printed its note and its per-row detail and not the four
    // lists the note is about.
    for (const [k, v] of Object.entries(row)) {
      if (k === headKey || skip(k, v)) continue;
      if (typeof v === 'object' && !Array.isArray(v)) continue;
      say(`${indent}  ${c.grey}${label(k)}:${c.reset} ${scalar(v)}`);
    }
    // A nested plain object used to be dropped entirely, which is how `ambit
    // can` came to print six of its nine fields: the governing grant and the
    // evidence about the target were visible only with --json, and nothing
    // said so. Rendered as an indented block rather than skipped, and all the
    // way down: stopping one level in dropped `goal --judge`'s suggestion and
    // its probabilities the same way. No headline inside a block, so a nested
    // record with an id or a name reads as its fields, as it always did.
    for (const [k, v] of Object.entries(row)) {
      if (k === headKey || skip(k, v)) continue;
      if (typeof v !== 'object' || v === null || Array.isArray(v)) continue;
      if (!Object.values(v).some(x => !skip(k, x))) continue;
      say(`${indent}  ${c.grey}${label(k)}:${c.reset}`);
      renderOne(v, `${indent}  `, false);
    }
    for (const [k, v] of Object.entries(row)) {
      if (Array.isArray(v) && v.some(x => typeof x === 'object')) {
        say(`${indent}  ${c.grey}${label(k)}:${c.reset}`);
        if (v.length > 0 && v.every(isProgressRow)) {
          renderProgress(v, indent + '    ');
          continue;
        }
        for (const child of v.slice(0, 5)) renderOne(child, indent + '    ');
      }
    }
  };

  if (Array.isArray(data)) {
    if (data.length === 0) return [`${c.grey}Nothing to report.${c.reset}`];
    say('');
    for (const row of data) {
      renderOne(row);
      say('');
    }
    say(
      `${c.grey}${data.length} result${data.length === 1 ? '' : 's'} · --json for machine output${c.reset}`
    );
    return lines;
  }

  say('');
  renderOne(data);
  say('');
  return lines;
}

/** Swap the destination — `capture` uses this to take the data instead. */
export function setSink(next: ((data: unknown) => void) | null): ((data: unknown) => void) | null {
  const previous = sink;
  sink = next;
  return previous;
}

export { C, PLAIN, colorOn, emit, emitRaw, emitText, formatGeneric, terminalPalette, type Palette };
