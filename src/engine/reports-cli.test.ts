/**
 * The reading surfaces: people, credentials, deficits, substitutes, and the digests.
 *
 * End-to-end: each test seeds a real graph by running the engine CLI. Split out
 * of a single 2,300-line file so a failure names a subject.
 */
import { test, expect } from 'vitest';
import {
  APPLIABLE,
  ENGINE,
  LOCAL_ONLY,
  SHARED_CREDENTIAL,
  TWO_PROVIDERS,
  WITH_PEOPLE,
  WITH_PREFS,
  addEvent,
  beginRun,
  cli,
  dir,
  endRun,
  execFileSync,
  getDb,
  join,
  recordHumanAct,
  recordIntervention,
  rows,
  seed,
  writeAndReturn,
  writeFileSync,
} from './testing/cli.ts';

test('people are nodes, and what they supply becomes a capability', () => {
  const db = seed(WITH_PEOPLE);
  const person = rows(db, "SELECT id, category, state FROM capabilities WHERE id = 'human:kanav'");
  expect(person[0]?.category).toBe('human');

  const supplied = rows(db, "SELECT id FROM capabilities WHERE category = 'human-action'").map(
    r => r.id
  );
  expect(supplied).toContain('act:physical-access');

  const edges = rows(
    db,
    `SELECT to_capability t FROM dependencies
                          WHERE from_capability = 'human:kanav' AND description = 'Supplied by a person'`
  );
  expect(edges.map(e => e.t)).toContain('act:physical-access');
});

test('approval is a dependency, not a policy note', () => {
  const db = seed(WITH_PEOPLE);
  const gated = rows(
    db,
    `SELECT from_capability f FROM dependencies
                          WHERE to_capability = 'combo:continuous-delivery'
                          AND description = 'Requires approval from a person'`
  );
  expect(gated.map(g => g.f)).toContain('human:kanav');
});

test('a plan names the person a step depends on', () => {
  seed(WITH_PEOPLE).close();
  const plan = cli('goal', 'continuous-delivery');
  // A plan that hides the human step reads as autonomous when it is not.
  expect(plan.requires_person).toContain('Kanav');
});

test('authorizing a capability that does not exist leaves no dangling edge', () => {
  const db = seed({
    provider: { acme: {} },
    actors: { sam: { name: 'Sam', authorizes: ['combo:nonexistent'] } },
  });
  const dangling = rows(
    db,
    `SELECT d.to_capability t FROM dependencies d
                             LEFT JOIN capabilities c ON c.id = d.to_capability
                             WHERE c.id IS NULL`
  );
  expect(dangling).toEqual([]);
});

test('a plan step offers alternatives with their trade-offs', () => {
  seed(LOCAL_ONLY).close();
  const plan = cli('goal', 'offline-capable');
  const embeddings = plan.order.find((o: any) => o.id === 'combo:embeddings');
  expect(embeddings?.options?.length).toBeGreaterThan(1);
  // The trade-off is rarely setup time alone; a faster hosted option costs
  // money and moves data, and the plan has to say so.
  const hosted = embeddings.options.find((o: any) => o.privacy === 'hosted');
  const local = embeddings.options.find((o: any) => o.privacy === 'local');
  expect(hosted.setup_seconds).toBeLessThan(local.setup_seconds);
  expect(hosted.recurring_cost).not.toBe('none');
});

test('a person can declare how they prefer things done', () => {
  const db = seed(WITH_PREFS);
  const prefs = rows(db, `SELECT preference FROM preferences WHERE actor_id = 'human:kanav'`).map(
    r => r.preference
  );
  expect(prefs.sort()).toEqual(['local-when-practical', 'minimize-recurring-cost']);

  db.close();
  const report = cli('goal', '--prefs', 'kanav');
  expect(report.name).toBe('Kanav');
  expect(report.preferences).toContain('local-when-practical');
});

