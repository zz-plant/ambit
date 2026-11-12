/**
 * What the release guard decides, on a history shaped like the one that left
 * 0.7.1 unreleased: the bump arrived as the merge of a pull request, and
 * package.json changed again after it for other reasons.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { parse } from 'yaml';
import {
  bumpCommit,
  decide,
  type Facts,
  gather,
  type Git,
  git,
  ReleaseError,
  remoteTags,
  route,
  tagAndPush,
} from './release-tag.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ─── The decision alone ───────────────────────────────────────────────────────

const facts = (over: Partial<Facts>): Facts => ({
  version: '0.7.1',
  tags: new Map([['v0.6.0', 'a'.repeat(40)]]),
  bump: 'b'.repeat(40),
  versionAt: () => null,
  ...over,
});

test('an untagged version is released from the commit that set it', () => {
  expect(decide(facts({}))).toMatchObject({
    action: 'release',
    tag: 'v0.7.1',
    commit: 'b'.repeat(40),
    create: true,
  });
});

test('a version already tagged where it was set is not released again', () => {
  const tags = new Map([['v0.7.1', 'b'.repeat(40)]]);
  expect(decide(facts({ tags }))).toMatchObject({ action: 'skip', tag: 'v0.7.1' });
});

test('a tag pushed by hand to a later commit of the same version counts as released', () => {
  const tags = new Map([['v0.7.1', 'c'.repeat(40)]]);
  const plan = decide(facts({ tags, versionAt: () => '0.7.1' }));
  expect(plan).toMatchObject({ action: 'skip', tag: 'v0.7.1' });
  expect(plan.why).toMatch(/by hand at ccccccc; bbbbbbb set the version/);
});

test('a tag on a commit of another version is an error, not a release and not a skip', () => {
  const tags = new Map([['v0.7.1', 'c'.repeat(40)]]);
  expect(() => decide(facts({ tags, versionAt: () => '0.7.0' }))).toThrow(ReleaseError);
  expect(() => decide(facts({ tags, versionAt: () => '0.7.0' }))).toThrow(
    /v0.7.1 exists at ccccccc, where package.json says 0.7.0.*git push origin :refs\/tags\/v0.7.1/
  );
});

test('a version older than one already released is refused', () => {
  const tags = new Map([
    ['v0.6.0', 'a'.repeat(40)],
    ['v0.7.2', 'c'.repeat(40)],
    ['v0.9.0-rc.1', 'd'.repeat(40)],
  ]);
  expect(() => decide(facts({ tags }))).toThrow(/0.7.1, older than v0.7.2/);
  // A prerelease tag is not a release a stable version has to pass.
  expect(decide(facts({ version: '0.8.0', tags }))).toMatchObject({ action: 'release' });
});

test('no version, or no commit that set it, is an error', () => {
  expect(() => decide(facts({ version: null }))).toThrow(/no version to release/);
  expect(() => decide(facts({ version: 'next' }))).toThrow(/no version to release/);
  expect(() => decide(facts({ bump: null }))).toThrow(/fetch-depth: 0/);
});

test('a tag releases as named; main releases its version; another branch releases nothing', () => {
  expect(route('refs/tags/v0.7.1', '')).toEqual({ by: 'tag', tag: 'v0.7.1' });
  expect(route('refs/heads/main', ' v0.6.0 ')).toEqual({ by: 'tag', tag: 'v0.6.0' });
  expect(route('refs/heads/main', '')).toEqual({ by: 'version' });
  // Outside Actions there is no ref: a dry run in a checkout.
  expect(route('', '')).toEqual({ by: 'version' });
  expect(() => route('refs/heads/feature', '')).toThrow(/is not main/);
});

// ─── On a real repository ─────────────────────────────────────────────────────

interface Repo {
  run: Git;
  /** Runs git against the bare remote, as another clone pushing would. */
  remote: Git;
  remoteDir: string;
  work: string;
  env: NodeJS.ProcessEnv;
  commit: (pkg: object, message: string) => string;
  merge: (branch: string, pkg: object, message: string) => string;
}

