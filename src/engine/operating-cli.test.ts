/**
 * The operating half: work recorded, priced, ranked, and measured after the fact.
 *
 * End-to-end: each test seeds a real graph by running the engine CLI. Split out
 * of a single 2,300-line file so a failure names a subject.
 */
import { test, expect } from 'vitest';
import {
  APPLIABLE,
  ENGINE,
  LOCAL_ONLY,
  WITH_ECONOMICS,
  WITH_PREFS,
  addEvent,
  beginRun,
  cli,
  dir,
  endRun,
  execFileSync,
  getDb,
  join,
  recordIntervention,
  recordOutcome,
  recordResource,
  recordUse,
  rows,
  seed,
  usageReport,
  workReport,
  writeFileSync,
} from './testing/cli.ts';

// ── Work ledger (the operating half) ─────────────────────────────────────────
test('a run records events, interventions, usage and an outcome', () => {
  seed(LOCAL_ONLY).close();
  // The recorder takes migrate.ts's driver-agnostic surface, which is a
  // narrower type than the engine's own handle.
  const db = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof beginRun>[0];

  const b = beginRun(db, { goal: 'recover production service', runType: 'incident' });
  addEvent(db, b.run, { kind: 'detected', actor: 'monitoring', detail: 'service down' });
  addEvent(db, b.run, {
    kind: 'diagnosed',
    actor: 'agent',
    capabilityId: 'combo:observability',
    action: 'diagnose',
  });
  recordUse(db, b.run, 'combo:observability', { durationSeconds: 120 });
  recordIntervention(db, b.run, 'human:kanav', {
    kind: 'authority',
    capabilityId: 'combo:shell-execution',
    action: 'restart',
    startedAt: new Date(Date.now() - 90 * 1000).toISOString(),
    endedAt: new Date().toISOString(),
    waitingSeconds: 60,
  });
  recordResource(db, b.run, 'provider:acme', 'api', {
    quantity: 42,
    unit: 'tokens',
    costCents: 12,
  });
  recordOutcome(db, b.run, 'service restored', {
    objectiveMetric: 240,
    objectiveName: 'mttr_seconds',
  });
  endRun(db, b.run, 'success', 5000);

  const work = workReport(db, 5);
  expect(work.length).toBe(1);
  const r = work[0];
  expect(r.goal).toBe('recover production service');
  expect(r.outcome).toBe('success');
  expect(r.events).toBe(2);
  expect(r.capabilities).toHaveLength(1);
  expect(r.capabilities[0].capability).toBe('Observability');
  expect(r.interventions[0].kind).toBe('authority');
  expect(r.interventions[0].times).toBe(1);
  expect(r.resources[0].cost_cents).toBe(12);
  expect(r.achieved).toBe('service restored');
  expect(r.objective_name).toBe('mttr_seconds');
  expect(r.elapsed_seconds).toBeGreaterThanOrEqual(0);

  const usage = usageReport(db, 30);
  const obs = usage.find((u: any) => u.capability === 'Observability');
  expect(obs.times).toBe(1);
  expect(obs.duration_seconds).toBe(120);
  (db as any).close();
});

test('a run without an end is open and reports no outcome', () => {
  seed(LOCAL_ONLY).close();
  const db = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof beginRun>[0];
  const _b = beginRun(db, { goal: 'long task', runType: 'task' });
  const work = workReport(db, 5);
  expect(work[0].goal).toBe('long task');
  expect(work[0].outcome).toBeUndefined();
  expect(endRun(db, 'nope', 'success').error).toContain('No run');
  (db as any).close();
});

test('a run records no capability state — the ledger observes, it does not reach', () => {
  seed(LOCAL_ONLY).close();
  const db = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof beginRun>[0];
  const b = beginRun(db, { goal: 'observe only' });
  recordUse(db, b.run, 'combo:shell-execution', { durationSeconds: 5 });
  endRun(db, b.run, 'success');
  (db as any).close();

  const reopened = getDb(join(dir, 'graph.db'));
  const state = rows(
    reopened,
    "SELECT state FROM capabilities WHERE id = 'combo:shell-execution'"
  )[0].state;
  expect(state).toBe('unlocked'); // seed made it reachable; the run changed nothing
  reopened.close();
});