test("a plan names where a step fights a person's stated preferences", () => {
  // Continuous Delivery needs Kanav's approval, and its default acquisition
  // alternative is hosted and recurring. A plan that asks the person without
  // noting the conflict reads as if the choice is theirs when the default is
  // already the thing they said they'd avoid.
  seed(WITH_PREFS).close();
  const plan = cli('goal', 'continuous-delivery');
  expect(plan.requires_person).toContain('Kanav');
  const conflicting = (plan.order || []).find((s: any) => s.preference_conflicts?.length);
  expect(conflicting).toBeDefined();
  expect(conflicting.preference_conflicts.join(' ')).toMatch(/hosted/);
});

test('infrastructure manifest devices seed as capability-bearing resources', () => {
  const dirPath = dir;
  writeFileSync(
    join(dirPath, 'infra.json'),
    JSON.stringify({
      devices: [{ id: 'nuc', name: 'NUC', description: 'homelab host' }],
      services: [{ key: 'ollama', label: 'Ollama', host: 'nuc' }],
    })
  );
  // Re-seed the same graph with the manifest on the INFRA_MANIFEST path.
  const dbPath = join(dirPath, 'graph.db');
  const configPath = join(dirPath, 'config.json');
  writeFileSync(configPath, JSON.stringify(WITH_PREFS));
  execFileSync('node', ['--experimental-sqlite', ENGINE, 'seed'], {
    env: {
      ...process.env,
      OPENCODE_CONFIG: configPath,
      TOOLCHAIN_DB: dbPath,
      INFRA_MANIFEST: join(dirPath, 'infra.json'),
      CONFIG_MAPPING: JSON.stringify({
        config_keys: {
          mcp: {
            type: 'mcp',
            domain_field: 'type',
            domain_map: { remote: 'backend', local: 'infra' },
            desc_template: '{type} server',
          },
          agent: { type: 'agent', domain: 'meta', desc_field: 'description' },
          provider: { type: 'provider', domain: 'ai-ml', name_field: 'name' },
          command: { type: 'tool', domain: 'devops', desc_field: 'description' },
        },
        skill_dirs: [],
      }),
    },
    stdio: 'ignore',
  });
  const db = getDb(dbPath);
  const device = rows(db, "SELECT id, kind FROM capabilities WHERE id = 'device:nuc'");
  expect(device[0]?.kind).toBe('resource');

  // The device runs the service, so losing it takes the service down.
  const runs = rows(
    db,
    `SELECT from_capability f FROM dependencies WHERE to_capability = 'svc:ollama' AND kind = 'runs_on'`
  );
  expect(runs.map(r => r.f)).toContain('device:nuc');
});

// ── Affordance domains (§7b) ─────────────────────────────────────────────────
test('institutional and economic domains are derived from structure, not pasted on', () => {
  // Kanav authorises Continuous Delivery, so it needs an authority holder to be
  // acquirable — institutional. Its acquisition has a recurring option, so it
  // implies a budget and a counterparty — economic. One capability, two
  // structural domains, both named.
  seed(WITH_PREFS).close();
  const report = cli('graph', 'affordances');
  const cd = report.capabilities.find((c: any) => c.name === 'Continuous Delivery');
  expect(cd).toBeDefined();
  expect(cd.domain).toBe('institutional');
  expect(cd.structure).toContain('institutional');
  expect(cd.structure).toContain('economic');

  // A capability with no authority holder and only a one-off acquisition stays
  // in its declared domain — no structure, no reclassification.
  const shell = report.capabilities.find((c: any) => c.name === 'Shell Execution');
  expect(shell).toBeUndefined();
});

// ── Capability surface (§8) ──────────────────────────────────────────────────
test('tt surface emits the vocabulary a runtime would own', () => {
  seed(WITH_PREFS).close();
  const out = execFileSync('node', ['--experimental-sqlite', ENGINE, 'graph', 'surface'], {
    env: {
      ...process.env,
      TOOLCHAIN_DB: join(dir, 'graph.db'),
      OPENCODE_CONFIG: join(dir, 'config.json'),
    },
    encoding: 'utf8',
  });
  const surface = JSON.parse(out);
  expect(surface.schema_version).toBe(1);
  expect(surface.runtime).toBe('opencode');

  // The surface is vocabulary, not state: every node by kind, every edge by
  // meaning, every authority grant — nothing about reached or locked.
  const kinds = new Set(surface.capabilities.map((c: any) => c.kind));
  expect(kinds.has('capability')).toBe(true);
  expect(kinds.has('provider')).toBe(true);
  expect(kinds.has('actor')).toBe(true);
  expect(surface.edges.length).toBeGreaterThan(0);
  expect(surface.authority.length).toBeGreaterThan(0);
  // No state column leaks into the export.
  expect(JSON.stringify(surface)).not.toMatch(/"state"/);
});

