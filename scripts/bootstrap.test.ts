import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { defaultMapping } from '../src/engine/seed/writers.ts';

/**
 * `./bootstrap.sh --dry-run` is what the README offers as the look before the
 * first seed: whether there is an OpenCode config, a running Ollama and a
 * skills directory. It must name the directories the seed reads, and say so
 * when there is none, or the dry run and the seed describe different machines.
 */

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function dryRun(skillDirs: string[]): string {
  const home = mkdtempSync(join(tmpdir(), 'ambit-bootstrap-'));
  homes.push(home);
  for (const dir of skillDirs) {
    mkdirSync(join(home, dir), { recursive: true });
    writeFileSync(join(home, dir, 'one.md'), '');
  }
  return execFileSync('bash', [resolve('bootstrap.sh'), '--dry-run'], {
    env: { PATH: process.env.PATH, HOME: home },
    encoding: 'utf8',
  });
}

test('the dry run reports each skills directory the seed reads', () => {
  const read = defaultMapping().skill_dirs.map((dir: string) => dir.replace(/^~\//, ''));
  expect(read).toContain('.config/opencode/skills');
  for (const dir of read) {
    expect(dryRun([dir])).toContain(`Skills: 1 in ~/${dir}`);
  }
});

test('the dry run says when there is no skills directory', () => {
  const out = dryRun([]);
  expect(out).toContain('opencode.json: not found');
  expect(out).toContain('Skills: no directory found');
});
