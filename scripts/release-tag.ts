/**
 * Which version to release, and the tag that releases it.
 *
 * Releasing started when a person pushed a `v*` tag, and for 0.7.0 and 0.7.1
 * nobody did: package.json said 0.7.1 on main for days while npm served
 * 0.6.0, whose `ambit --version` was an unknown command. release.yml runs this
 * first, in its guard job, so that merging a version bump is the release.
 *
 * On a push to main, or a run started by hand with no tag, the version is the
 * one package.json holds there, and `v<version>` on the remote says whether it
 * has been released. Tagged: nothing to do. Untagged: the commit that set it
 * is the newest one on main's first-parent line whose package.json has it and
 * whose first parent's does not, which is the merge of the pull request that
 * bumped it however often package.json changed since. With `--push` that
 * commit gets an annotated tag, pushed with the workflow's token, and the jobs
 * after the guard release it in the same run. A tag pushed with that token
 * starts no workflow, which is what keeps it from being released twice.
 *
 * On a tag push, or a run started by hand with a tag, the tag is the release
 * and passes through, so a tag pushed by hand releases as it always has.
 *
 * Without `--push` it writes nothing and says what it would do: run it on
 * main to see what merging a bump will release.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/** A failure a person has to act on: the message says what to do. */
export class ReleaseError extends Error {}

export type Plan =
  /** `create`: the tag is not on the remote yet, and `commit` is where it goes. */
  | { action: 'release'; tag: string; commit?: string; create: boolean; why: string }
  | { action: 'skip'; tag: string; why: string };

/** How a run was asked to release. */
export type Route = { by: 'tag'; tag: string } | { by: 'version' };

const short = (sha: string) => sha.slice(0, 7);

/**
 * A tag pushed or named by hand is released as given; a push to main, or a
 * run on main naming no tag, releases main's version. Any other branch
 * releases nothing on its own: a version there has not been merged.
 */