test('the digest counts human interventions and names the reducible ones', () => {
  seed(WITH_PREFS).close();
  // The same approval twice is a recurring human demand — infrastructure shaped
  // like a person, which is the whole point of counting interventions.
  recordHumanAct('approval', 'human:kanav', 'approved');
  recordHumanAct('approval', 'human:kanav', 'approved');

  const d = cli('attention');
  expect(d.interventions).toBe(2);
  expect(d.reducible.length).toBe(1);
  expect(d.reducible[0].kind).toBe('approval');
  expect(d.reducible[0].suggested_fix).toMatch(/grant bounded authority/);
});

test('a one-off intervention is recorded but not called reducible', () => {
  seed(WITH_PREFS).close();
  recordHumanAct('approval', 'human:kanav', 'approved');

  const d = cli('attention');
  expect(d.interventions).toBe(1);
  expect(d.reducible).toBeUndefined();
});

test('the digest reports a broken capability separately from reducible friction', () => {
  seed(WITH_PREFS).close();
  // Two failed verifications on the same capability are a repair problem, not
  // an authority problem — the fix is fixing the capability, not granting
  // permission.
  recordHumanAct('verify', 'combo:shell-execution', 'failed');
  recordHumanAct('verify', 'combo:shell-execution', 'failed');

  const d = cli('attention');
  expect(d.broken.length).toBe(1);
  expect(d.broken[0].capability).toBe('Shell Execution');
  expect(d.reducible).toBeUndefined();
});

test('ntfy is opt-in — nothing is pushed without a topic', async () => {
  seed(WITH_PREFS).close();
  const r = cli('notify');
  expect(r.error).toContain('Usage');
});

// ── Deficits ────────────────────────────────────────────────────────────────
test('a repeated deficit is distinguished from incidental friction', () => {
  seed(LOCAL_ONLY).close();
  const once = cli('record', 'vector-store');
  expect(once.times_blocked).toBe(1);
  expect(once.note).toBeUndefined(); // one failure is bad luck

  cli('record', 'vector-store');
  const third = cli('record', 'vector-store');
  expect(third.times_blocked).toBe(3);
  expect(third.note).toContain('structural');

  const report = cli('status').deficits;
  expect(report[0].id).toBe('combo:vector-store');
  expect(report[0].verdict).toContain('structural');
  expect(report[0].still_missing).toBe(true);
});

test('a deficit records why it was blocked, and the cause recurs separately', () => {
  seed(LOCAL_ONLY).close();
  const r = cli('record', 'vector-store', 'tool', 'semantic search over notes');
  expect(r.classification).toBe('tool');
  expect(r.times_as_this_class).toBe(1);

  // The same capability blocked for a different reason is a different signal:
  // the capability recurs, but not as one structural cause.
  cli('record', 'vector-store', 'permission');
  const report = cli('status').deficits;
  expect(report[0].id).toBe('combo:vector-store');
  expect(report[0].causes).toContain('tool ×1');
  expect(report[0].causes).toContain('permission ×1');
});

test('an unknown classification is treated as a note, not a class', () => {
  // `tt failed <cap> "what you were doing"` predates classification; the second
  // positional that is not a known class must remain the note.
  seed(LOCAL_ONLY).close();
  const r = cli('record', 'vector-store', 'just keep hitting the same wall');
  expect(r.classification).toBe('unclassified');
  expect(r.times_blocked).toBe(1);
});

test('a deficit against an unknown capability is refused, not silently kept', () => {
  // Otherwise deficits accumulate against ids nothing can act on.
  seed(LOCAL_ONLY).close();
  const r = cli('record', 'not-a-capability');
  expect(r.error).toContain('No capability');
  expect(cli('status').deficits.note).toContain('Nothing recorded');
});

