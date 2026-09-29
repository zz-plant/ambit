/**
 * The entry that installs a catalogued option, and why it is never stored.
 *
 * Four of the curated tree's alternatives carry a `config_patch`, and a patch
 * names a command. The catalog is a table, and a table travels: `sync export`
 * carries what it carries, so a patch kept in a row would be a command in a
 * data file. The install text is therefore read from the tree when a page asks
 * for it, in the shape `/api/config/mcp-snippet` returns, and these hold both
 * halves of that: that it is offered where the tree has a patch, and that it is
 * offered nowhere else and kept nowhere.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { catalogReport, installText } from './catalog.ts';
import { seedCatalog } from './seed/declared.ts';
import { exportSync } from './sync.ts';
import { makeGraph } from './testing/graph.ts';

const WEB_RESEARCH = 'combo:web-research';

test('an alternative the tree gives a patch is offered as the entry to paste', () => {
  const text = installText(WEB_RESEARCH, {
    provider: 'search or fetch MCP',
    source: 'techtree',
    rollback: 'reversible',
  });
  expect(JSON.parse(text as string)).toEqual({
    mcp: { fetch: { type: 'local', command: ['uvx', 'mcp-server-fetch'], enabled: true } },
  });
  // Text a person reads before they paste it, so it is laid out to be read.
  expect(text).toContain('\n  "mcp": {');
});

test('an alternative with no patch has no install entry', () => {
  expect(
    installText('combo:embeddings', {
      provider: 'hosted embedding API',
      source: 'techtree',
      rollback: 'irreversible',
    })
  ).toBeUndefined();
  expect(installText('combo:nonesuch', { provider: 'x', source: 'techtree' })).toBeUndefined();
});

test('a row the person declared is never given the tree patch that shares its name', () => {
  // Declared options are numbers about something else, and a patch matched to
  // one by a coincidence of name would put an entry under the wrong price.
  expect(
    installText(WEB_RESEARCH, {
      provider: 'search or fetch MCP',
      source: 'declared',
      rollback: 'reversible',
    })
  ).toBeUndefined();
});

test('a row that says it is irreversible is not shown the patch of an alternative with its name', () => {
  // The tree has two "read-only database MCP" alternatives under data access,
  // one with a patch. The catalog keeps the later, which has none, and marks
  // it irreversible; the earlier one's patch must not be shown against it.
  const provider = 'read-only database MCP';
  expect(
    installText('combo:data-access', { provider, source: 'techtree', rollback: 'irreversible' })
  ).toBeUndefined();
  expect(
    installText('combo:data-access', { provider, source: 'techtree', rollback: 'reversible' })
  ).toContain('mcp-server-sqlite');
});

test('an entry a project overlay names is never offered as the way to install something', () => {
  // An overlay is a file in the working directory, and can arrive with a cloned
  // repository. The page would be handing whatever command it names to a person
  // as the install line, and the overlay is documented as naming none.
  const dir = mkdtempSync(join(tmpdir(), 'ambit-overlay-'));
  const overlay = join(dir, 'techtree.json');
  writeFileSync(
    overlay,
    JSON.stringify({
      nodes: [
        {
          id: 'web-research',
          acquisition: {
            alternatives: [
              {
                name: 'a helpful server',
                setup_seconds: 60,
                config_patch: {
                  mcp: { helpful: { command: ['sh', '-c', 'echo not from the tree'] } },
                },
              },
            ],
          },
        },
      ],
    })
  );
  process.env.AMBIT_OVERLAY_TECHTREE = overlay;
  try {
    // The seed reads the merged tree, so the overlay's alternative is in the
    // catalog and marked reversible, exactly as a shipped one is.
    const db = makeGraph({ capabilities: [{ id: WEB_RESEARCH, category: 'combo' }] });
    seedCatalog(db, {});
    const row = (
      catalogReport(db, WEB_RESEARCH) as { options: { provider: string }[] }
    ).options.find(o => o.provider === 'a helpful server');
    db.close();
    expect(row).toMatchObject({ source: 'techtree', rollback: 'reversible' });

    expect(installText(WEB_RESEARCH, row as never)).toBeUndefined();
    // The shipped alternative is still offered its own.
    expect(
      installText(WEB_RESEARCH, {
        provider: 'search or fetch MCP',
        source: 'techtree',
        rollback: 'reversible',
      })
    ).toContain('mcp-server-fetch');
  } finally {
    delete process.env.AMBIT_OVERLAY_TECHTREE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the catalog keeps no patch, and a sync file cannot carry one', () => {
  const db = makeGraph({ capabilities: [{ id: WEB_RESEARCH, category: 'combo' }] });
  seedCatalog(db, {});
  const rows = JSON.stringify(db.prepare('SELECT * FROM catalog').all());
  expect(rows).toContain('search or fetch MCP');
  expect(rows).not.toContain('mcp-server-fetch');
  expect(rows).not.toContain('uvx');

  const dir = mkdtempSync(join(tmpdir(), 'ambit-catalog-'));
  const file = join(dir, 'sync.json');
  exportSync(db, file);
  expect(readFileSync(file, 'utf8')).not.toContain('mcp-server-fetch');
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('the option the catalog reports for an alternative is the one that gets its entry', () => {
  const db = makeGraph({ capabilities: [{ id: WEB_RESEARCH, category: 'combo' }] });
  seedCatalog(db, {});
  const { options } = catalogReport(db, WEB_RESEARCH) as {
    options: { provider: string; source?: string; rollback?: string }[];
  };
  db.close();
  const withEntry = options.filter(o => installText(WEB_RESEARCH, o));
  expect(withEntry.map(o => o.provider)).toEqual(['search or fetch MCP']);
});
