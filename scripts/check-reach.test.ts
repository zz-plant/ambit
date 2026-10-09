/**
 * The reach rule, on the stack that stranded #97, #98 and #99.
 *
 * roadmap/batch2 reached main through #96. #97 then merged eco/batch3 into
 * roadmap/batch2, and #98 and #99 merged into eco/batch3. Each step was green.
 * These pin the two moments the check has to speak: when #96 merged and left
 * #97 pointing at a branch nothing would merge again, and afterwards, when the
 * three merged ones had to be named.
 */
import { expect, test } from 'vitest';
import { type Pull, routeToMain, stranded, strandingRisk } from './check-reach.ts';

const pull = (number: number, head: string, base: string, mergeCommit?: string): Pull => ({
  number,
  title: `PR ${number}`,
  head,
  base,
  mergeCommit,
});

const p96 = pull(96, 'roadmap/batch2', 'main');
const p97 = pull(97, 'eco/batch3', 'roadmap/batch2');
const p98 = pull(98, 'eco/batch4', 'eco/batch3');
const p99 = pull(99, 'eco/batch5', 'eco/batch3');

test('a branch is on its way to main through the open pull requests above it', () => {
  expect(routeToMain('main', [], 'main')).toEqual([]);
  expect(routeToMain('eco/batch4', [p96, p97, p98], 'main')).toEqual([98, 97, 96]);
  expect(routeToMain('eco/batch3', [p97], 'main')).toBeNull();
  // A loop is no route.
  const a = pull(1, 'a', 'b');
  const b = pull(2, 'b', 'a');
  expect(routeToMain('a', [a, b], 'main')).toBeNull();
});

test('a stacked pull request is safe while the one below it is open', () => {
  expect(strandingRisk(p97, [p96, p97], 'main')).toBeNull();
  expect(strandingRisk(p98, [p96, p97, p98], 'main')).toBeNull();
});

test('once the bottom of the stack merges, the next one up is named before it merges', () => {
  // #96 is merged, so it is no longer open, and #97 still targets its branch.
  const risk = strandingRisk(p97, [p97, p98, p99], 'main');
  expect(risk).toMatch(/^#97 targets roadmap\/batch2, and no open pull request takes it to main/);
  expect(risk).toMatch(/retarget it to main/);
  // The ones above #97 lost their route with it.
  expect(strandingRisk(p98, [p97, p98, p99], 'main')).toMatch(/^#98 targets eco\/batch3/);
});

test('merged work that main does not hold, with nothing open to bring it, is stranded', () => {
  const merged = [p96, p97, p98, p99];
  const onMain = new Set([96]);
  const found = stranded(merged, [], 'main', pr => onMain.has(pr.number));
  expect(found.map(p => p.number)).toEqual([97, 98, 99]);
});

test('merged into a branch still on its way is in flight, not stranded', () => {
  // #98 merged into eco/batch3 while #97 and #96 were open.
  const found = stranded([p98], [p96, p97], 'main', () => false);
  expect(found).toEqual([]);
});

test('work main holds under rewritten ids counts as reached', () => {
  // #1 merged into main, and the history was rewritten afterwards: its merge
  // commit is gone, and the subjects of its commits are all on main.
  const p1 = pull(1, 'review', 'main', 'gone');
  const reached = (pr: Pull) => pr.number === 1;
  expect(stranded([p1], [], 'main', reached)).toEqual([]);
  expect(stranded([p1], [], 'main', () => false).map(p => p.number)).toEqual([1]);
});