test('losing one of several providers is not a critical loss', () => {
  const db = seed(TWO_PROVIDERS);
  const providers = rows(
    db,
    `SELECT from_capability f FROM dependencies
                              WHERE to_capability = 'combo:version-control'
                              AND description = 'Provides this capability'`
  );
  expect(providers.length).toBeGreaterThan(1);
  db.close();

  const impact = cli('impact', 'mcp:github');
  const vc = impact.combos_at_risk.find((c: any) => c.name === 'Version Control');
  // Previously reported critical — every provider was treated as the only one.
  expect(vc.severity).not.toBe('critical');
  expect(vc.also_provided_by).toBeGreaterThan(0);
});

test('a capability is reported once, not once per edge', () => {
  seed(TWO_PROVIDERS).close();
  const impact = cli('impact', 'mcp:github');
  const names = impact.combos_at_risk.map((c: any) => c.name);
  expect(new Set(names).size).toBe(names.length);
});

test('losing the only provider is critical', () => {
  seed({ mcp: { git: {} }, provider: { ollama: { models: { 'qwen3-coder': {} } } } }).close();
  const impact = cli('impact', 'mcp:git');
  const vc = impact.combos_at_risk.find((c: any) => c.name === 'Version Control');
  expect(vc.severity).toBe('critical');
  expect(vc.also_provided_by).toBeUndefined();
});

test('providers sharing a credential are not redundant', () => {
  seed(SHARED_CREDENTIAL).close();

  // The report this corrects: two providers read as twofold redundancy, so the
  // capability was excluded from `tt spof` by the very fact that makes it
  // fragile. Revoking one token takes both providers down together.
  const spof = cli('status').spofs;
  const finding = spof.find((s: any) => s.id === 'combo:version-control');
  expect(finding).toBeDefined();
  expect(finding.credential_id).toBe('cred:github/user-token');
  expect(finding.providers.length).toBe(2);
});

test('redundancy that survives a revocation is still redundancy', () => {
  // Only one of the two providers presents the token, so losing it leaves the
  // other working. Reporting this as fragile would be the same overstatement
  // in the other direction.
  seed({
    ...TWO_PROVIDERS,
    credentials: { 'github/user-token': { name: 'GitHub user token', used_by: ['mcp:github'] } },
  }).close();

  const spof = cli('status').spofs;
  expect(spof.some((s: any) => s.id === 'combo:version-control')).toBe(false);
});

test('impact calls surviving redundancy nominal when it shares a credential', () => {
  seed({
    mcp: { git: {}, github: {}, gitlab: {} },
    credentials: {
      'github/user-token': { name: 'GitHub user token', used_by: ['mcp:git', 'mcp:github'] },
    },
  }).close();

  // Removing gitlab leaves two providers — which the count calls redundant and
  // one revocation would end.
  const impact = cli('impact', 'mcp:gitlab');
  const vc = impact.combos_at_risk.find((c: any) => c.name === 'Version Control');
  expect(vc.severity).toBe('nominal');
  expect(vc.but_all_share).toBe('GitHub user token');
});

test('a credential reports what revoking it would end', () => {
  seed(SHARED_CREDENTIAL).close();
  const creds = cli('credentials');
  const token = creds.find((c: any) => c.id === 'cred:github/user-token');
  expect(token.held_by.sort()).toEqual(['git', 'github']);
  expect(token.ends).toContain('Version Control');
});

test('a credential is not a capability', () => {
  // Nothing `provides` a credential, so the ledger's vocabulary rule cannot
  // catch it: without the kind exclusion, declaring one on an unchanged machine
  // reads as a capability gained. The frontier must not move.
  seed(TWO_PROVIDERS).close();
  const before = cli('history').at(-1).reached;

  seed(SHARED_CREDENTIAL, { name: 'config' }).close();
  const since = cli('history', 'since');
  expect(since.gained.some((g: any) => g.id.startsWith('cred:'))).toBe(false);
  expect(since.frontier_now).toBe(before);
});

test('a credential nothing holds is not seeded', () => {
  // A typo in `used_by` should leave the credential out rather than create one
  // with no edges, the same way an actor's authorizes target does.
  const db = seed({
    ...TWO_PROVIDERS,
    credentials: { 'ghost/token': { name: 'Ghost', used_by: ['mcp:does-not-exist'] } },
  });
  expect(rows(db, "SELECT id FROM capabilities WHERE kind = 'credential'")).toEqual([]);
  db.close();
});

