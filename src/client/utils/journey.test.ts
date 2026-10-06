/**
 * The loadout's seven legs, read from the graph and the ledger.
 *
 * Every sentence is a fact the page already holds, a leg nothing recorded says
 * so and draws no zero, and a command that carries an id is quoted for a
 * shell, because an id is whatever an agent or a sync file typed.
 */
import { expect, test } from 'vitest';
import { demoProposals } from '../store/demo';
import { demoSnapshot } from './demoSnapshot';
import { journeyLegs } from './journey';

const fallback = { reached: 0, total: 0, verified: 0 };

test('the demo walks all seven legs, each from a figure the page already has', () => {
  const loop = demoSnapshot();
  const legs = journeyLegs(loop, demoProposals(), fallback);
  expect(legs.map(l => l.key)).toEqual([
    'stand',
    'next',
    'add',
    'trust',
    'stand-up',
    'paid',
    'ask',
  ]);
  const said = Object.fromEntries(legs.map(l => [l.key, l.said]));
  expect(said.stand).toContain(`${loop.status.reached} of ${loop.status.total} reached`);
  expect(said.next).toContain(loop.next[0].capability);
  expect(said.trust).toContain(`${loop.authority.autonomous} may act without asking`);
  expect(said.paid).toContain(`${loop.attention.interventions} times you stepped in`);
  expect(said.ask).toContain(loop.demand[0].name);
  // The gradual hand-over offers the command that sets the bar.
  expect(legs.find(l => l.key === 'trust')?.command).toBe(loop.authority.promotable[0].command);
});

test('with no ledger the legs it feeds say nothing was recorded, and draw no zero', () => {
  const legs = journeyLegs(null, [], { reached: 4, total: 10, verified: 1 });
  const by = Object.fromEntries(legs.map(l => [l.key, l]));
  // The glossary's word, as the header's count says it.
  expect(by.stand.said).toBe('4 of 10 reached, 1 verified by a passing check.');
  for (const key of ['next', 'trust', 'paid', 'ask']) {
    expect(by[key].state, key).toBe('unrecorded');
    expect(by[key].said, key).not.toMatch(/\b0\b/);
  }
});

test('a command built from an id is quoted for the shell it will be pasted into', () => {
  const loop = demoSnapshot();
  loop.next = [{ ...loop.next[0], id: 'skill:x$(rm -rf ~)' }];
  const next = journeyLegs(loop, [], fallback).find(l => l.key === 'next');
  expect(next?.command).toBe("ambit propose 'skill:x$(rm -rf ~)'");
});
