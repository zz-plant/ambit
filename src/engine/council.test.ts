/**
 * The council: five seats on the step `ambit next` puts first.
 *
 * What the test holds is the disagreement. The frontier ranks a step by what
 * it opens and the fragility report knows what it would rest on, and a person
 * reading one at a time could take the step and learn afterwards that it hung
 * one more thing on a single provider. Here both speak on the same step, and
 * the answer says they are split. The other rule held is silence: a seat with
 * nothing recorded to read says so, and is never drawn as an opinion.
 */
import { expect, test } from 'vitest';
import { council } from './council.ts';
import { makeGraph } from './testing/graph.ts';

/** A graph where Deploy is one step away and rests on a capability with one provider. */
function oneProvider(over: Parameters<typeof makeGraph>[0] = {}) {
  return makeGraph({
    capabilities: [
      { id: 'mcp:github', name: 'GitHub', kind: 'provider', category: 'mcp' },
      { id: 'combo:version-control', name: 'Version Control', category: 'combo' },
      { id: 'combo:tests', name: 'Automated Tests', category: 'combo' },
      { id: 'combo:deploy', name: 'Deploy', category: 'combo', state: 'locked', setupSeconds: 600 },
      ...(over.capabilities ?? []),
    ],
    dependencies: [
      { from: 'mcp:github', to: 'combo:version-control', kind: 'provides' },
      { from: 'combo:version-control', to: 'combo:deploy' },
      { from: 'combo:tests', to: 'combo:deploy' },
      ...(over.dependencies ?? []),
    ],
    authority: over.authority,
  });
}

const seat = (c: ReturnType<typeof council>, name: string) =>
  c.advisors.find(a => a.seat === name)!;

test('the frontier is for the step and fragility is against it, so the council is split', () => {
  const db = oneProvider();
  const c = council(db);
  db.close();

  expect(c.motion?.id).toBe('combo:deploy');
  expect(c.advisors.map(a => a.seat)).toEqual([
    'science',
    'defence',
    'treasury',
    'justice',
    'interior',
  ]);

  const science = seat(c, 'science');
  expect(science.stance).toBe('for');
  expect(science.command).toBe('ambit propose deploy');
  expect(science.subject?.id).toBe('combo:deploy');

  const defence = seat(c, 'defence');
  expect(defence.stance).toBe('against');
  expect(defence.says).toContain('Deploy would rest on Version Control');
  expect(defence.says).toContain('GitHub');
  expect(defence.subject?.id).toBe('combo:version-control');
  expect(defence.command).toBe('ambit impact combo:version-control');

  expect(c.split).toBe(true);
});

test('a seat with nothing recorded to read is silent, and says what would fill it', () => {
  const db = oneProvider();
  const c = council(db);
  db.close();

  const treasury = seat(c, 'treasury');
  expect(treasury.stance).toBe('silent');
  expect(treasury.says).toContain('No interventions recorded');
  // The bridge that would record them, never a figure drawn from nothing.
  expect(treasury.command).toContain('ambit-telemetry.js');

  const interior = seat(c, 'interior');
  expect(interior.stance).toBe('neutral');
  expect(interior.says).toBe('Nothing is failing and nothing has gone untended.');
});

test('authority reads the step by the default the tree gives it', () => {
  const db = oneProvider({ authority: [{ capability: 'combo:deploy', mode: 'autonomous' }] });
  const justice = seat(council(db), 'justice');
  db.close();

  expect(justice.stance).toBe('neutral');
  expect(justice.says).toContain('would run unattended by default');
  // The narrower grant it suggests is a command for a person to paste, and
  // names the person: nothing here grants anything.
  expect(justice.command).toBe('ambit authority grant deploy confirm --by=<person>');
});

test('a failing check puts the frontier and the checks on opposite sides', () => {
  // A configured capability whose check fails is unusable, so `ambit next`
  // ranks reaching it first: it would open Deploy. Science says propose it;
  // the checks say it is already there and failing. Both are true.
  const db = oneProvider();
  db.prepare("UPDATE capabilities SET lifecycle = 'broken' WHERE id = 'combo:tests'").run();
  const c = council(db);
  db.close();

  expect(c.motion?.id).toBe('combo:tests');
  expect(seat(c, 'science').stance).toBe('for');
  const interior = seat(c, 'interior');
  expect(interior.stance).toBe('against');
  expect(interior.says).toContain('Automated Tests is configured and failing its check');
  expect(interior.command).toBe('ambit verify combo:tests');
  expect(interior.subject?.id).toBe('combo:tests');
  expect(c.split).toBe(true);
});

test('a prerequisite failing its check turns the checks seat against the step on it', () => {
  // Deploy needs both; with Automated Tests reached and Version Control
  // failing, the frontier still puts a locked step first, and the checks name
  // the foundation under it.
  const db = oneProvider({
    capabilities: [
      {
        id: 'combo:release',
        name: 'Release',
        category: 'combo',
        state: 'locked',
        setupSeconds: 60,
      },
    ],
    dependencies: [{ from: 'combo:deploy', to: 'combo:release' }],
  });
  db.prepare(
    "UPDATE capabilities SET lifecycle = 'broken' WHERE id = 'combo:version-control'"
  ).run();
  db.prepare("UPDATE capabilities SET state = 'unlocked' WHERE id = 'combo:deploy'").run();
  const c = council(db);
  db.close();

  expect(c.motion?.id).toBe('combo:version-control');
  const interior = seat(c, 'interior');
  expect(interior.stance).toBe('against');
  expect(interior.command).toBe('ambit verify combo:version-control');
});

test('with nothing one step away every seat still sits, and none is for', () => {
  const db = makeGraph({
    capabilities: [{ id: 'mcp:git', name: 'Git', category: 'mcp' }],
  });
  const c = council(db);
  db.close();

  expect(c.motion).toBeNull();
  expect(c.advisors).toHaveLength(5);
  expect(seat(c, 'science').stance).toBe('silent');
  expect(c.advisors.some(a => a.stance === 'for')).toBe(false);
  expect(c.split).toBe(false);
  // Every seat speaks in one sentence with no command run: the words are the whole answer.
  for (const a of c.advisors) expect(a.says.length).toBeGreaterThan(10);
});