test('a command whose answer is a list prints the list', () => {
  seed({ mcp: { git: {} } }).close();
  // The human surface is the primary one, and it was dropping every array of
  // strings: `tt authority` printed the note about its four lists and none of
  // the lists. `scalar` had an array branch nothing could reach, which is what
  // showed the guard above it was catching more than it meant to.
  const out = execFileSync('node', ['--experimental-sqlite', ENGINE, 'authority'], {
    env: {
      ...process.env,
      TOOLCHAIN_DB: join(dir, 'graph.db'),
      OPENCODE_CONFIG: join(dir, 'config.json'),
    },
    encoding: 'utf8',
  });
  expect(out).toContain('autonomous:');
  expect(out).toContain('needs approval:');
});

test('a graph declaring no credentials analyses exactly as before', () => {
  seed(TWO_PROVIDERS).close();
  // The bar every stage of this refactor holds itself to: the existing analyses
  // must be untouched for anyone not using the new block.
  const spof = cli('status').spofs;
  expect(spof.every((s: any) => s.sole_credential === undefined)).toBe(true);
  const impact = cli('impact', 'mcp:github');
  expect(impact.combos_at_risk.every((c: any) => c.but_all_share === undefined)).toBe(true);
  expect(cli('credentials').note).toContain('No credentials declared');
});

test('single points of failure are distinguished from high-leverage capabilities', () => {
  seed(TWO_PROVIDERS).close();
  const spof = cli('status').spofs;
  const ids = Array.isArray(spof) ? spof.map((s: any) => s.id) : [];
  // Version Control has two providers, so it is not a single point of failure
  // however much depends on it — which is what bottlenecks measures instead.
  expect(ids).not.toContain('combo:version-control');
});

// ── The five legibility surfaces ─────────────────────────────────────────────
test('audit assembles the trail for a run, a proposal, and a person', () => {
  seed(APPLIABLE).close();
  const db = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof recordIntervention>[0];
  const r = beginRun(db, { goal: 'restart the service', runType: 'incident', source: 'scan' });
  addEvent(db, r.run, {
    kind: 'detected',
    actor: 'monitoring',
    capabilityId: 'svc:ollama',
    detail: 'down',
  });
  addEvent(db, r.run, { kind: 'diagnosed', actor: 'agent', capabilityId: 'combo:observability' });
  recordIntervention(db, r.run, 'human:kanav', {
    kind: 'authority',
    capabilityId: 'combo:shell-execution',
    activeSeconds: 30,
    waitingSeconds: 90,
  });
  endRun(db, r.run, 'success');
  (db as any).close();

  const runAudit = cli('audit', r.run);
  expect(runAudit.goal).toBe('restart the service');
  expect(runAudit.events.length).toBe(2);
  expect(runAudit.interventions[0].kind).toBe('authority');
  expect(runAudit.outcome).toBe('success');

  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');
  const propAudit = cli('audit', p.proposal);
  expect(propAudit.approval.by).toBe('human:kanav');
  expect(propAudit.approval.artifact.signed).toBe(true);
  expect(propAudit.enforcement.length).toBeGreaterThan(0);
  expect(propAudit.enforcement[0].decision).toBeDefined();

  const humanAudit = cli('audit', 'human:kanav');
  expect(humanAudit.approvals.some((a: any) => a.proposal === p.proposal)).toBe(true);

  const recent = cli('audit');
  expect(recent.runs.length).toBeGreaterThanOrEqual(1);
  expect(recent.proposals.length).toBeGreaterThanOrEqual(1);
});