// ── Human-agency accounting (WP-3) ───────────────────────────────────────────
test('attention classifies agency: judgment is kept, clerical is reducible', () => {
  seed(LOCAL_ONLY).close();
  const db = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof recordIntervention>[0];

  // Judgment, twice — the human's reason for being there. Never reducible.
  const r1 = beginRun(db, { goal: 'architect the migration' });
  recordIntervention(db, r1.run, 'human:kanav', {
    kind: 'judgment',
    capabilityId: 'combo:web-research',
    activeSeconds: 600,
  });
  recordIntervention(db, r1.run, 'human:kanav', {
    kind: 'judgment',
    capabilityId: 'combo:web-research',
    activeSeconds: 300,
  });

  // Clerical, three times across two runs — the human is the duct.
  const r2 = beginRun(db, { goal: 'move data between systems' });
  recordIntervention(db, r1.run, 'human:kanav', {
    kind: 'clerical',
    capabilityId: 'combo:data-access',
    activeSeconds: 120,
    waitingSeconds: 900,
  });
  recordIntervention(db, r2.run, 'human:kanav', {
    kind: 'clerical',
    capabilityId: 'combo:data-access',
    activeSeconds: 90,
    waitingSeconds: 300,
  });
  recordIntervention(db, r2.run, 'human:kanav', {
    kind: 'clerical',
    capabilityId: 'combo:data-access',
    activeSeconds: 60,
    waitingSeconds: 600,
  });
  (db as any).close();

  const d = cli('attention');
  const judgment = d.keepers.find((k: any) => k.kind === 'judgment');
  expect(judgment.times).toBe(2);
  // Reducible never contains judgment, however often it recurs.
  expect(d.reducible?.some((r: any) => r.kind === 'judgment')).toBeFalsy();

  const clerical = d.reducible.find((r: any) => r.kind === 'clerical');
  expect(clerical.times).toBe(3);
  expect(clerical.active_seconds).toBe(270);
  expect(clerical.waiting_seconds).toBe(1800);
  expect(clerical.runs_affected).toBe(2); // two distinct runs hit the same duct
  expect(clerical.suggested_fix).toMatch(/mechanical/);
});

test('attention reports aggregate active and waiting time', () => {
  seed(LOCAL_ONLY).close();
  const db = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof recordIntervention>[0];
  const r = beginRun(db, { goal: 'restart service' });
  recordIntervention(db, r.run, 'human:kanav', {
    kind: 'authority',
    capabilityId: 'combo:shell-execution',
    activeSeconds: 30,
    waitingSeconds: 120,
  });
  recordIntervention(db, r.run, 'human:kanav', {
    kind: 'authority',
    capabilityId: 'combo:shell-execution',
    activeSeconds: 20,
    waitingSeconds: 60,
  });
  (db as any).close();

  const d = cli('attention');
  expect(d.active_seconds).toBe(50);
  expect(d.waiting_seconds).toBe(180);
});

test('economics and goals seed from the config, stored as cents', () => {
  seed(WITH_ECONOMICS).close();
  const db = getDb(join(dir, 'graph.db'));
  const attention = rows(
    db,
    `SELECT value_cents, period FROM economics WHERE entity_id = 'human:kanav' AND metric = 'attention_value_per_hour'`
  );
  expect(attention[0].value_cents).toBe(25000);
  expect(attention[0].period).toBe('per_hour');

  const recurring = rows(
    db,
    `SELECT value_cents FROM economics WHERE entity_id = 'mcp:git' AND metric = 'recurring_cost_per_month'`
  );
  expect(recurring[0].value_cents).toBe(3000);

  const goal = rows(
    db,
    `SELECT occurrence_rate_per_month, success_value_cents, failure_cost_cents FROM goals WHERE id = 'recover-production'`
  );
  expect(goal[0].occurrence_rate_per_month).toBe(2);
  expect(goal[0].success_value_cents).toBe(4000);
  expect(goal[0].failure_cost_cents).toBe(50000);
  db.close();
});

