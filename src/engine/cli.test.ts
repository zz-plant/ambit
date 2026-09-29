/**
 * Command grouping. The five nouns are presentation over the same flat
 * verbs, so the test that matters is that both spellings dispatch identically
 * and that nothing anyone has already typed stops working.
 *
 * After it, what a pipe receives and the exit code: the other things that are
 * only real across a process boundary, and the way an agent running `ambit` in
 * a subshell reads it.
 */
import { test, expect, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { capture } from './cli.ts';
import { getDb, migrate } from './db.ts';

const ENGINE = join(import.meta.dirname, 'engine.ts');

/** The `ambit` a person installs: the wrapper that launches the engine. */
const WRAPPER = join(import.meta.dirname, '..', '..', 'cli.js');

function run(dir: string, ...args: string[]): string {
  return execFileSync('node', ['--experimental-sqlite', ENGINE, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TOOLCHAIN_DB: join(dir, 'graph.db'),
      AMBIT_DB: join(dir, 'graph.db'),
      OPENCODE_CONFIG: join(dir, 'config.json'),
      NODE_NO_WARNINGS: '1',
    },
  });
}

/**
 * Runs the engine, or with `WRAPPER` first the wrapper, with stdout and stderr
 * both piped, and returns all of it with the exit code. NO_COLOR is cleared, so
 * that when nothing is painted the pipe is the only reason.
 */
function piped(dir: string, ...argv: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TOOLCHAIN_DB: join(dir, 'graph.db'),
    AMBIT_DB: join(dir, 'graph.db'),
    OPENCODE_CONFIG: join(dir, 'config.json'),
    NODE_NO_WARNINGS: '1',
  };
  delete env.NO_COLOR;
  const entry = argv[0] === WRAPPER ? [] : ['--experimental-sqlite', ENGINE];
  const r = spawnSync('node', [...entry, ...argv], { encoding: 'utf8', env });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** The escape character, spelled out so no control character sits in the source. */
const ESC = String.fromCharCode(27);

test('a grouped command and its flat name produce the same output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ambit-groups-'));
  try {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ mcp: { fs: { type: 'local' } } }));
    run(dir, 'seed');

    for (const [group, verb] of [
      ['graph', 'where'],
      ['check', 'credentials'],
      ['govern', 'proposals'],
      ['report', 'economics'],
    ]) {
      expect(run(dir, group, verb, '--json')).toBe(run(dir, verb, '--json'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a group name still reaches its own subcommands, not the moved-in ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ambit-groups-'));
  try {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ mcp: { fs: { type: 'local' } } }));
    run(dir, 'seed');
    // `graph` owns `surface` itself; the rewrite must not swallow it.
    expect(JSON.parse(run(dir, 'graph', 'surface', '--json'))).toHaveProperty('runtime');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('help teaches the groups on first contact and lists every verb under --all', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ambit-groups-'));
  try {
    const short = run(dir, 'help');
    expect(short).toContain('graph · plan · check · govern · report');

    const all = run(dir, 'help', '--all');
    for (const verb of ['graph impact', 'plan roi', 'check can', 'govern approve', 'report work']) {
      expect(all).toContain(verb);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nothing a pipe receives is painted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ambit-pipe-'));
  try {
    // In order: the first command meets an empty graph, so the first-run
    // banner and the seed report print ahead of an answer the generic view
    // draws. No config is at the path given, which is the seed report's branch
    // with the most colour in it.
    for (const [argv, says] of [
      [['credentials'], 'First run'],
      [['seed'], 'capabilities'],
      [['nonsense'], 'Unknown'],
      [['help', 'frontier'], 'Where you see it'],
      [['help', 'no-such-term'], 'No concept matching'],
      [['sync'], 'Usage: ambit sync'],
      [[WRAPPER, 'help'], 'ambit mcp'],
      [[WRAPPER], 'Where you are'],
    ] as const) {
      const { stdout, stderr } = piped(dir, ...argv);
      const out = stdout + stderr;
      expect(out).toContain(says);
      expect([argv.join(' '), out.includes(ESC)]).toEqual([argv.join(' '), false]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the exit code says what the words say', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ambit-exit-'));
  try {
    // Seeded first, so the first-run report is no part of what follows.
    run(dir, 'seed');

    // A verb nothing knows is a usage error, said on stderr so stdout is empty.
    const unknown = piped(dir, 'nonsense');
    expect([unknown.status, unknown.stdout]).toEqual([2, '']);
    expect(unknown.stderr).toContain('Unknown command: nonsense');
    // The same through the wrapper, which is what an agent runs.
    expect(piped(dir, WRAPPER, 'nonsense').status).toBe(2);

    // A command that answered with an error exits 1, and --json prints the
    // bytes it always printed.
    const usage = piped(dir, 'sync', '--json');
    expect(usage.status).toBe(1);
    const error = 'Usage: ambit sync export [path] | ambit sync import <path>';
    expect(usage.stdout).toBe(`${JSON.stringify({ error }, null, 2)}\n`);
    expect(piped(dir, 'goal', '--paths').status).toBe(1);

    // An answer exits 0.
    expect(piped(dir, 'where').status).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a result taken in-process leaves the exit code to whoever took it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ambit-exit-'));
  const db = getDb(join(dir, 'graph.db'));
  migrate(db);
  const before = process.exitCode;
  const said = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(Number(before) || 0).toBe(0);
    expect(capture(db, ['sync']).error).toContain('Usage');
    expect(process.exitCode).toBe(before);
    // An unknown verb reports no result, so the seam throws; the code stays.
    expect(() => capture(db, ['nonsense'])).toThrow();
    expect(said).toHaveBeenCalledWith(expect.stringContaining('Unknown command: nonsense'));
    expect(process.exitCode).toBe(before);
  } finally {
    said.mockRestore();
    process.exitCode = before;
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
