/**
 * The demo's two views describe one machine.
 *
 * They used to describe two. `seedDemo` held 25 hand-written config entries;
 * demoTechTree.json held 56 tree nodes made at some earlier point from
 * something else. They shared five ids — so a visitor toggling between "My
 * Setup" and "Tech Tree" saw two unrelated imaginary systems, in a product
 * whose whole claim is that those are two views of one environment.
 *
 * Both are generated from one fixture now (npm run demo:generate), and
 * demo:check fails in CI when they drift from what the engine produces. These
 * hold the properties that made it worth generating.
 */
import { expect, test } from 'vitest';
import demoData from './utils/demo-data.json';

const config = demoData.config as { items: { id: string; type: string }[] };
const tree = demoData.tree as { items: { id: string; meta: { era?: number } }[] };

test('both views are populated', () => {
  expect(config.items.length).toBeGreaterThan(15);
  expect(tree.items.length).toBeGreaterThan(40);
});

test('every setup item exists in the tree — it is one machine, seen twice', () => {
  const treeIds = new Set(tree.items.map(i => i.id));
  const missing = config.items.filter(i => !treeIds.has(i.id)).map(i => i.id);
  // Was 5 of 25 shared, because the two sides keyed the same things
  // differently: `cmd:deploy` against `tool:deploy`, `opencode-core` against
  // `runtime:opencode`. Nothing may fall out of this again silently.
  expect(missing).toEqual([]);
});

test('the tree spans every era, so the demo shows the whole shape', () => {
  const eras = new Set(tree.items.map(i => i.meta?.era).filter(Boolean));
  expect(eras.size).toBe(7);
});

test('nothing from a real machine is in a file served to the public', () => {
  // The demo is on GitHub Pages. A fixture captured from someone's laptop
  // would publish their servers, agents and hostnames.
  const text = JSON.stringify(demoData);
  for (const marker of ['/Users/', '/home/', 'Library/', '.ssh', 'localhost:']) {
    expect(text).not.toContain(marker);
  }
});
