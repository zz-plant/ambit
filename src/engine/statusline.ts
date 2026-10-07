/**
 * `ambit statusline`: one line for Claude Code's status line, worth a glance
 * on every turn.
 *
 * What Claude Code does with it, from https://code.claude.com/docs/en/statusline:
 * `statusLine: { type: "command", command, padding }` in settings.json runs the
 * command with the session's JSON on stdin (`session_id`, `model`,
 * `workspace.current_dir`, `cost`, `version`, `transcript_path`, `output_style`
 * and more) and shows what it prints, each line of it as a row, ANSI colours
 * rendered. It runs when a session starts or resumes and again on each new
 * assistant message, `/compact`, a change of permission or vim mode, debounced
 * by 300ms, and a run still going when the next one starts is cancelled. One
 * command per settings file, so a person who already has one composes this
 * into theirs. A plugin cannot supply one: of a plugin's settings only `agent`
 * and `subagentStatusLine` take effect
 * (https://code.claude.com/docs/en/plugins/manifest-reference#settings), which
 * is why the plugins in plugins/claude-code/ do not and `ambit connect
 * claude-code --statusline` writes the entry instead.
 *
 * So it runs often and in someone else's interface. It reads the graph the way
 * the gate does and less: no spool read, no seed, no migration, no first-run
 * output, no socket, and the file opened read-only, so the status line never
 * changes what it reports on. Anything that goes wrong prints nothing and
 * exits 0, because a broken status line must not clutter the screen.
 *
 * What it says, in the order a person would act on it, each part left out
 * when it has nothing to say (AGENTS.md rule 16): the capabilities whose last
 * check failed, the proposals waiting on a decision, and the verified count
 * the map's header leads with. A graph never seeded prints nothing at all,
 * since a count of zero there would describe the curated model and read as
 * the person's. The payload's directory is not used. The graph describes the
 * machine and not a directory, and the directory is already on the screen.
 *
 * Its cost is Node starting, not the graph: opening it and counting takes
 * about 2ms, which is why nothing is cached. cli.js imports this module in its
 * own process and does not start the engine, so the command is one Node start.
 */
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolveDbPath } from '../shared/db-path.ts';
import { C, PLAIN, type Palette } from './cli/output.ts';
import type { Db } from './db.ts';
import { FAILING_SQL, graphCounts } from './vocabulary.ts';

/** What the line is made from. */
export interface StatusReading {
  /** The capabilities whose last check failed, by name, in id order. */
  failing: string[];
  /** Proposals drafted and not yet approved or rejected. */
  waiting: number;
  /** Capabilities with a passing check: the map's verified count. */
  verified: number;
}

/**
 * The widest line it prints. Half of a 120-column terminal, so it fits beside
 * a model, a directory and a context bar when a person adds it to a status
 * line they already have, and on its own row in a narrow one.
 */
export const STATUS_LINE_WIDTH = 60;

/** What the graph says, or null for a graph never seeded. */
export function readStatus(db: Pick<Db, 'prepare'>): StatusReading | null {
  const counts = graphCounts(db);
  if (!counts.total) return null;
  // The nodes the short screen of bare `ambit` lists as failing.
  const failing = db
    .prepare(`SELECT name FROM capabilities WHERE kind != 'action' AND ${FAILING_SQL} ORDER BY id`)
    .all<{ name: string }>();
  let waiting = 0;
  try {
    waiting =
      db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE status = 'draft'").get<{ n: number }>()
        ?.n ?? 0;
  } catch {
    /* a graph from before proposals has none waiting */
  }
  return { failing: failing.map(f => f.name), waiting, verified: counts.proven };
}

interface Part {
  /** `!` or `›`: the meaning, in a character that survives a pipe and no colour. */
  mark?: string;
  colour?: string;
  words: string;
}

const SEPARATOR = ' · ';