test('incidents open a run for an offline service and resolve with MTTR', () => {
  seed(LOCAL_ONLY).close();
  writeFileSync(
    join(dir, 'infra.json'),
    JSON.stringify({
      services: [{ key: 'ollama', label: 'Ollama', url: 'http://127.0.0.1:1/health' }],
    })
  );

  const out = execFileSync('node', ['--experimental-sqlite', ENGINE, 'incidents', '--json'], {
    env: {
      ...process.env,
      TOOLCHAIN_DB: join(dir, 'graph.db'),
      OPENCODE_CONFIG: join(dir, 'config.json'),
      INFRA_MANIFEST: join(dir, 'infra.json'),
      AMBIT_APPROVAL_KEY: 'test-approval-key',
    },
    encoding: 'utf8',
  });
  const report = JSON.parse(out);
  expect(report.incidents.length).toBe(1);
  const inc = report.incidents[0];
  expect(inc.service).toBe('svc:ollama');
  expect(inc.status).toBe('down');
  expect(inc.recovery.decision).toBeDefined();
  expect(inc.recovery.action).toBe('restart svc:ollama');

  const resolved = cli('incident', 'resolve', 'svc:ollama', 'recovered');
  expect(resolved.mttr_seconds).toBeGreaterThanOrEqual(0);
  expect(resolved.outcome).toBe('recovered');

  // The closed run is now auditable with its MTTR in the ledger.
  const audit = cli('audit', resolved.run);
  expect(audit.goal).toContain('ollama');
});

test('portfolio reads shared burden and capex across imported environments', () => {
  seed(WITH_PREFS).close();
  // Two environments, both burdened on the same capability.
  for (const env of ['acme-ltd', 'globex']) {
    const e = env;
    const db = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof recordIntervention>[0];
    const r = beginRun(db, { goal: 'move data between systems' });
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
          AMBIT_ENV: e,
          AMBIT_APPROVAL_KEY: 'test-approval-key',
        },
        encoding: 'utf8',
      })
    );
    const receipt = cli('federation', 'import', writeAndReturn(join(dir, `${env}.json`), summary));
    expect(receipt.capabilities).toBeGreaterThan(0);
  }

  const pf = cli('portfolio');
  expect(pf.environments).toBe(2);
  expect(pf.environments_list.map((x: any) => x.environment).sort()).toEqual([
    'acme-ltd',
    'globex',
  ]);
  const shared = pf.shared_burden.find((s: any) => s.capability_id === 'combo:data-access');
  expect(shared).toBeDefined();
  expect(shared.environments).toBe(2);

  const withBudget = cli('portfolio', '--budget=100000');
  expect(withBudget.allocation.length).toBe(2);
});

test('roi with no argument is the cumulative headline', () => {
  seed(APPLIABLE).close();
  // Record burden first so the proposal carries a prediction to check.
  const db0 = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof recordIntervention>[0];
  const r0 = beginRun(db0, { goal: 'search the web', goalId: 'combo:web-research' });
  const past = new Date(Date.now() - 30 * 864e5).toISOString();
  for (let i = 0; i < 4; i++)
    recordIntervention(db0, r0.run, 'human:kanav', {
      kind: 'clerical',
      capabilityId: 'combo:web-research',
      activeSeconds: 1800,
      startedAt: past,
    });
  (db0 as any).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');
  cli('apply', p.proposal);
  cli('roi', p.proposal); // populate observed_roi

  const summary = cli('roi');
  expect(summary.proposals_applied).toBe(1);
  expect(summary.measurements).toBe(1);
  expect(summary.observed_hours_saved_per_year).toBeGreaterThanOrEqual(0);
  expect(summary.prediction).toBeDefined();
  expect(summary.prediction.of).toBeGreaterThan(0);
});

test('an opportunity carries its acquisition options', () => {
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
      ],
    },
  }).close();
  const db = getDb(join(dir, 'graph.db')) as unknown as Parameters<typeof recordIntervention>[0];
  const r = beginRun(db, { goal: 'move data' });
  for (let i = 0; i < 5; i++)
    recordIntervention(db, r.run, 'human:kanav', {
      kind: 'clerical',
      capabilityId: 'combo:data-access',
      activeSeconds: 1800,
    });
  (db as any).close();

  const o = cli('opportunities');
  const da = o.opportunities.find((x: any) => x.kind === 'clerical');
  expect(da.acquisition_options.length).toBeGreaterThan(0);
  expect(da.acquisition_options[0].provider).toBe('saas-x');
  expect(da.acquisition_options[0].kind).toBe('subscribe');
});
