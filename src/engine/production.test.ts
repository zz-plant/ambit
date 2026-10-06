/**
 * The Product and Operations eras: what a person building alone asks of an
 * agent setup once the agent is writing a product, not only code.
 *
 * The tree knew what agents could do and nothing about running what they
 * built, so `ambit goal "take payments"` and `ambit goal "back up my
 * database"` routed nowhere. These hold the routing, the capstone that turns
 * launch into a checklist, the defaults a careful CTO would set, and the way a
 * person who has no OpenCode config declares themselves so a budget can name
 * them.
 */
import { expect, test } from 'vitest';
import { renderPlan } from './cli/reports.ts';
import { PLAIN } from './cli/output.ts';
import { planFor } from './planning.ts';
import { cli, dir, getDb, join, seed } from './testing/cli.ts';

/** A setup with every piece Launch Ready needs, read from MCP server names alone. */
const LAUNCHABLE = {
  provider: { anthropic: { models: { 'claude-sonnet': {} } } },
  mcp: {
    github: { type: 'local', command: ['github-mcp-server'] },
    'github-actions': { type: 'local', command: ['actions-mcp'] },
    vercel: { type: 'remote', url: 'https://mcp.vercel.com' },
    supabase: { type: 'local', command: ['supabase-mcp'] },
    litestream: { type: 'local', command: ['litestream-mcp'] },
    sentry: { type: 'remote', url: 'https://mcp.sentry.dev/mcp' },
    betterstack: { type: 'remote', url: 'https://mcp.betterstack.com' },
    playwright: { type: 'local', command: ['playwright-mcp'] },
  },
};

test('what a person building a product asks routes to the node that answers it', () => {
  seed({ mcp: { github: { type: 'local', command: ['github-mcp-server'] } } }).close();
  const routes: [string, string][] = [
    ['deploy my app to production', 'combo:hosting'],
    ['know when my site goes down', 'combo:uptime-monitoring'],
    ['take payments', 'combo:payments'],
    ['back up my database', 'combo:backups'],
    ['launch my saas', 'combo:launch-ready'],
    ['add login to my app', 'combo:user-accounts'],
    ['send a welcome email', 'combo:transactional-email'],
    ['see what errors users hit', 'combo:error-tracking'],
  ];
  for (const [sentence, node] of routes) {
    expect([sentence, cli('goal', sentence).recommended]).toEqual([sentence, node]);
  }
});

test('Launch Ready is a checklist until its steps are in place, then reached', () => {
  seed({ mcp: { sentry: { type: 'remote', url: 'https://mcp.sentry.dev/mcp' } } }).close();
  const db = getDb(join(dir, 'graph.db'));
  const plan = planFor(db, 'combo:launch-ready') as any;
  const lines = renderPlan(plan, PLAIN).join('\n');
  db.close();

  expect(lines).toMatch(/Launch Ready · \d+ steps left/);
  expect(lines).toContain('1. Hosting');
  // Sentry is half of Error Tracking already: said, not sent to set up again.
  expect(lines).toContain('sentry is already configured, and counts once Hosting is in place');
  // The capstone is not a step of its own, and no record dump leaks through.
  expect(lines).not.toMatch(/\d+\. Launch Ready/);
  expect(lines).not.toContain('setup seconds');
  expect(lines).toContain('then ambit seed');

  seed(LAUNCHABLE).close();
  const reached = cli('goal', 'launch-ready');
  expect(reached.note).toBe('already reached');
});

test('production defaults read freely, ask before customers notice, and refuse the irreversible', () => {
  seed(LAUNCHABLE).close();
  const decide = (capability: string) => cli('can', capability).decision;
  expect(decide('act:hosting/read_logs')).toBe('ALLOW');
  expect(decide('act:hosting/deploy_production')).toBe('CONFIRM');
  expect(decide('act:hosting/delete_project')).toBe('DENY');
  expect(decide('act:production-database/drop_table')).toBe('DENY');
  expect(decide('act:backups/delete_backup')).toBe('DENY');

  // A person's grant does not widen a curated refusal, at any scope.
  cli('authority', 'grant', 'act:hosting/delete_project', 'autonomous', '--by=sam');
  expect(decide('act:hosting/delete_project')).toBe('DENY');
});

test('ambit people add lets someone with no actors block set a budget, and grants nothing', () => {
  seed(LAUNCHABLE).close();
  const set = () =>
    cli('budget', 'set', 'hosted-inference', '--amount=$50', '--period=month', '--by=sam');
  const refused = set();
  expect(refused.error).toContain('ambit people add sam');

  const added = cli('people', 'add', 'sam', 'Sam');
  expect(added).toMatchObject({ person: 'human:sam', declared: 'now' });
  expect(cli('people', 'add', 'sam').declared).toBe('already');
  expect(cli('people').people).toEqual([{ id: 'human:sam', name: 'Sam' }]);
  expect(set().error).toBeUndefined();

  // Declaring is not granting: the person holds no authority by being named.
  const db = getDb(join(dir, 'graph.db'));
  const grants = db.prepare("SELECT COUNT(*) AS n FROM authority WHERE holder = 'human:sam'").get();
  db.close();
  expect(grants?.n).toBe(0);
  expect(cli('people', 'add', 'x$(rm)').error).toMatch(/^Usage/);
});

test('the short screen says what moved since the person last looked, once', () => {
  const before = { mcp: { sentry: { type: 'remote', url: 'https://mcp.sentry.dev/mcp' } } };
  seed(before).close();
  // A seed elsewhere, two days later: Hosting arrives, and Sentry with it.
  const db = getDb(join(dir, 'graph.db'));
  db.prepare("UPDATE frontier_snapshots SET taken_at = '2026-01-01 00:00:00'").run();
  db.close();
  seed({
    mcp: { ...before.mcp, vercel: { type: 'remote', url: 'https://mcp.vercel.com' } },
  }).close();
  const back = getDb(join(dir, 'graph.db'));
  back
    .prepare(
      "INSERT INTO schema_meta (key, value) VALUES ('brief-seen', '2026-01-01 00:00:00') ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run();
  back.close();

  const shown = cli('status', '--brief');
  const names = (list: any[]) => list.map(e => e.id);
  expect(names(shown.moved.gained)).toContain('combo:hosting');
  expect(names(shown.moved.emergent)).toContain('combo:error-tracking');
  expect(cli('status', '--brief').moved).toBeUndefined();
});
