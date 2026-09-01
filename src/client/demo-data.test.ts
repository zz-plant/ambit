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

test('the setup view is mostly present in the tree — it is the same machine', () => {
  const treeIds = new Set(tree.items.map(i => i.id));
  const shared = config.items.filter(i => treeIds.has(i.id));
  // Was 5 of 25. The remainder are the commands and the framework, which the
  // two sides key differently (`cmd:deploy` against `tool:deploy`) — a real
  // vocabulary gap between the client's importer and the engine's ontology,
  // and a separate thing to fix.
  expect(shared.length / config.items.length).toBeGreaterThan(0.7);
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