test('economics reports declared values in dollars and names their source', () => {
  seed(WITH_ECONOMICS).close();
  const report = cli('economics');
  const attention = report.economics.find((e: any) => e.entity === 'actor:human:kanav');
  expect(attention.value_dollars).toBe(250);
  expect(attention.period).toBe('per_hour');
  expect(attention.source).toBe('declared');

  const g = report.goals.find((x: any) => x.id === 'recover-production');
  expect(g.success_value_dollars).toBe(40);
  expect(g.failure_cost_dollars).toBe(500);
  expect(report.note).toContain('$250/hr');
});

// ── Opportunity engine (WP-5) ────────────────────────────────────────────────
test('opportunities price observed middleware burden and never judge judgement', () => {
  seed({ ...LOCAL_ONLY, actors: { kanav: { name: 'Kanav' } } }).close();
  const db = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof recordIntervention>[0];

  // Five clerical interventions, 30 minutes of active time each, on one
  // capability, across three runs — the classic "the human is the duct" case.
  const r1 = beginRun(db, { goal: 'move data between systems', goalId: 'combo:data-access' });
  const r2 = beginRun(db, { goal: 'move data between systems', goalId: 'combo:data-access' });
  const r3 = beginRun(db, { goal: 'move data between systems', goalId: 'combo:data-access' });
  for (const r of [r1, r2, r2, r3, r3]) {
    recordIntervention(db, r.run, 'human:kanav', {
      kind: 'clerical',
      capabilityId: 'combo:data-access',
      activeSeconds: 1800,
    });
  }
  // Judgment, twice — must never appear as an opportunity.
  recordIntervention(db, r1.run, 'human:kanav', {
    kind: 'judgment',
    capabilityId: 'combo:web-research',
    activeSeconds: 3600,
  });
  recordIntervention(db, r1.run, 'human:kanav', {
    kind: 'judgment',
    capabilityId: 'combo:web-research',
    activeSeconds: 3600,
  });
  (db as any).close();

  const o = cli('opportunities');
  const da = o.opportunities.find((x: any) => x.kind === 'clerical');
  expect(da).toBeDefined();
  expect(da.burden.interventions_month).toBe(5);
  expect(da.burden.human_hours_month).toBe(2.5); // 5 × 30 min
  expect(da.burden.attention_dollars_month).toBe(625); // 2.5h × $250/hr
  expect(da.confidence).toBe('high'); // observed ≥ 5 times
  expect(da.expected.human_hours_month_after).toBe(0.3); // 10% of 2.5h remains
  expect(da.payback_months).toBeGreaterThan(0);
  expect(da.note).toMatch(/middleware/);

  // Judgment is reported as a keeper, not a candidate.
  expect(o.opportunities.some((x: any) => x.kind === 'judgment')).toBe(false);
  expect(o.keepers.some((k: any) => k.kind === 'judgment' && k.times === 2)).toBe(true);
});

test('opportunities rank by objective and expose one case', () => {
  seed({ ...LOCAL_ONLY, actors: { kanav: { name: 'Kanav' } } }).close();
  const db = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof recordIntervention>[0];
  const r = beginRun(db, { goal: 'approve the deploy' });
  recordIntervention(db, r.run, 'human:kanav', {
    kind: 'authority',
    capabilityId: 'combo:continuous-delivery',
    activeSeconds: 60,
  });
  recordIntervention(db, r.run, 'human:kanav', {
    kind: 'authority',
    capabilityId: 'combo:continuous-delivery',
    activeSeconds: 60,
  });
  (db as any).close();

  const byRoi = cli('opportunities', '--by=roi');
  expect(byRoi.by).toBe('roi');
  expect(byRoi.opportunities.length).toBeGreaterThan(0);

  const detail = cli('opportunity', byRoi.opportunities[0].id);
  expect(detail.id).toBe(byRoi.opportunities[0].id);
  expect(detail.proposal.setup_hours).toBeGreaterThan(0);
  expect(detail.roi_annual).toBeGreaterThan(0);
});