const widthOf = (parts: Part[]) =>
  parts.reduce((n, p) => n + (p.mark ? p.mark.length + 1 : 0) + p.words.length, 0) +
  SEPARATOR.length * Math.max(parts.length - 1, 0);

/**
 * The line. `!` marks what is failing and `›` what wants a person, so the
 * meaning holds with no colour at all (AGENTS.md rule 18); colour only adds
 * to the marks. Over `width`, the verified count goes first, being the part
 * with nothing to act on, and then the first failing name is shortened, or
 * dropped when too little of it would be left to read.
 */
export function renderStatusLine(
  r: StatusReading,
  c: Palette = PLAIN,
  width = STATUS_LINE_WIDTH
): string {
  const [first] = r.failing;
  const more = r.failing.length > 1 ? ` +${r.failing.length - 1}` : '';
  const layout = (name: string | null, withVerified: boolean): Part[] => {
    const parts: Part[] = [];
    if (first) {
      parts.push({
        mark: '!',
        colour: c.yellow,
        words: `${r.failing.length} failing${name === null ? '' : `: ${name}${more}`}`,
      });
    }
    if (r.waiting) {
      parts.push({
        mark: '›',
        colour: `${c.accent}${c.bold}`,
        words: `${r.waiting} ${r.waiting === 1 ? 'proposal' : 'proposals'} to decide`,
      });
    }
    if (withVerified || !parts.length) parts.push({ words: `${r.verified} verified` });
    return parts;
  };

  let parts = layout(first ?? null, true);
  if (widthOf(parts) > width) parts = layout(first ?? null, false);
  if (widthOf(parts) > width && first) {
    const room = first.length - (widthOf(parts) - width) - 1;
    parts = layout(room >= 8 ? `${first.slice(0, room).trimEnd()}…` : null, false);
  }
  return parts
    .map(p => (p.mark ? `${p.colour}${p.mark}${c.reset} ${p.words}` : p.words))
    .join(`${c.grey}${SEPARATOR}${c.reset}`);
}

/**
 * The palette for the line. Claude Code renders ANSI in a status line, though
 * what it reads from is a pipe, so a call carrying its payload is painted; a
 * terminal is painted as it is for every command; anything else, such as a
 * script composing this into its own line, gets plain text unless it passes
 * the payload on. NO_COLOR, set to anything, wins over all three.
 */
export function statusPalette(
  fromClaudeCode: boolean,
  stream: { isTTY?: boolean } = process.stdout,
  env: Record<string, string | undefined> = process.env
): Palette {
  return !env.NO_COLOR && (fromClaudeCode || Boolean(stream.isTTY)) ? C : PLAIN;
}

/** Whether stdin carried Claude Code's status line JSON. Garbage, or nothing, is no. */
export function isClaudeCodePayload(text: string): boolean {
  try {
    const payload = JSON.parse(text);
    return (
      Boolean(payload) && typeof payload === 'object' && typeof payload.session_id === 'string'
    );
  } catch {
    return false;
  }
}

/**
 * What `ambit statusline` prints, without the newline: the line, the reading
 * as JSON with `--json`, or an empty string. Never throws.
 */
export function statusLine(argv: string[] = []): string {
  let db: DatabaseSync | undefined;
  try {
    // A terminal is never read from: it would wait for a person to type.
    const input = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
    const path = resolveDbPath({ create: false });
    // Opening a path that is not there would create it.
    if (!existsSync(path)) return '';
    db = new DatabaseSync(path, { readOnly: true });
    // A writer mid-transaction is waited on briefly, and then the line is blank.
    db.exec('PRAGMA busy_timeout = 250');
    const reading = readStatus(db as unknown as Db);
    if (!reading) return '';
    if (argv.includes('--json')) return JSON.stringify(reading);
    return renderStatusLine(reading, statusPalette(isClaudeCodePayload(input)));
  } catch {
    return '';
  } finally {
    try {
      db?.close();
    } catch {}
  }
}
