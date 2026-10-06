/**
 * Scoped tech tree overlay tests.
 * Roadmap §13.11 / Issue #51: supporting .ambit/techtree.json or AMBIT_OVERLAY_TECHTREE
 * to overlay custom capability definitions without modifying core.
 */
import { test, expect, afterEach } from 'vitest';
import { loadTechTree, overlayTechTreePath } from './paths.ts';
import { makeGraph } from './testing/graph.ts';
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tempOverlayDir = join(tmpdir(), `ambit-test-overlay-${Date.now()}`);
const tempOverlayFile = join(tempOverlayDir, 'techtree.json');

afterEach(() => {
  delete process.env.AMBIT_OVERLAY_TECHTREE;
  if (existsSync(tempOverlayFile)) unlinkSync(tempOverlayFile);
  if (existsSync(tempOverlayDir)) rmdirSync(tempOverlayDir);
});

test('overlayTechTreePath recognizes environment variable', () => {
  process.env.AMBIT_OVERLAY_TECHTREE = '/tmp/custom-techtree.json';
  expect(overlayTechTreePath()).toBe('/tmp/custom-techtree.json');
});

test('loadTechTree merges new capability nodes from overlay', () => {
  mkdirSync(tempOverlayDir, { recursive: true });
  const customTree = {
    nodes: [
      {
        id: 'custom-crispr-design',
        name: 'CRISPR Design',
        domain: 'biological',
        description: 'Design guide RNAs for gene editing',
        era: 4,
        detect: { any: ['tool:crispr-cli'] },
        requires: ['command-line'],
      },
    ],
  };
  writeFileSync(tempOverlayFile, JSON.stringify(customTree, null, 2));
  process.env.AMBIT_OVERLAY_TECHTREE = tempOverlayFile;

  const tree = loadTechTree();
  const found = tree.nodes.find((n: any) => n.id === 'custom-crispr-design');
  expect(found).toBeDefined();
  expect(found.name).toBe('CRISPR Design');
  expect(found.domain).toBe('biological');
  expect(found.requires).toContain('command-line');
});

test('overlay nodes merge with existing nodes without dropping core attributes', () => {
  mkdirSync(tempOverlayDir, { recursive: true });
  // Extend core version-control with an extra detection pattern
  const overlay = {
    nodes: [
      {
        id: 'version-control',
        detect: { any: ['custom-git-fork'] },
      },
    ],
  };
  writeFileSync(tempOverlayFile, JSON.stringify(overlay, null, 2));
  process.env.AMBIT_OVERLAY_TECHTREE = tempOverlayFile;

  const tree = loadTechTree();
  const vc = tree.nodes.find((n: any) => n.id === 'version-control');
  expect(vc).toBeDefined();
  expect(vc.detect.any).toContain('custom-git-fork');
  // Retains existing core patterns
  expect(vc.name).toBe('Version Control');
});

test('seeding a graph with overlay creates combo capability node and contract actions', async () => {
  const { seedTechTree } = await import('./seed/techtree.ts');
  const { nodeWriter } = await import('./seed/writers.ts');

  mkdirSync(tempOverlayDir, { recursive: true });
  const customTree = {
    nodes: [
      {
        id: 'homelab-truenas',
        name: 'TrueNAS Storage',
        domain: 'infrastructure',
        description: 'ZFS pool management and snapshots',
        era: 2,
        detect: { any: ['truenas'] },
        contract: { can: ['snapshot', 'scrub'] },
      },
    ],
  };
  writeFileSync(tempOverlayFile, JSON.stringify(customTree, null, 2));
  process.env.AMBIT_OVERLAY_TECHTREE = tempOverlayFile;

  const db = makeGraph({
    capabilities: [{ id: 'provider:truenas', name: 'TrueNAS MCP' }],
  });

  seedTechTree(db, nodeWriter(db));

  const row = db
    .prepare('SELECT id, name, domain FROM capabilities WHERE id = ?')
    .get('combo:homelab-truenas');
  expect(row).toBeDefined();
  expect((row as any).name).toBe('TrueNAS Storage');
  expect((row as any).domain).toBe('infrastructure');

  // Verify action nodes generated from contract
  const act = db
    .prepare('SELECT id, name FROM capabilities WHERE id = ?')
    .get('act:homelab-truenas/snapshot');
  expect(act).toBeDefined();

  db.close();
});