// ── Proposals carry the economic case (WP-6) ─────────────────────────────────
test('a proposal carries the observed case when burden exists, and none when it does not', () => {
  seed({ ...LOCAL_ONLY, actors: { kanav: { name: 'Kanav' } } }).close();
  const db = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof recordIntervention>[0];
  const r = beginRun(db, { goal: 'search the web for me' });
  // Three clerical interventions on a capability that is still locked: the
  // human is doing the work the missing capability should do.
  recordIntervention(db, r.run, 'human:kanav', {
    kind: 'clerical',
    capabilityId: 'combo:web-research',
    activeSeconds: 1200,
  });
  recordIntervention(db, r.run, 'human:kanav', {
    kind: 'clerical',
    capabilityId: 'combo:web-research',
    activeSeconds: 1200,
  });
  recordIntervention(db, r.run, 'human:kanav', {
    kind: 'clerical',
    capabilityId: 'combo:web-research',
    activeSeconds: 1200,
  });
  (db as any).close();

  const withCase = cli('propose', 'web-research');
  expect(withCase.error).toBeUndefined();
  expect(withCase.economic_case).toBeDefined();
  expect(withCase.economic_case.observed.interventions_month).toBe(3);
  expect(withCase.economic_case.predicted.human_hours_saved_per_year).toBeGreaterThan(0);
  expect(withCase.economic_case.confidence).toBe('medium');

  // A capability with no recorded burden proposes without inventing savings.
  const bare = cli('propose', 'continuous-delivery');
  expect(bare.economic_case).toBeUndefined();
});

test('an opportunity id proposes its capability with the observed case', () => {
  seed({ ...LOCAL_ONLY, actors: { kanav: { name: 'Kanav' } } }).close();
  const db = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof recordIntervention>[0];
  const r = beginRun(db, { goal: 'move data' });
  recordIntervention(db, r.run, 'human:kanav', {
    kind: 'clerical',
    capabilityId: 'combo:data-access',
    activeSeconds: 1800,
  });
  recordIntervention(db, r.run, 'human:kanav', {
    kind: 'clerical',
    capabilityId: 'combo:data-access',
    activeSeconds: 1800,
  });
  (db as any).close();

  const p = cli('propose', 'opp-1');
  expect(p.proposal).toBeDefined();
  expect(p.economic_case).toBeDefined();
  expect(p.economic_case.observed.interventions_month).toBe(2);
});

