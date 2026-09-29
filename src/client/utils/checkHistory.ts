/**
 * The runs behind a check, and which node's runs a My Setup row shows.
 *
 * An entry read out of a config has no check of its own: the checks run against
 * the tree nodes it provides, so a row answers for those. A row is one line, and
 * one strip, so when an entry provides several nodes the strip is the worst
 * node's. Worst is the node the row's verdict is about: one whose check is
 * failing now, else the one that failed most recently, else the one with the
 * most runs behind it.
 *
 * Pure, and tested without a window. The engine orders a node's runs and the
 * client draws them as given; the only comparison made here is between nodes.
 */
import type { CheckRun } from '../../shared/api';
import { isFailing } from '../components/civ/layout';
import type { Item } from './configImporter';

/**
 * A node's recorded runs, oldest first. Nothing when none were sent, or when
 * what was sent is not a list of runs: an absent history is a real answer, and
 * a half-formed one must not draw as a strip of something.
 */
export function runsOf(item: Pick<Item, 'meta'>): CheckRun[] {
  const raw = item.meta?.history;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is CheckRun =>
      typeof r === 'object' &&
      r !== null &&
      Number.isFinite((r as CheckRun).id) &&
      typeof (r as CheckRun).passed === 'boolean'
  );
}

/**
 * The ledger row of a node's newest failure, or 0 when none of its runs failed.
 *
 * A row id and not a time: `ambit verify` records a batch inside one second, so
 * the failures of two nodes checked together share a timestamp and only the row
 * says which came last.
 */
const lastFailure = (runs: CheckRun[]): number =>
  runs.reduce((row, r) => (r.passed ? row : Math.max(row, r.id)), 0);

/** How many times a node's check has run in all, which is more than the window holds. */
const runsBehind = (node: Item, runs: CheckRun[]): number => {
  const total = (node.meta?.reliability as { total?: unknown } | undefined)?.total;
  return typeof total === 'number' && Number.isFinite(total) ? total : runs.length;
};

export interface CheckTrail {
  /** The node whose runs these are: the entry itself when its checks run against it. */
  node: Item;
  runs: CheckRun[];
}

/**
 * The one strip a row shows, and whose it is; null when nothing it answers for
 * has run a check, which is a row with no strip.
 *
 * An entry with runs of its own, a skill an agent registered and proved, shows
 * those. Otherwise the provided nodes are ranked, and a node failing now comes
 * before one that failed once and has passed since, however recent that
 * failure: the strip has to be about the node the row calls failing, or the row
 * would read "check failing" over a strip that ends green.
 */
export function trailOf(entry: Item, provided: Item[]): CheckTrail | null {
  const own = runsOf(entry);
  if (own.length) return { node: entry, runs: own };
  const ranked = provided
    .map(node => ({ node, runs: runsOf(node) }))
    .filter(t => t.runs.length > 0)
    .sort(
      (a, b) =>
        Number(isFailing(b.node)) - Number(isFailing(a.node)) ||
        lastFailure(b.runs) - lastFailure(a.runs) ||
        runsBehind(b.node, b.runs) - runsBehind(a.node, a.runs) ||
        a.node.id.localeCompare(b.node.id)
    );
  return ranked[0] ?? null;
}

/** The one command that finds out why a check is failing. The page cannot run it. */
export const verifyCommand = (node: Pick<Item, 'id'>): string => `ambit verify ${node.id}`;

/**
 * What a strip says in words, for a screen reader and for the tooltip: how many
 * of the runs shown passed, and how the newest went. Colour is never the only
 * encoding, and neither is height.
 */
export function describeRuns(runs: CheckRun[], of?: string): string {
  if (!runs.length) return '';
  const failed = runs.filter(r => !r.passed).length;
  const newest = runs[runs.length - 1];
  const count = `${runs.length} ${runs.length === 1 ? 'check' : 'checks'}`;
  return (
    `${of ? `${of}: last` : 'Last'} ${count}, oldest first: ` +
    `${runs.length - failed} passed, ${failed} failed. The latest ${newest.passed ? 'passed' : 'failed'}.`
  );
}
