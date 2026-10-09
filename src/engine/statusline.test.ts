/**
 * `ambit statusline`, the line Claude Code shows after every message.
 *
 * It says what is failing, what is waiting on a person, and the verified
 * count, in that order and within sixty characters; a graph never seeded, one
 * it cannot open, or anything else that goes wrong prints nothing and exits 0.
 * It reads the graph and writes nothing, and it is quick, since it runs in
 * someone else's interface. The last three are only real across a process
 * boundary, so those cases run it the way Claude Code does: a process, the
 * session's JSON on stdin, stdout read as the line.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { C, PLAIN } from './cli/output.ts';
import { getDb } from './db.ts';
import { migrate } from './migrate.ts';
import {
  isClaudeCodePayload,
  readStatus,
  renderStatusLine,
  STATUS_LINE_WIDTH,
  statusPalette,
} from './statusline.ts';
import { makeGraph } from './testing/graph.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const WRAPPER = join(ROOT, 'cli.js');
const ENGINE = join(import.meta.dirname, 'engine.ts');

/** What Claude Code sends, in part: https://code.claude.com/docs/en/statusline */
const PAYLOAD = JSON.stringify({
  session_id: 'test-session',
  cwd: '/home/someone/project',
  model: { id: 'claude-opus-5-5', display_name: 'Opus' },
  workspace: { current_dir: '/home/someone/project', project_dir: '/home/someone/project' },
  version: '2.1.300',
});

// biome-ignore lint/suspicious/noControlCharactersInRegex: the escape is what is being removed
const unpaint = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ambit-statusline-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A graph file in the test's directory, with the rows a case needs and nothing read from the machine. */
function graphFile(opts: { lifecycles?: Record<string, string>; drafts?: number } = {}): string {
  const path = join(dir, 'graph.db');
  const db = getDb(path);
  migrate(db);
  const cap = db.prepare(
    `INSERT INTO capabilities (id, name, domain, description, category, state, kind, lifecycle)
     VALUES (?, ?, 'infra', '', 'skill', 'unlocked', 'capability', ?)`
  );
  for (const [id, lifecycle] of Object.entries(opts.lifecycles ?? {})) {
    cap.run(id, id.replace(/^combo:/, '').replace(/-/g, ' '), lifecycle);
  }
  for (let i = 0; i < (opts.drafts ?? 0); i++) {
    db.prepare(
      "INSERT INTO proposals (id, goal, status, steps, simulated) VALUES (?, 'x', 'draft', '[]', '{}')"
    ).run(`prop-${i}`);
  }
  db.close();
  return path;
}

/** Runs `ambit statusline` as Claude Code does, against `graph`, with HOME pointed at the test's own. */
function statusline(
  graph: string,
  opts: {
    input?: string;
    env?: Record<string, string>;
    via?: 'wrapper' | 'engine';
    args?: string[];
  } = {}
) {
  const started = performance.now();
  const args = ['statusline', ...(opts.args ?? [])];
  const r = spawnSync(
    'node',
    opts.via === 'engine'
      ? ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', ENGINE, ...args]
      : [WRAPPER, ...args],
    {
      input: opts.input ?? PAYLOAD,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: dir,
        XDG_DATA_HOME: join(dir, 'data'),
        XDG_STATE_HOME: join(dir, 'state'),
        AMBIT_DB: graph,
        TOOLCHAIN_DB: graph,
        NO_COLOR: '',
        ...opts.env,
      },
    }
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, ms: performance.now() - started };
}

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('a failing check leads, and a waiting proposal follows it', () => {
  expect(renderStatusLine({ failing: ['Browser Automation'], waiting: 0, verified: 12 })).toBe(
    '! 1 failing: Browser Automation · 12 verified'
  );
  expect(renderStatusLine({ failing: [], waiting: 1, verified: 12 })).toBe(
    '› 1 proposal to decide · 12 verified'
  );
  expect(
    renderStatusLine({
      failing: ['Browser Automation', 'Web Research', 'Data Access'],
      waiting: 0,
      verified: 9,
    })
  ).toBe('! 3 failing: Browser Automation +2 · 9 verified');
});

test('with nothing to say, the line is the verified count, zero included', () => {
  expect(renderStatusLine({ failing: [], waiting: 0, verified: 12 })).toBe('12 verified');
  expect(renderStatusLine({ failing: [], waiting: 0, verified: 0 })).toBe('0 verified');
});

test('over sixty characters the verified count goes first, then the failing name shortens', () => {
  const both = renderStatusLine({ failing: ['Browser Automation'], waiting: 2, verified: 12 });
  expect(both).toBe('! 1 failing: Browser Automation · › 2 proposals to decide');
  expect(both.length).toBeLessThanOrEqual(STATUS_LINE_WIDTH);

  const long = 'A Skill Someone Registered With A Remarkably Long Descriptive Name';
  const cut = renderStatusLine({ failing: [long, 'Other'], waiting: 2, verified: 12 });
  expect(cut.length).toBe(STATUS_LINE_WIDTH);
  expect(cut).toMatch(/^! 2 failing: A Skill Someone.*… \+1 · › 2 proposals to decide$/);

  // Too little of the name would be left to read, so the count stands alone.
  const narrow = renderStatusLine({ failing: [long], waiting: 2, verified: 12 }, PLAIN, 30);
  expect(narrow).toBe('! 1 failing · › 2 proposals to decide');
});

