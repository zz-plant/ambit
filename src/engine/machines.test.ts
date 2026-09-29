/**
 * What an agent may do on each machine, and that the answer is the gate's.
 *
 * A machine is a target the gate is asked about, and a grant can be scoped to
 * one. The tempting shortcut is the report `ambit authority scope` prints, whose
 * `effective` is the narrowest of the covering grants: under it a standing
 * "confirm everywhere" beats a grant that says "autonomous on staging", so the
 * trade of a smaller blast radius for unattended work could never be expressed.
 * These hold the table to `canExecute`, which resolves a forbidden grant first
 * and then the most specific scope, the way `apply` does.
 */
import { expect, test } from 'vitest';
import { scopeReport } from './assurance.ts';
import { RECOVERY_CAPABILITY } from './incident.ts';
import { machineModes } from './machines.ts';
import { makeGraph } from './testing/graph.ts';

const ACTIONS = ['install_package', 'read_output', 'run_command'];
const actionId = (name: string) => `act:shell-execution/${name}`;

type Grant = { action: string; mode: 'autonomous' | 'confirm' | 'forbidden'; scope?: string };

/** Shell Execution with its three actions, and the given execute grants on them. */
function graph(grants: Grant[]) {
  return makeGraph({
    capabilities: [
      { id: RECOVERY_CAPABILITY, name: 'Shell Execution', category: 'combo' },
      ...ACTIONS.map(name => ({
        id: actionId(name),
        name,
        category: 'action',
        kind: 'action' as const,
      })),
    ],
    dependencies: ACTIONS.map(name => ({
      from: RECOVERY_CAPABILITY,
      to: actionId(name),
      kind: 'provides' as const,
    })),
    authority: grants.map(g => ({
      capability: actionId(g.action),
      action: 'execute',
      mode: g.mode,
      scope: g.scope,
    })),
  });
}

const standing: Grant[] = [
  { action: 'read_output', mode: 'autonomous' },
  { action: 'run_command', mode: 'confirm' },
  { action: 'install_package', mode: 'confirm' },
];

const decisions = (db: ReturnType<typeof graph>, id: string) =>
  Object.fromEntries(
    (machineModes(db, [id])[0]?.actions ?? []).map(a => [a.name, a.decision] as const)
  );

test('the actions are the ones the tree gives the capability that acts on a machine', () => {
  const db = graph(standing);
  const [nuc] = machineModes(db, ['nuc']);
  db.close();

  expect(nuc.actions.map(a => a.name)).toEqual(ACTIONS);
  expect(nuc.actions.map(a => a.id)).toEqual(ACTIONS.map(actionId));
});

test('a machine is asked about as itself: device:<id>, and the local engine keeps its own prefix', () => {
  const db = graph(standing);
  const machines = machineModes(db, ['nuc', 'device:docker']);
  db.close();

  expect(machines.map(m => [m.id, m.target])).toEqual([
    ['nuc', 'device:nuc'],
    ['device:docker', 'device:docker'],
  ]);
});

test('with no grant scoped to a machine, every machine gets the standing answer', () => {
  const db = graph(standing);
  const a = decisions(db, 'nuc');
  const b = decisions(db, 'gpu-box');
  db.close();

  expect(a).toEqual({
    read_output: 'ALLOW',
    run_command: 'CONFIRM',
    install_package: 'CONFIRM',
  });
  expect(b).toEqual(a);
});

test('a grant scoped to one machine counts there and nowhere else', () => {
  const db = graph([
    ...standing,
    { action: 'run_command', mode: 'autonomous', scope: 'device:staging' },
  ]);
  const staging = decisions(db, 'staging');
  const nuc = decisions(db, 'nuc');
  db.close();

  expect(staging.run_command).toBe('ALLOW');
  expect(nuc.run_command).toBe('CONFIRM');
  // The other two are untouched on both.
  expect(staging.install_package).toBe('CONFIRM');
});

test('the answer is the gate, not the narrowest covering grant that the scope report calls effective', () => {
  const db = graph([
    ...standing,
    { action: 'run_command', mode: 'autonomous', scope: 'device:staging' },
  ]);
  const gate = decisions(db, 'staging').run_command;
  // `scopeReport` resolves by narrowest wins, so the standing confirm beats the
  // scoped autonomous grant and staging reads as asking. The gate does not.
  const narrowest = (
    scopeReport(db, 'device:staging') as { grants: { id: string; covers: boolean; mode: string }[] }
  ).grants
    .filter(g => g.id === actionId('run_command') && g.covers)
    .map(g => g.mode);
  db.close();

  expect(narrowest).toContain('confirm');
  expect(gate).toBe('ALLOW');
});

test('a forbidden grant wins at any specificity, so a narrower scope is no way round it', () => {
  const db = graph([
    { action: 'read_output', mode: 'autonomous' },
    { action: 'run_command', mode: 'confirm' },
    { action: 'install_package', mode: 'forbidden' },
    { action: 'install_package', mode: 'autonomous', scope: 'device:staging' },
  ]);
  const staging = decisions(db, 'staging');
  db.close();

  expect(staging.install_package).toBe('DENY');
});

test('a grant scoped to another machine does not cover this one, and a refusal says why', () => {
  const db = graph([{ action: 'run_command', mode: 'autonomous', scope: 'device:prod' }]);
  const [staging] = machineModes(db, ['staging']);
  db.close();

  // Nothing covers staging, so the gate refuses, in its own words.
  const run = staging.actions.find(a => a.name === 'run_command');
  expect(run?.decision).toBe('DENY');
  expect(run?.reason).toContain('No grant covers');
});

test('a graph whose tree names no actions for that capability has nothing to ask', () => {
  const db = makeGraph({ capabilities: [{ id: RECOVERY_CAPABILITY, category: 'combo' }] });
  expect(machineModes(db, ['nuc'])).toEqual([]);
  db.close();
  expect(machineModes(makeGraph({}), [])).toEqual([]);
});

test('asking writes nothing', () => {
  const db = graph([
    ...standing,
    { action: 'run_command', mode: 'autonomous', scope: 'device:staging' },
  ]);
  const rows = () => JSON.stringify(db.prepare('SELECT * FROM authority ORDER BY id').all());
  const changes = () => db.prepare('SELECT total_changes() AS n').get<{ n: number }>()?.n;
  const before = [rows(), changes()];

  machineModes(db, ['staging', 'nuc']);
  expect([rows(), changes()]).toEqual(before);
  db.close();
});