function repo(): Repo {
  const dir = mkdtempSync(join(tmpdir(), 'ambit-release-'));
  dirs.push(dir);
  // Nothing from the developer's own git config: no signing, no hooks.
  const env = {
    PATH: process.env.PATH,
    HOME: dir,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
  const remoteDir = join(dir, 'origin.git');
  const work = join(dir, 'work');
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', remoteDir], { env });
  execFileSync('git', ['init', '--quiet', '-b', 'main', work], { env });
  const run = git(work, env);
  run(['remote', 'add', 'origin', remoteDir]);
  const commit = (pkg: object, message: string) => {
    writeFileSync(join(work, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    run(['add', '-A']);
    run(['commit', '--quiet', '-m', message]);
    return run(['rev-parse', 'HEAD']);
  };
  // A pull request: a branch off main, merged with a merge commit.
  const merge = (branch: string, pkg: object, message: string) => {
    run(['checkout', '--quiet', '-b', branch]);
    commit(pkg, message);
    run(['checkout', '--quiet', 'main']);
    run(['merge', '--quiet', '--no-ff', '-m', `Merge pull request from ${branch}`, branch]);
    return run(['rev-parse', 'HEAD']);
  };
  return { run, remote: git(remoteDir, env), remoteDir, work, env, commit, merge };
}

/**
 * 0.6.0 released and tagged; 0.7.0 bumped and never tagged; 0.7.1 merged
 * from a pull request; then package.json touched twice for its dependencies,
 * once directly and once by a merged pull request.
 */
function history() {
  const r = repo();
  const v060 = r.commit({ name: 'ambit-cli', version: '0.6.0' }, 'Release 0.6.0');
  const v070 = r.commit({ name: 'ambit-cli', version: '0.7.0' }, 'Release 0.7.0');
  writeFileSync(join(r.work, 'README.md'), 'readme\n');
  r.run(['add', '-A']);
  r.run(['commit', '--quiet', '-m', 'Docs']);
  const bump = r.merge('release-071', { name: 'ambit-cli', version: '0.7.1' }, 'Release 0.7.1');
  const branchBump = r.run(['rev-parse', 'release-071']);
  r.commit({ name: 'ambit-cli', version: '0.7.1', dependencies: { a: '^1' } }, 'Add a');
  const deps = r.merge(
    'deps',
    { name: 'ambit-cli', version: '0.7.1', dependencies: { a: '^2' } },
    'Bump a'
  );
  r.run(['push', '--quiet', 'origin', 'main']);
  r.run(['push', '--quiet', 'origin', `${v060}:refs/tags/v0.6.0`]);
  return { ...r, v060, v070, bump, branchBump, deps };
}

test('the bump is the merge on main that set the version, whatever touched package.json since', () => {
  const h = history();
  expect(bumpCommit(h.run, 'HEAD', '0.7.1')).toBe(h.bump);
  expect(bumpCommit(h.run, 'HEAD', '0.7.1')).not.toBe(h.branchBump);
  expect(bumpCommit(h.run, 'HEAD', '0.7.0')).toBe(h.v070);
  expect(bumpCommit(h.run, 'HEAD', '0.5.0')).toBeNull();
});

test('an untagged version is tagged at its bump, annotated, and the next run finds it released', () => {
  const h = history();
  const plan = decide(gather(h.run, 'HEAD', 'origin'));
  expect(plan).toMatchObject({ action: 'release', tag: 'v0.7.1', commit: h.bump, create: true });

  expect(tagAndPush(h.run, 'origin', plan)).toMatchObject({
    action: 'release',
    tag: 'v0.7.1',
    create: false,
  });
  expect(remoteTags(h.run, 'origin').get('v0.7.1')).toBe(h.bump);
  expect(h.remote(['cat-file', '-t', 'refs/tags/v0.7.1'])).toBe('tag');

  // Another push that touches package.json, after the release.
  h.commit({ name: 'ambit-cli', version: '0.7.1', dependencies: { a: '^3' } }, 'Bump a again');
  h.run(['push', '--quiet', 'origin', 'main']);
  expect(decide(gather(h.run, 'HEAD', 'origin'))).toMatchObject({ action: 'skip', tag: 'v0.7.1' });
});

test('a tag pushed elsewhere on a commit the clone lacks, of another version, is an error', () => {
  const h = history();
  // Another clone tags a commit of its own and pushes only the tag.
  const other = join(h.work, '..', 'other');
  execFileSync('git', ['clone', '--quiet', h.remoteDir, other], { env: h.env });
  const o = git(other, h.env);
  writeFileSync(join(other, 'package.json'), '{ "version": "0.7.0" }\n');
  o(['commit', '--quiet', '-am', 'Wrong commit']);
  o(['push', '--quiet', 'origin', 'HEAD:refs/tags/v0.7.1']);

  expect(() => decide(gather(h.run, 'HEAD', 'origin'))).toThrow(
    /v0.7.1 exists at \w{7}, where package.json says 0.7.0/
  );
});

test('a tag pushed to the same commit while the run decided is left to the run it started', () => {
  const h = history();
  const plan = decide(gather(h.run, 'HEAD', 'origin'));
  h.remote(['tag', 'v0.7.1', h.bump]);
  expect(tagAndPush(h.run, 'origin', plan)).toMatchObject({ action: 'skip', tag: 'v0.7.1' });
  // The lightweight tag that got there first is the one kept.
  expect(h.remote(['cat-file', '-t', 'refs/tags/v0.7.1'])).toBe('commit');
});

test('a tag pushed to another commit while the run decided fails the run', () => {
  const h = history();
  const plan = decide(gather(h.run, 'HEAD', 'origin'));
  h.remote(['tag', 'v0.7.1', h.deps]);
  expect(() => tagAndPush(h.run, 'origin', plan)).toThrow(
    /v0.7.1 was pushed to \w{7} while this run was tagging \w{7}/
  );
  expect(remoteTags(h.run, 'origin').get('v0.7.1')).toBe(h.deps);
});

// ─── The command release.yml runs ─────────────────────────────────────────────

const SCRIPT = resolve('scripts/release-tag.ts');

function guard(h: Repo, env: Record<string, string>, args: string[] = ['--push']) {
  const output = join(h.work, '..', `output-${Math.random().toString(36).slice(2)}`);
  writeFileSync(output, '');
  const printed = execFileSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', SCRIPT, ...args],
    {
      cwd: h.work,
      env: { ...h.env, GITHUB_OUTPUT: output, GITHUB_ACTIONS: 'true', ...env },
      encoding: 'utf8',
    }
  );
  return { printed, output: readFileSync(output, 'utf8') };
}

test('the guard tags and says release on the first push, and says nothing to do on the next', () => {
  const h = history();
  const head = h.run(['rev-parse', 'HEAD']);
  const main = { GITHUB_REF: 'refs/heads/main', GITHUB_SHA: head };

  const first = guard(h, main);
  expect(first.output).toBe('release=true\ntag=v0.7.1\n');
  expect(first.printed).toMatch(/^::notice title=Release::Releasing v0\.7\.1/);
  expect(remoteTags(h.run, 'origin').get('v0.7.1')).toBe(h.bump);

  const second = guard(h, main);
  expect(second.output).toBe('release=false\ntag=v0.7.1\n');
  expect(second.printed).toMatch(/Nothing to release/);
});

test('without --push the guard tags nothing and releases nothing', () => {
  const h = history();
  const run = guard(h, { GITHUB_REF: 'refs/heads/main' }, []);
  expect(run.output).toBe('release=false\ntag=v0.7.1\n');
  expect(run.printed).toMatch(/Would tag \w{7} as v0\.7\.1/);
  expect(remoteTags(h.run, 'origin').has('v0.7.1')).toBe(false);
});

test('a tag push, or a tag named by hand, is released as before and tags nothing', () => {
  const h = history();
  expect(guard(h, { GITHUB_REF: 'refs/tags/v0.6.0' }).output).toBe('release=true\ntag=v0.6.0\n');
  expect(guard(h, { GITHUB_REF: 'refs/heads/main', RELEASE_TAG: 'v0.6.0' }).output).toBe(
    'release=true\ntag=v0.6.0\n'
  );
  expect(remoteTags(h.run, 'origin').has('v0.7.1')).toBe(false);
});

// ─── The workflow that runs it ────────────────────────────────────────────────

test('release.yml runs the guard on version pushes and still publishes from its own file', () => {
  const wf = parse(readFileSync(resolve('.github/workflows/release.yml'), 'utf8'));
  expect(wf.on.push.tags).toEqual(['v*']);
  expect(wf.on.push.branches).toEqual(['main']);
  expect(wf.on.push.paths).toContain('package.json');

  const guardJob = wf.jobs.guard;
  const step = guardJob.steps.find((s: any) => s.id === 'decide');
  expect(step.run).toContain('scripts/release-tag.ts --push');
  // The names the script writes to GITHUB_OUTPUT.
  expect(guardJob.outputs.release).toMatch(/^\$\{\{ steps\.decide\.outputs\.release \}\}$/);
  expect(guardJob.outputs.tag).toMatch(/^\$\{\{ steps\.decide\.outputs\.tag \}\}$/);
  expect(wf.jobs.release.needs).toBe('guard');
  expect(wf.jobs.release.if).toBe("needs.guard.outputs.release == 'true'");

  // npm trusted publishing is configured for this file by name: publishing
  // must stay in it, not move to a workflow it calls.
  const publish = wf.jobs.npm.steps.map((s: any) => s.run ?? '').join('\n');
  expect(publish).toContain('npm publish --provenance');
  expect(wf.jobs.npm.permissions['id-token']).toBe('write');
});
