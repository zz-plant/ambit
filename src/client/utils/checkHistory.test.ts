/**
 * Which node's runs a My Setup row shows.
 *
 * The row is one line and holds one strip, and an entry can provide several
 * nodes, so somebody has to be picked. The pick has to be the node the row's own
 * verdict is about, and it has to be decided the same way whichever order the
 * edges arrive in.
 */
import { expect, test } from 'vitest';
import type { CheckRun } from '../../shared/api';
import type { Item } from './configImporter';
import { describeRuns, runsOf, trailOf, verifyCommand } from './checkHistory';

const run = (id: number, passed: boolean): CheckRun => ({ id, passed });

/** A tree node with the given lifecycle and runs. Built unless it says otherwise. */
function node(
  id: string,
  lifecycle: string,
  history: unknown,
  extra: Record<string, unknown> = {}
): Item {
  return {
    id,
    name: id,
    type: 'possibility',
    status: 'built',
    description: '',
    position: { x: 0, y: 0, z: 0 },
    meta: { era: 1, lifecycle, history, ...extra },
  };
}

const entry = (meta: Record<string, unknown> = {}): Item => ({
  id: 'mcp:git',
  name: 'git',
  type: 'mcp-server',
  status: 'built',
  description: '',
  position: { x: 0, y: 0, z: 0 },
  meta: { domain: 'devops', ...meta },
});

test('a row whose nodes have never run a check has no strip', () => {
  expect(trailOf(entry(), [])).toBeNull();
  expect(trailOf(entry(), [node('combo:a', 'configured', undefined)])).toBeNull();
  expect(trailOf(entry(), [node('combo:a', 'configured', [])])).toBeNull();
});

test('an entry whose checks run against it shows its own runs', () => {
  // A skill an agent registered and proved: the runs are its, and the nodes it
  // provides have nothing to add.
  const own = [run(1, true), run(2, false)];
  const provided = node('combo:a', 'broken', [run(9, false)]);
  const trail = trailOf(entry({ history: own }), [provided]);
  expect(trail?.node.id).toBe('mcp:git');
  expect(trail?.runs).toEqual(own);
});

test('a node failing now outranks a more recent failure that has passed since', () => {
  // `broken` failed at row 4 and has not been run again. `steady` failed at row
  // 8 and passed five times after. The row reads "check failing" because of
  // the first, so the strip must be the first's: a strip ending in five green
  // bars under that verdict would contradict it.
  const broken = node('combo:broken', 'broken', [run(3, true), run(4, false)]);
  const steady = node('combo:steady', 'reliable', [
    run(7, true),
    run(8, false),
    ...[9, 10, 11, 12, 13].map(id => run(id, true)),
  ]);
  expect(trailOf(entry(), [steady, broken])?.node.id).toBe('combo:broken');
  expect(trailOf(entry(), [broken, steady])?.node.id).toBe('combo:broken');
});

test('of two nodes that both fail now, the one that failed last', () => {
  // `ambit verify` checks everything inside one second, so a timestamp cannot
  // say which failed last. The row can.
  const early = node('combo:early', 'broken', [run(10, false)]);
  const late = node('combo:late', 'degraded', [run(11, false), run(12, true)]);
  expect(trailOf(entry(), [early, late])?.node.id).toBe('combo:late');
  expect(trailOf(entry(), [late, early])?.node.id).toBe('combo:late');
});

test('with nothing failing now, the most recent failure still leads', () => {
  const old = node('combo:old', 'reliable', [
    run(1, false),
    ...[2, 3, 4, 5, 6].map(i => run(i, true)),
  ]);
  const fresh = node('combo:fresh', 'reliable', [
    ...[7, 8, 9, 10, 11].map(i => run(i, true)),
    run(12, false),
    ...[13, 14, 15, 16, 17].map(i => run(i, true)),
  ]);
  const clean = node('combo:clean', 'reliable', [run(20, true), run(21, true)]);
  expect(trailOf(entry(), [clean, old, fresh])?.node.id).toBe('combo:fresh');
});

test('with no failure anywhere, the node with the most runs behind it', () => {
  // Two runs in the window each, but one has been checked forty times in all.
  const green = [run(1, true), run(2, true)];
  const seasoned = node('combo:seasoned', 'reliable', green, {
    reliability: { passed: 40, total: 40 },
  });
  const newer = node('combo:newer', 'verified', green, { reliability: { passed: 2, total: 2 } });
  expect(trailOf(entry(), [newer, seasoned])?.node.id).toBe('combo:seasoned');
  // Without a reliability count the window itself is what there is to count.
  const long = node('combo:long', 'verified', [run(1, true), run(2, true), run(3, true)]);
  const short = node('combo:short', 'verified', [run(4, true)]);
  expect(trailOf(entry(), [short, long])?.node.id).toBe('combo:long');
});

test('a full tie is broken by id, so the pick does not depend on edge order', () => {
  const a = node('combo:a', 'verified', [run(1, true)]);
  const b = node('combo:b', 'verified', [run(2, true)]);
  expect(trailOf(entry(), [b, a])?.node.id).toBe('combo:a');
  expect(trailOf(entry(), [a, b])?.node.id).toBe('combo:a');
});

test('a history that is not a list of runs is no history', () => {
  // The wire says what a run is; a value that is anything else must not draw
  // as a strip of something, or print as text.
  for (const bad of ['ok', 7, {}, [null], [{ id: 'x', passed: true }], [{ id: 1 }]]) {
    expect(runsOf(node('combo:a', 'verified', bad))).toEqual([]);
  }
  expect(
    runsOf(node('combo:a', 'verified', [run(1, true), { id: 2 }, null, run(3, false)]))
  ).toEqual([run(1, true), run(3, false)]);
});

test('a strip is described in words, with the newest run last', () => {
  expect(describeRuns([run(1, true), run(2, true), run(3, false)], 'Browser Automation')).toBe(
    'Browser Automation: last 3 checks, oldest first: 2 passed, 1 failed. The latest failed.'
  );
  expect(describeRuns([run(1, true)])).toBe(
    'Last 1 check, oldest first: 1 passed, 0 failed. The latest passed.'
  );
  expect(describeRuns([])).toBe('');
});

test('the command that explains a failure is ambit verify, for that node', () => {
  expect(verifyCommand({ id: 'combo:browser-automation' })).toBe(
    'ambit verify combo:browser-automation'
  );
});
