/**
 * Command grouping. The five nouns are presentation over the same thirty-five
 * verbs, so the test that matters is that both spellings dispatch identically
 * and that nothing anyone has already typed stops working.
 */
import { test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ENGINE = join(import.meta.dirname, 'engine.ts');

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