export function route(ref: string, asked: string): Route {
  if (ref.startsWith('refs/tags/')) return { by: 'tag', tag: ref.slice('refs/tags/'.length) };
  if (asked.trim()) return { by: 'tag', tag: asked.trim() };
  if (ref && ref !== 'refs/heads/main') {
    throw new ReleaseError(
      `${ref} is not main. A version is released from main once it is merged; to release a tag from here, name it.`
    );
  }
  return { by: 'version' };
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

/** The released versions: tags of the form vX.Y.Z, no prerelease suffix. */
function releasedVersions(tags: Iterable<string>): number[][] {
  const out: number[][] = [];
  for (const tag of tags) {
    const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
    if (m) out.push([Number(m[1]), Number(m[2]), Number(m[3])]);
  }
  return out;
}

const compare = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The newest released tag above `version`, or null. */
function newerTag(version: string, tags: Iterable<string>): string | null {
  const m = SEMVER.exec(version);
  if (!m) return null;
  const mine = [Number(m[1]), Number(m[2]), Number(m[3])];
  const above = releasedVersions(tags)
    .filter(v => compare(v, mine) > 0)
    .sort(compare);
  const top = above.at(-1);
  return top ? `v${top.join('.')}` : null;
}

export interface Facts {
  /** package.json's version at the head of main, or null when it has none. */
  version: string | null;
  /** Every tag on the remote, by name, with the commit it points at. */
  tags: ReadonlyMap<string, string>;
  /** The commit on main's first-parent line that set `version`, or null. */
  bump: string | null;
  /** package.json's version at a commit, or null when it has none. */
  versionAt: (commit: string) => string | null;
}

/** What a push to main releases, from what git says. Throws a ReleaseError when a person must act. */
export function decide(f: Facts): Plan {
  if (!f.version || !SEMVER.test(f.version)) {
    throw new ReleaseError(
      `package.json on main has no version to release (found ${JSON.stringify(f.version)}).`
    );
  }
  const tag = `v${f.version}`;
  const tagged = f.tags.get(tag);
  if (tagged) {
    if (tagged === f.bump) {
      return {
        action: 'skip',
        tag,
        why: `${tag} is tagged at ${short(tagged)}, the commit that set it.`,
      };
    }
    // A tag pushed by hand goes where the person put it, usually main's head
    // at the time. Its own run released it, so it is not released again.
    const there = f.versionAt(tagged);
    if (there === f.version) {
      const set = f.bump ? `; ${short(f.bump)} set the version` : '';
      return { action: 'skip', tag, why: `${tag} is tagged by hand at ${short(tagged)}${set}.` };
    }
    throw new ReleaseError(
      `${tag} exists at ${short(tagged)}, where package.json says ${there ?? 'no version'}, so no release can come from it and none has. Delete the tag (git push origin :refs/tags/${tag}) and run Release again, or bump the version.`
    );
  }
  if (!f.bump) {
    throw new ReleaseError(
      `No commit on main's first-parent line sets version ${f.version}. The guard needs the whole history (fetch-depth: 0).`
    );
  }
  // Published, an older version becomes npm's `latest`: a revert of a bump
  // should not do that without a person.
  const newer = newerTag(f.version, f.tags.keys());
  if (newer) {
    throw new ReleaseError(
      `package.json says ${f.version}, older than ${newer}, which is already released. Bump the version past ${newer}, or push a tag by hand to release an older line on purpose.`
    );
  }
  return {
    action: 'release',
    tag,
    commit: f.bump,
    create: true,
    why: `${tag} has no tag, and ${short(f.bump)} set the version.`,
  };
}

// ─── Reading and writing git ──────────────────────────────────────────────────

/** Runs git with these arguments and returns what it printed. */
export type Git = (args: string[]) => string;

export function git(cwd: string, env: NodeJS.ProcessEnv = process.env): Git {
  return args =>
    execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
}

function attempt(run: Git, args: string[]): string | null {
  try {
    return run(args);
  } catch {
    return null;
  }
}

/** package.json's version at a commit, or null when it has none or no package.json. */
export function versionAt(run: Git, commit: string): string | null {
  const text = attempt(run, ['show', `${commit}:package.json`]);
  if (text === null) return null;
  try {
    const { version } = JSON.parse(text);
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

/**
 * The newest commit on `head`'s first-parent line whose package.json says
 * `version` and whose first parent's does not. On main that is the merge that
 * brought the bump in, not the commit on the pull request's branch.
 */
export function bumpCommit(run: Git, head: string, version: string): string | null {
  const touched = run(['log', '--first-parent', '--format=%H', head, '--', 'package.json'])
    .split('\n')
    .filter(Boolean);
  for (const commit of touched) {
    if (versionAt(run, commit) !== version) continue;
    const parent = run(['log', '-1', '--format=%P', commit]).split(' ').filter(Boolean)[0];
    if (!parent || versionAt(run, parent) !== version) return commit;
  }
  return null;
}

/** Every tag on the remote, with the commit an annotated one points at. */
export function remoteTags(run: Git, remote: string): Map<string, string> {
  const direct = new Map<string, string>();
  const peeled = new Map<string, string>();
  for (const line of run(['ls-remote', '--tags', remote]).split('\n')) {
    const [sha, ref] = line.split('\t');
    if (!sha || !ref?.startsWith('refs/tags/')) continue;
    const name = ref.slice('refs/tags/'.length);
    if (name.endsWith('^{}')) peeled.set(name.slice(0, -3), sha);
    else direct.set(name, sha);
  }
  for (const [name, sha] of peeled) direct.set(name, sha);
  return direct;
}

/** What `decide` needs, read from the clone at `head` and from the remote. */
export function gather(run: Git, head: string, remote: string): Facts {
  const version = versionAt(run, head);
  return {
    version,
    tags: remoteTags(run, remote),
    bump: version ? bumpCommit(run, head, version) : null,
    versionAt: commit => {
      // A tag pushed after the checkout points at a commit the clone may lack.
      if (attempt(run, ['cat-file', '-e', `${commit}^{commit}`]) === null) {
        attempt(run, ['fetch', '--quiet', '--no-tags', remote, `refs/tags/v${version}`]);
      }
      return versionAt(run, commit);
    },
  };
}

const BOT = [
  '-c',
  'user.name=github-actions[bot]',
  '-c',
  'user.email=41898282+github-actions[bot]@users.noreply.github.com',
];

/**
 * Tags the plan's commit and pushes the tag. The remote takes one tag of a
 * name, so when another push got there first this says what that means: at
 * the same commit, whoever pushed it releases it; anywhere else, a person
 * has to look.
 */
export function tagAndPush(run: Git, remote: string, plan: Plan): Plan {
  if (plan.action !== 'release' || !plan.create || !plan.commit) return plan;
  const { tag, commit } = plan;
  run([...BOT, 'tag', '-a', tag, commit, '-m', `ambit-cli ${tag.slice(1)}`]);
  try {
    run(['push', '--quiet', remote, `refs/tags/${tag}`]);
    return { ...plan, create: false, why: `${plan.why} Tagged it and pushed ${tag}.` };
  } catch (err) {
    const now = remoteTags(run, remote).get(tag);
    if (now === commit) {
      return {
        action: 'skip',
        tag,
        why: `${tag} was pushed to ${short(commit)} by something else while this run decided, and the run that push started releases it.`,
      };
    }
    if (now) {
      throw new ReleaseError(
        `${tag} was pushed to ${short(now)} while this run was tagging ${short(commit)}, the commit that set the version. Check which is meant before anything is published from either.`
      );
    }
    throw err;
  }
}

// ─── The command ──────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const unknown = args.filter(a => a !== '--push');
  if (unknown.length) {
    console.error(
      `Unknown argument: ${unknown.join(' ')}\nUsage: node --experimental-strip-types scripts/release-tag.ts [--push]`
    );
    process.exit(2);
  }
  const push = args.includes('--push');
  const inActions = Boolean(process.env.GITHUB_ACTIONS);
  const run = git(process.cwd());
  let plan: Plan;
  try {
    const how = route(process.env.GITHUB_REF ?? '', process.env.RELEASE_TAG ?? '');
    if (how.by === 'tag') {
      plan = { action: 'release', tag: how.tag, create: false, why: `${how.tag} was named.` };
    } else {
      plan = decide(gather(run, process.env.GITHUB_SHA || 'HEAD', 'origin'));
      if (push) plan = tagAndPush(run, 'origin', plan);
    }
  } catch (err) {
    if (!(err instanceof ReleaseError)) throw err;
    console.error(inActions ? `::error title=Release::${err.message}` : err.message);
    process.exit(1);
  }

  const verdict =
    plan.action === 'skip'
      ? `Nothing to release: ${plan.why}`
      : plan.create
        ? `Would tag ${short(plan.commit ?? '')} as ${plan.tag} and release it: ${plan.why}`
        : `Releasing ${plan.tag}: ${plan.why}`;
  console.log(inActions ? `::notice title=Release::${verdict}` : verdict);

  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    const release = plan.action === 'release' && !plan.create;
    appendFileSync(out, `release=${release}\ntag=${plan.tag}\n`);
  }
}

if (process.argv[1]?.endsWith('release-tag.ts')) main();
