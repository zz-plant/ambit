/**
 * The words a person types, read the way they meant them.
 *
 * A mistyped command named nothing it might have been. Five commands that
 * take a capability each read the word their own way, so `github` worked in
 * `ambit can`, was refused by `impact`, prefixed into `combo:github` by
 * `authority grant`, and answered "Nothing to report" by `verify --history`.
 * And the note that says how to record what blocks work named the OpenCode
 * plugin to everyone, whatever runtime they use.
 */
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { recordingBridges } from '../paths.ts';
import { cli, dir, getDb, join, seed } from '../testing/cli.ts';
import { PLAIN } from './output.ts';
import { renderNext } from './reports.ts';

const ENGINE = join(import.meta.dirname, '..', 'engine.ts');

const WITH_GITHUB = {
  provider: { ollama: { models: { 'qwen3-coder': {} } } },
  mcp: { github: { type: 'local', command: ['github-mcp-server'] } },
};

test('a mistyped command names the one it was probably meant to be', () => {
  seed(WITH_GITHUB).close();
  const typed = (word: string) =>
    spawnSync(process.execPath, ['--experimental-sqlite', ENGINE, word], {
      encoding: 'utf8',
      env: { ...process.env, AMBIT_DB: join(dir, 'graph.db'), NODE_NO_WARNINGS: '1' },
    });
  const swapped = typed('stauts');
  expect(swapped.stderr).toContain('Unknown command: stauts. Did you mean ambit status?');
  expect(swapped.status).toBe(2);
  expect(typed('verfy').stderr).toContain('Did you mean ambit verify?');
  // Far from everything: no guess, the help instead.
  expect(typed('xyzzy').stderr).toContain('Unknown command: xyzzy. Try: ambit help');
});

test('every command that takes a capability reads a bare name the same way', () => {
  seed(WITH_GITHUB).close();
  expect(cli('impact', 'github').capability).toBe('github');
  // A near miss is a suggestion, never a guess.
  expect(cli('impact', 'gitub')).toMatchObject({
    error: expect.any(String),
    did_you_mean: ['mcp:github'],
  });

  // A server runs no check of its own: the answer names the checks that prove it.
  const verify = cli('verify', 'github');
  expect(verify.error).toMatch(/declares no check of its own/);
  expect(verify.checks.map((c: any) => c.command)).toContain('ambit verify version-control');
  expect(cli('verify', 'github', '--history').checks).toBeDefined();

  const granted = cli('authority', 'grant', 'github', 'confirm', '--by=sam');
  expect(granted.error).toBeUndefined();
  const db = getDb(join(dir, 'graph.db'));
  const row = db
    .prepare(
      "SELECT capability_id FROM authority WHERE holder = 'human:sam' OR source != 'techtree' LIMIT 1"
    )
    .get() as { capability_id: string } | undefined;
  db.close();
  expect(row?.capability_id).toBe('mcp:github');
});

test('ambit next reads as steps with their time, why, and the two commands that act on them', () => {
  const lines = renderNext(
    {
      basis: 'structural — nothing has been recorded as blocking work yet',
      note: 'Record what blocks work and this ranks by it instead: in Cursor, ambit connect cursor --ledger.',
      next: [
        {
          capability: 'Model Routing',
          why: 'Reaching it makes Subagents a next step.',
          cost: '10m',
          privacy: 'hosted',
          plan: 'ambit goal model-routing',
          propose: 'ambit propose model-routing',
        },
      ],
    },
    PLAIN
  ).join('\n');
  expect(lines).toContain('Ranked by what each opens per hour of setup');
  expect(lines).toContain('  1. Model Routing · about 10m · hosted');
  expect(lines).toContain('ambit goal model-routing  ·  ambit propose model-routing');
  expect(lines).not.toMatch(/combo:|capability:/);
});

test('the note on recording what blocks work names the bridge for the runtimes that were read', () => {
  const sources = (labels: string[]) => ({
    prepare: () => ({
      get: () => ({ value: JSON.stringify(labels.map(label => ({ label, servers: [] }))) }),
    }),
  });
  expect(recordingBridges(sources(['Claude Code', 'Cursor'])).map(b => b.runtime)).toEqual([
    'Claude Code',
    'Cursor',
  ]);
  expect(recordingBridges(sources(['Cursor']))[0].command).toBe('ambit connect cursor --ledger');
  // Nothing read, or only runtimes with no bridge: OpenCode's is the answer.
  expect(recordingBridges(sources([])).map(b => b.runtime)).toEqual(['OpenCode']);
  expect(recordingBridges(undefined).map(b => b.runtime)).toEqual(['OpenCode']);
});