// ── Realized ROI (WP-9) ───────────────────────────────────────────────────────
test('roi measures before and after an apply, and writes the observation back', () => {
  seed(APPLIABLE).close();
  const db = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof recordIntervention>[0];

  // Three hours of clerical intervention on the target in the 60 days before
  // the apply — the burden the proposal predicted removing.
  const past = new Date(Date.now() - 30 * 864e5).toISOString();
  const r1 = beginRun(db, { goal: 'search the web', goalId: 'combo:web-research' });
  for (let i = 0; i < 3; i++) {
    recordIntervention(db, r1.run, 'human:kanav', {
      kind: 'clerical',
      capabilityId: 'combo:web-research',
      activeSeconds: 3600,
      startedAt: past,
    });
  }
  (db as any).close();

  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');
  cli('apply', p.proposal);

  // After the apply: one short intervention remains.
  const db2 = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof recordIntervention>[0];
  const r2 = beginRun(db2, { goal: 'search the web', goalId: 'combo:web-research' });
  recordIntervention(db2, r2.run, 'human:kanav', {
    kind: 'clerical',
    capabilityId: 'combo:web-research',
    activeSeconds: 360,
  });
  (db2 as any).close();

  const roi = cli('roi', p.proposal);
  expect(roi.goal).toBe('Web Research');
  // The three past-dated interventions are unambiguously before the apply. The
  // one recorded right after it may share the apply's SQLite second, and the
  // split counts an ambiguous second as *before* — so the total across both
  // windows is what must hold, not the exact partition.
  expect(roi.observed.before.human_hours).toBeGreaterThanOrEqual(3);
  expect(roi.observed.before.interventions + roi.observed.after.interventions).toBe(4);
  expect(roi.observed.projected_hours_saved_per_year).toBeGreaterThan(30);
  expect(typeof roi.observed.verdict).toBe('string');

  // The observation is written back, so the next prediction can learn.
  const reopened = getDb(join(dir, 'graph.db'));
  const stored = (
    reopened.prepare('SELECT observed_roi FROM proposals WHERE id = ?').get(p.proposal) as any
  ).observed_roi;
  expect(JSON.parse(stored).projected_hours_saved_per_year).toBe(
    roi.observed.projected_hours_saved_per_year
  );
  reopened.close();
});

test('roi on an unapplied proposal says so', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  const roi = cli('roi', p.proposal);
  expect(roi.error).toContain('apply');
});

// ── Federation (WP-10) ───────────────────────────────────────────────────────
test('a federation export carries aggregates and never credentials', () => {
  seed(WITH_PREFS).close();
  const db = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof recordIntervention>[0];
  const r = beginRun(db, { goal: 'move data' });
  recordIntervention(db, r.run, 'human:kanav', {
    kind: 'clerical',
    capabilityId: 'combo:data-access',
    activeSeconds: 1800,
  });
  (db as any).close();

  const summary = JSON.parse(
    execFileSync('node', ['--experimental-sqlite', ENGINE, 'federation', 'export'], {
      env: {
        ...process.env,
        TOOLCHAIN_DB: join(dir, 'graph.db'),
        OPENCODE_CONFIG: join(dir, 'config.json'),
        AMBIT_APPROVAL_KEY: 'test-approval-key',
      },
      encoding: 'utf8',
    })
  );
  expect(summary.schema_version).toBe(1);
  expect(summary.capabilities.length).toBeGreaterThan(0);
  expect(summary.capabilities.some((c: any) => c.reached)).toBe(true);
  expect(summary.burden.some((b: any) => b.capability_id === 'combo:data-access')).toBe(true);
  // Aggregates only: no config paths, no commands, no notes, no session text.
  // (The word "configured" legitimately appears as a lifecycle state.)
  const text = JSON.stringify(summary);
  expect(text).not.toMatch(/opencode\.json|"command"|"notes"|session_learning|api[_-]?key|token/i);
  // Signed when a key is present.
  expect(summary.signed).toBe(true);
});

test('a federation import stores a receipt and merges nothing', () => {
  seed(WITH_PREFS).close();
  const before = (
    getDb(join(dir, 'graph.db')).prepare('SELECT COUNT(*) n FROM capabilities').get() as any
  ).n;

  // Export to a file, then import that file back into the same graph.
  const summary = JSON.parse(
    execFileSync('node', ['--experimental-sqlite', ENGINE, 'federation', 'export'], {
      env: {
        ...process.env,
        TOOLCHAIN_DB: join(dir, 'graph.db'),
        OPENCODE_CONFIG: join(dir, 'config.json'),
        AMBIT_APPROVAL_KEY: 'test-approval-key',
      },
      encoding: 'utf8',
    })
  );
  const path = join(dir, 'summary.json');
  writeFileSync(path, JSON.stringify(summary));

  const receipt = cli('federation', 'import', path);
  expect(receipt.capabilities).toBeGreaterThan(0);
  expect(receipt.note).toContain('receipt');

  const db = getDb(join(dir, 'graph.db'));
  const rowsIn = db.prepare('SELECT COUNT(*) n FROM federation_imports').get() as any;
  expect(rowsIn.n).toBe(1);
  // Nothing leaked into the graph: capability count unchanged.
  expect((db.prepare('SELECT COUNT(*) n FROM capabilities').get() as any).n).toBe(before);
  db.close();
});

