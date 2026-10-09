/**
 * That merged work reaches main.
 *
 * Pull requests #97, #98 and #99 were merged into branches that had already
 * been merged into main. Every merge was green and every branch's checks
 * passed, and nothing asked whether a merge reached the default branch, so
 * about nine thousand reviewed lines sat on dead branches until someone read
 * the history. A stack of pull requests does this when its bottom merges into
 * main and the next one up still targets the branch it was stacked on.
 *
 * One rule answers both questions asked here: a branch is on its way to main
 * when an open pull request takes it there, directly or through others.
 *
 *   --pr=<n>  Is this open pull request's base on its way? If not, merging
 *             it strands its work. CI asks this of every pull request.
 *   (none)    Is every open pull request's base on its way, and did every
 *             merged one reach main? Asked on each push to main, which is the
 *             moment a stack's bottom merges and leaves the rest pointing at a
 *             branch nothing will merge again, and daily.
 *
 * A merged pull request reached main when main contains its merge commit, or
 * a commit with the subject of each of its own: the history was rewritten on
 * 2026-08-12 to take a leaked database out of it, which gave #1 and #2 new
 * ids for the same commits.
 */
import { execFileSync } from 'node:child_process';

export interface Pull {
  number: number;
  title: string;
  base: string;
  head: string;
  mergeCommit?: string;
}

/** How many pull requests a route may pass through before it is taken to be a loop. */
const MAX_HOPS = 10;

/**
 * The open pull requests that take `branch` to `main`, nearest first: none
 * for main itself, and null when no route exists.
 */
export function routeToMain(
  branch: string,
  open: readonly Pull[],
  main: string,
  seen: ReadonlySet<string> = new Set()
): number[] | null {
  if (branch === main) return [];
  if (seen.has(branch) || seen.size >= MAX_HOPS) return null;
  const next = new Set(seen).add(branch);
  for (const pr of open.filter(p => p.head === branch)) {
    const rest = routeToMain(pr.base, open, main, next);
    if (rest) return [pr.number, ...rest];
  }
  return null;
}

/** Why merging this open pull request as it stands would strand its work, or null. */
export function strandingRisk(pr: Pull, open: readonly Pull[], main: string): string | null {
  if (pr.base === main) return null;
  const others = open.filter(p => p.number !== pr.number);
  if (routeToMain(pr.base, others, main)) return null;
  return `#${pr.number} targets ${pr.base}, and no open pull request takes it to ${main}. Merged as it is, its work stops there: retarget it to ${main}, or open a pull request from ${pr.base}.`;
}

/**
 * The merged pull requests whose work main does not hold and that nothing
 * open will bring there. One merged into a branch still on its way is in
 * flight, not stranded.
 */
export function stranded(
  merged: readonly Pull[],
  open: readonly Pull[],
  main: string,
  reached: (pr: Pull) => boolean
): Pull[] {
  return merged.filter(
    pr => (pr.base === main || !routeToMain(pr.base, open, main)) && !reached(pr)
  );
}

// ─── Reading GitHub and git ───────────────────────────────────────────────────

function gh(args: string[]): any {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

function pulls(state: 'open' | 'merged', limit: number): Pull[] {
  return gh([
    'pr',
    'list',
    '--state',
    state,
    '--limit',
    String(limit),
    '--json',
    'number,title,baseRefName,headRefName,mergeCommit',
  ]).map((p: any) => ({
    number: p.number,
    title: p.title,
    base: p.baseRefName,
    head: p.headRefName,
    mergeCommit: p.mergeCommit?.oid,
  }));
}

function isAncestor(oid: string, ref: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', oid, ref], { stdio: 'ignore' });
    return true;
  } catch {
    // Not an ancestor, or a commit this clone does not have.
    return false;
  }
}

function subjectsOn(ref: string): Set<string> {
  const log = execFileSync('git', ['log', ref, '--format=%s'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return new Set(log.split('\n').filter(Boolean));
}

function commitSubjects(number: number): string[] {
  return gh(['pr', 'view', String(number), '--json', 'commits']).commits.map(
    (c: any) => c.messageHeadline as string
  );
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) =>
    args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) || undefined;
  const mainBranch = flag('main') ?? 'main';
  const ref = flag('ref') ?? `origin/${mainBranch}`;
  const limit = Number(flag('limit')) || 300;
  const open = pulls('open', 200);
  const problems: string[] = [];

  const only = flag('pr');
  if (only) {
    const pr = open.find(p => p.number === Number(only));
    const risk = pr && strandingRisk(pr, open, mainBranch);
    if (risk) problems.push(risk);
  } else {
    for (const pr of open) {
      const risk = strandingRisk(pr, open, mainBranch);
      if (risk) problems.push(risk);
    }
    const subjects = subjectsOn(ref);
    const reached = (pr: Pull) =>
      Boolean(pr.mergeCommit && isAncestor(pr.mergeCommit, ref)) ||
      commitSubjects(pr.number).every(s => subjects.has(s));
    for (const pr of stranded(pulls('merged', limit), open, mainBranch, reached)) {
      problems.push(
        `#${pr.number} (${pr.title}) was merged into ${pr.base} and never reached ${mainBranch}: merge ${pr.base} into ${mainBranch}.`
      );
    }
  }

  if (!problems.length) {
    console.log(
      only
        ? `#${only} reaches ${mainBranch} once merged.`
        : `Every merged pull request reached ${mainBranch}, and every open one is on its way.`
    );
    return;
  }
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

if (process.argv[1]?.endsWith('check-reach.ts')) main();