test('colour only adds to the marks: without it, the line says the same', () => {
  const reading = { failing: ['Browser Automation'], waiting: 1, verified: 3 };
  const painted = renderStatusLine(reading, C, 200);
  expect(painted).toContain(`${C.yellow}!${C.reset}`);
  expect(painted).toContain(`${C.accent}${C.bold}›${C.reset}`);
  expect(unpaint(painted)).toBe(renderStatusLine(reading, PLAIN, 200));
});

test("Claude Code's payload is painted though it arrives on a pipe, and NO_COLOR wins", () => {
  const pipe = { isTTY: false };
  expect(statusPalette(true, pipe, {})).toBe(C);
  expect(statusPalette(false, pipe, {})).toBe(PLAIN);
  expect(statusPalette(false, { isTTY: true }, {})).toBe(C);
  expect(statusPalette(true, { isTTY: true }, { NO_COLOR: '1' })).toBe(PLAIN);
  // An empty NO_COLOR is unset, as no-color.org counts it.
  expect(statusPalette(true, pipe, { NO_COLOR: '' })).toBe(C);

  expect(isClaudeCodePayload(PAYLOAD)).toBe(true);
  for (const text of ['', 'garbage{', '[]', 'null', '{}', '{"session_id":4}']) {
    expect(isClaudeCodePayload(text)).toBe(false);
  }
});

test('the reading counts what the map counts, and an unseeded graph has none', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'combo:browser-automation', name: 'Browser Automation', lifecycle: 'broken' },
      { id: 'combo:version-control', name: 'Version Control', lifecycle: 'verified' },
      { id: 'combo:shell-execution', name: 'Shell Execution', lifecycle: 'reliable' },
      // Recovering: its last check passed, so it is neither failing nor proven.
      { id: 'combo:web-research', name: 'Web Research', lifecycle: 'degraded' },
      // An action is conferred, not reached, and is not counted twice.
      { id: 'act:x/run', name: 'Run', kind: 'action', lifecycle: 'broken' },
    ],
  });
  db.prepare(
    "INSERT INTO proposals (id, goal, status, steps, simulated) VALUES ('p1', 'g', 'draft', '[]', '{}'), ('p2', 'g', 'approved', '[]', '{}')"
  ).run();
  expect(readStatus(db)).toEqual({ failing: ['Browser Automation'], waiting: 1, verified: 2 });
  db.close();

  const empty = makeGraph();
  expect(readStatus(empty)).toBeNull();
  empty.close();
});

test('run as Claude Code runs it: the line on stdout, painted, and exit 0', () => {
  const graph = graphFile({
    lifecycles: { 'combo:browser-automation': 'broken', 'combo:version-control': 'verified' },
    drafts: 2,
  });
  const r = statusline(graph);
  expect(r.status).toBe(0);
  expect(r.stderr).toBe('');
  expect(r.stdout).toContain('\x1b[');
  expect(unpaint(r.stdout)).toBe('! 1 failing: browser automation · › 2 proposals to decide\n');

  // The engine gives the same answer, for `node engine.ts statusline`.
  const engine = statusline(graph, { via: 'engine' });
  expect([engine.status, engine.stdout]).toEqual([0, r.stdout]);

  // NO_COLOR leaves the marks, which say the same thing.
  const plain = statusline(graph, { env: { NO_COLOR: '1' } });
  expect(plain.stdout).toBe('! 1 failing: browser automation · › 2 proposals to decide\n');

  // --json is the reading, for a script that lays out its own line.
  const json = statusline(graph, { args: ['--json'] });
  expect(JSON.parse(json.stdout)).toEqual({
    failing: ['browser automation'],
    waiting: 2,
    verified: 1,
  });
});

test('garbage on stdin, or none, still gets the line, plain', () => {
  const graph = graphFile({ lifecycles: { 'combo:version-control': 'verified' } });
  for (const input of ['garbage{', '', '{"tool_name":"Bash"}']) {
    const r = statusline(graph, { input });
    expect([r.status, r.stdout]).toEqual([0, '1 verified\n']);
  }
});

test('a graph never seeded, or one that is not there, prints nothing and creates nothing', () => {
  const empty = graphFile();
  expect(statusline(empty)).toMatchObject({ status: 0, stdout: '' });

  const missing = join(dir, 'nowhere', 'graph.db');
  expect(statusline(missing)).toMatchObject({ status: 0, stdout: '' });
  expect(existsSync(missing)).toBe(false);

  // Garbage where the graph should be is the same: nothing, and exit 0.
  const notSqlite = join(dir, 'not.db');
  writeFileSync(notSqlite, 'not a database');
  expect(statusline(notSqlite)).toMatchObject({ status: 0, stdout: '' });
});

test('it writes nothing: the graph file is the same bytes afterwards', () => {
  const graph = graphFile({
    lifecycles: { 'combo:browser-automation': 'broken', 'combo:version-control': 'verified' },
    drafts: 1,
  });
  const before = sha(graph);
  for (const via of ['wrapper', 'engine'] as const) {
    expect(statusline(graph, { via }).stdout).not.toBe('');
  }
  expect(sha(graph)).toBe(before);
});

/**
 * Measured on an M-series laptop: about 45ms through an installed copy, which
 * is Node starting and little else, and about 80ms from a checkout, where Node
 * also strips the TypeScript. The bound is generous so a loaded CI runner does
 * not fail it; what it holds is that the status line never starts the engine,
 * which put it near 200ms.
 */
test('it answers well inside the time between two messages', () => {
  const graph = graphFile({ lifecycles: { 'combo:version-control': 'verified' } });
  const fastest = Math.min(...[1, 2, 3].map(() => statusline(graph).ms));
  expect(fastest).toBeLessThan(500);
});