// ── Catalog (WP-11) and capital allocator (WP-12) ───────────────────────────
test('the catalog compares acquisition options by first-year cost', () => {
  seed({
    ...LOCAL_ONLY,
    actors: { kanav: { name: 'Kanav' } },
    catalog: {
      'combo:data-access': [
        {
          provider: 'saas-x',
          kind: 'subscribe',
          setup_seconds: 1800,
          recurring_dollars_per_month: 490,
          privacy: 'hosted',
          rollback: 'revoke the credential',
        },
        {
          provider: 'internal-api',
          kind: 'build',
          setup_seconds: 36000,
          cost_one_time_dollars: 4500,
          privacy: 'local',
          rollback: 'revert the merge',
        },
      ],
    },
  }).close();

  const catalog = cli('catalog', 'data-access');
  const declared = catalog.options.filter((o: any) => o.source === 'declared');
  expect(declared.length).toBe(2);
  // Sorted by total first-year cost: the $4,500 one-time build (4500) outranks
  // the $490/mo subscription (490×12 = 5880).
  expect(declared[0].provider).toBe('internal-api');
  expect(declared[0].total_first_year_dollars).toBe(4500);
  expect(declared[0].kind).toBe('build');
  expect(declared[1].provider).toBe('saas-x');
  expect(declared[1].total_first_year_dollars).toBe(5880);
  expect(declared[1].kind).toBe('subscribe');
  expect(declared[1].rollback).toBe('revoke the credential');
});

test('the curated model contributes catalog rows for alternatives it names', () => {
  seed(WITH_PREFS).close();
  const catalog = cli('catalog', 'model-routing');
  expect(catalog.options.length).toBeGreaterThan(0);
  expect(catalog.options[0].source).toBe('techtree');
  expect(catalog.options[0].setup).toBeDefined();
});

test('--budget allocates the best combination within it', () => {
  seed({ ...LOCAL_ONLY, actors: { kanav: { name: 'Kanav' } } }).close();
  const db = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof recordIntervention>[0];
  // Two clerical burdens: a small one and a large one, both priced.
  const r = beginRun(db, { goal: 'move data' });
  for (let i = 0; i < 6; i++)
    recordIntervention(db, r.run, 'human:kanav', {
      kind: 'clerical',
      capabilityId: 'combo:data-access',
      activeSeconds: 1800,
    });
  const r2 = beginRun(db, { goal: 'search the web' });
  for (let i = 0; i < 3; i++)
    recordIntervention(db, r2.run, 'human:kanav', {
      kind: 'clerical',
      capabilityId: 'combo:web-research',
      activeSeconds: 1800,
    });
  (db as any).close();

  const withBudget = cli('opportunities', '--budget=5000');
  expect(withBudget.allocation).toBeDefined();
  expect(withBudget.allocation.budget_dollars).toBe(5000);
  expect(withBudget.allocation.setup_dollars).toBeLessThanOrEqual(5000);
  expect(withBudget.allocation.savings_per_year_dollars).toBeGreaterThan(0);
  expect(withBudget.allocation.picks.length).toBeGreaterThan(0);
  // Every pick is a real opportunity from the ranked list.
  const ids = new Set(withBudget.opportunities.map((o: any) => o.id));
  for (const pick of withBudget.allocation.picks) expect(ids.has(pick.id)).toBe(true);

  // No budget → no allocation, just the ranked list.
  const plain = cli('opportunities');
  expect(plain.allocation).toBeUndefined();
});
