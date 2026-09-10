/**
 * The staleness rule, which is the part of the asset check that has been wrong
 * before.
 *
 * Its first version failed CI whenever an image was older than the last commit
 * to src/client. That is true after every client commit, including ones that
 * change no pixel, and the only remedy was re-recording a 425KB binary — so the
 * check pushed half a megabyte into git history per UI commit and went red on a
 * scrollbar fix. The rule is a rot detector, not a correctness check, and these
 * pin what it treats as rot.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { commitsBehind, stalenessOf } from './check-assets.ts';

test('an image recorded after the last client change is current', () => {
  expect(stalenessOf(0)).toBe('current');
  expect(stalenessOf(0, true)).toBe('current');
});

test('a handful of client commits is drift, not rot', () => {
  // A lint pass and a CSS fix are one or two commits. Failing here is what
  // made the gate something to disable rather than something to trust.
  for (const behind of [1, 2, 5, 11]) {
    expect(stalenessOf(behind)).toBe('drifting');
  }
});

test('enough commits without a re-record is stale', () => {
  // The failure this exists to catch was fourteen commits and two UI
  // generations behind.
  expect(stalenessOf(12)).toBe('stale');
  expect(stalenessOf(14)).toBe('stale');
  expect(stalenessOf(200)).toBe('stale');
});

test('strict treats any drift as stale', () => {
  // For a release, where re-recording once is proportionate.
  expect(stalenessOf(1, true)).toBe('stale');
  expect(stalenessOf(11, true)).toBe('stale');
});

/**
 * How far behind an image is, over a real history.
 *
 * `stalenessOf` above is the rule; this is the measurement feeding it, and it
 * is the half that was wrong. It asked for commits `--since` the asset's own
 * commit date, and git's `--since` keeps a commit sitting exactly on the bound
 * — so the one commit that touched both the GIF and the client counted against
 * the GIF, and `--strict` failed a release on an asset recorded minutes before.
 * Faking git here would pin nothing, since the fault was in what git was asked.
 */
let repo: string;

function git(args: string[], at = '2026-01-01T00:00:00Z'): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_AUTHOR_DATE: at,
      GIT_COMMITTER_DATE: at,
    },
  });
}

/** Writes the files, then commits them as one — the shape that used to misfire. */
function commit(message: string, files: Record<string, string>, at?: string): void {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), body);
  }
  git(['add', '-A']);
  git(['commit', '-q', '--no-gpg-sign', '-m', message], at);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'ambit-assets-test-'));
  git(['init', '-q', '-b', 'main']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

test('an asset committed alongside src/client is not behind its own commit', () => {
  // The normal way a re-recorded GIF lands: the new binary and the client
  // change that prompted it go in together. `--since=@<its own date>` counted
  // that commit against the asset — 'drifting' by default, and a failed
  // release under --strict.
  commit('re-record the hero for the new panel', {
    'src/client/panel.tsx': 'export const Panel = () => null;\n',
    'docs/assets/demo.gif': 'GIF89a first\n',
  });

  expect(commitsBehind('docs/assets/demo.gif', 'src/client', repo)).toEqual([]);
  expect(stalenessOf(0, true)).toBe('current');
});

test('client commits after the asset commit are counted, and only those', () => {
  commit('re-record the hero for the new panel', {
    'src/client/panel.tsx': 'export const Panel = () => null;\n',
    'docs/assets/demo.gif': 'GIF89a first\n',
  });
  commit('restyle the panel', { 'src/client/panel.tsx': 'export const Panel = () => <div />;\n' });
  commit('touch a doc', { 'docs/notes.md': 'unrelated\n' });

  expect(commitsBehind('docs/assets/demo.gif', 'src/client', repo)).toHaveLength(1);
});

test('commits sharing a second are separated, which a +1s offset would not do', () => {
  // Why the fix is a commit range and not an adjusted timestamp: two commits a
  // second apart — or in the same second, as a scripted regeneration produces —
  // are indistinguishable by date.
  const t = '2026-03-01T12:00:00Z';
  commit('re-record the hero', { 'docs/assets/demo.gif': 'GIF89a first\n' }, t);
  commit('client change in the same second', { 'src/client/panel.tsx': 'export {};\n' }, t);

  expect(commitsBehind('docs/assets/demo.gif', 'src/client', repo)).toHaveLength(1);
});

test('an asset git has never seen reports as uncommitted rather than current', () => {
  commit('client only', { 'src/client/panel.tsx': 'export {};\n' });

  expect(commitsBehind('docs/assets/demo.gif', 'src/client', repo)).toBeNull();
});
