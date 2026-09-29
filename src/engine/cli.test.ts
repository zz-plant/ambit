/**
 * Command grouping. The five nouns are presentation over the same flat
 * verbs, so the test that matters is that both spellings dispatch identically
 * and that nothing anyone has already typed stops working.
 *
 * After it, what a pipe receives: the other thing that is only real across a
 * process boundary, and the way an agent running `ambit` in a subshell reads it.
 */
import { test, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

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