// ── Authority: an overlay narrows, never widens ─────────────────────────────

/**
 * An overlay is a file in whatever directory `ambit` runs from, so a cloned
 * repository that ships `.ambit.json` is a file that travelled. Seed the
 * payments node with an overlay and ask the gate what it now permits.
 */
async function seedWithOverlay(overlay: any, capabilities: { id: string; name: string }[]) {
  const { seedTechTree } = await import('./seed/techtree.ts');
  const { nodeWriter } = await import('./seed/writers.ts');
  const { seedAuthority } = await import('./seed/declared.ts');
  const { canExecute } = await import('./assurance.ts');

  mkdirSync(tempOverlayDir, { recursive: true });
  writeFileSync(tempOverlayFile, JSON.stringify(overlay));
  process.env.AMBIT_OVERLAY_TECHTREE = tempOverlayFile;

  const db = makeGraph({ capabilities });
  seedTechTree(db, nodeWriter(db));
  seedAuthority(db, {});
  return { db, decide: (capability: string) => canExecute(db, { capability }).decision };
}

const stripe = [{ id: 'provider:stripe', name: 'Stripe MCP' }];

test('an overlay cannot widen a curated forbidden action to autonomous', async () => {
  const { db, decide } = await seedWithOverlay(
    {
      nodes: [
        {
          id: 'payments',
          authority: {
            observe: 'autonomous',
            execute: 'autonomous',
            actions: { issue_refund: 'autonomous', change_price: 'autonomous' },
          },
        },
      ],
    },
    stripe
  );
  expect(decide('act:payments/issue_refund')).toBe('DENY');
  expect(decide('act:payments/change_price')).toBe('CONFIRM');
  expect(decide('combo:payments')).toBe('CONFIRM');
  db.close();
});

test('override: true cannot widen a curated mode either', async () => {
  const { db, decide } = await seedWithOverlay(
    {
      nodes: [
        {
          id: 'payments',
          override: true,
          name: 'Payments',
          description: 'Take payments',
          era: 8,
          domain: 'backend',
          detect: { any: ['stripe'] },
          contract: { can: ['issue_refund'] },
          authority: { execute: 'autonomous', actions: { issue_refund: 'autonomous' } },
        },
      ],
    },
    stripe
  );
  expect(decide('act:payments/issue_refund')).toBe('DENY');
  expect(decide('combo:payments')).toBe('CONFIRM');
  db.close();
});

test('an overlay may narrow a curated mode', async () => {
  const { db, decide } = await seedWithOverlay(
    { nodes: [{ id: 'payments', authority: { actions: { change_price: 'forbidden' } } }] },
    stripe
  );
  expect(decide('act:payments/change_price')).toBe('DENY');
  // A key the overlay leaves out keeps its curated mode.
  expect(decide('act:payments/create_payment_link')).toBe('CONFIRM');
  expect(decide('act:payments/issue_refund')).toBe('DENY');
  db.close();
});

test('a node only the overlay names may not be granted autonomy', async () => {
  const { db, decide } = await seedWithOverlay(
    {
      nodes: [
        {
          id: 'homelab-truenas',
          name: 'TrueNAS Storage',
          domain: 'infrastructure',
          description: 'ZFS pool management and snapshots',
          era: 2,
          detect: { any: ['truenas'] },
          contract: { can: ['snapshot', 'destroy_pool'] },
          authority: {
            execute: 'autonomous',
            actions: { snapshot: 'autonomous', destroy_pool: 'forbidden' },
          },
        },
      ],
    },
    [{ id: 'provider:truenas', name: 'TrueNAS MCP' }]
  );
  expect(decide('combo:homelab-truenas')).toBe('CONFIRM');
  expect(decide('act:homelab-truenas/snapshot')).toBe('CONFIRM');
  expect(decide('act:homelab-truenas/destroy_pool')).toBe('DENY');
  db.close();
});
