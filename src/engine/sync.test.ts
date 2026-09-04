import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDb, type Db } from './db.ts';
import { migrate } from './migrate.ts';
import { exportSync, importSync } from './sync.ts';
import { recordFrontier } from './ledger.ts';
import { capture } from './cli.ts';
import { captureFailure } from './failures.ts';
import { registerSkill } from './skills.ts';
import {
  beginRun,
  addEvent,
  recordUse,
  recordIntervention,
  recordOutcome,
  recordResource,
} from './telemetry.ts';

describe('sync export and import round-trip', () => {
  let dir: string;
  let sourceDb: Db;
  let targetDb: Db;
  let syncFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ambit-sync-test-'));
    syncFile = join(dir, 'sync.json');
    sourceDb = getDb(join(dir, 'source.db'));
    migrate(sourceDb);
    targetDb = getDb(join(dir, 'target.db'));
    migrate(targetDb);
  });

  afterEach(() => {
    sourceDb.close();
    targetDb.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('preserves all table rows and schema columns through round-trip', () => {
    // 1. Capabilities & dependencies
    sourceDb
      .prepare(
        "INSERT INTO capabilities (id, name, domain, description, category, state, kind, lifecycle) VALUES ('test-cap', 'Test Capability', 'test', 'A test', 'skill', 'reached', 'capability', 'verified')"
      )
      .run();
    sourceDb
      .prepare(
        "INSERT INTO dependencies (from_capability, to_capability, is_hard_requisite, kind) VALUES ('test-cap', 'test-cap', 1, 'requires')"
      )
      .run();

    // 2. Frontier snapshots
    recordFrontier(sourceDb);
    const snapBefore = sourceDb.prepare('SELECT * FROM frontier_snapshots').get() as any;
    expect(snapBefore.reached).toBe(1);

    // 3. Session learning with object
    sourceDb
      .prepare(
        "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes, object) VALUES ('sess-1', 'test-cap', 'verify', 1, 'passed', 'repo:org/test')"
      )
      .run();

    // 4. Work ledger
    beginRun(sourceDb as never, { id: 'run-1', goal: 'deploy', runType: 'task', source: 'test' });
    sourceDb.prepare("UPDATE work_runs SET goal_id = 'test-cap' WHERE id = 'run-1'").run();
    addEvent(sourceDb as never, 'run-1', { kind: 'tool', action: 'commit' });
    recordUse(sourceDb as never, 'run-1', 'test-cap', { durationSeconds: 5 });
    recordIntervention(sourceDb as never, 'run-1', 'human:lead', {
      kind: 'clerical',
      capabilityId: 'test-cap',
      activeSeconds: 10,
    });
    sourceDb
      .prepare("UPDATE human_intervention SET ended_at = datetime('now') WHERE run_id = 'run-1'")
      .run();
    recordOutcome(sourceDb as never, 'run-1', 'success', { valueCents: 1000 });
    recordResource(sourceDb as never, 'run-1', 'res-1', 'cpu', { quantity: 2, costCents: 50 });

    // 5. Failure signals
    captureFailure(sourceDb, { tool: 'git/push', message: 'permission denied' });

    // Export
    const exportResult = exportSync(sourceDb, syncFile) as any;
    expect(existsSync(syncFile)).toBe(true);
    expect(exportResult.tables.find((t: any) => t.name === 'frontier_snapshots')?.rows).toBe(1);
    expect(exportResult.tables.find((t: any) => t.name === 'resource_consumption')?.rows).toBe(1);

    // Import into target
    const importResult = importSync(targetDb, syncFile) as any;
    expect(importResult.added.frontier_snapshots).toBe(1);
    expect(importResult.added.session_learning).toBe(1);
    expect(importResult.added.failure_signals).toBe(1);

    // Assert rows in targetDb
    const snapAfter = targetDb.prepare('SELECT * FROM frontier_snapshots').all() as any[];
    expect(snapAfter).toHaveLength(1);
    expect(snapAfter[0].reached).toBe(1);
    expect(snapAfter[0].total).toBe(snapBefore.total);

    const learning = targetDb
      .prepare("SELECT * FROM session_learning WHERE session_id = 'sess-1'")
      .get() as any;
    expect(learning.object).toBe('repo:org/test');

    const run = targetDb.prepare("SELECT * FROM work_runs WHERE id = 'run-1'").get() as any;
    expect(run.goal_id).toBe('test-cap');

    const intervention = targetDb
      .prepare("SELECT * FROM human_intervention WHERE run_id = 'run-1'")
      .get() as any;
    expect(intervention.ended_at).toBeTruthy();

    const resource = targetDb
      .prepare("SELECT * FROM resource_consumption WHERE run_id = 'run-1'")
      .get() as any;
    expect(resource.cost_cents).toBe(50);
  });

  it('is strictly idempotent on repeat imports', () => {
    sourceDb
      .prepare(
        "INSERT INTO capabilities (id, name, domain, description, state) VALUES ('cap-1', 'Cap 1', 'test', 'Test', 'reached')"
      )
      .run();
    recordFrontier(sourceDb);
    exportSync(sourceDb, syncFile);

    const first = importSync(targetDb, syncFile) as any;
    expect(first.added.capabilities).toBe(1);
    expect(first.added.frontier_snapshots).toBe(1);

    const second = importSync(targetDb, syncFile) as any;
    expect(Object.values(second.added).every(n => n === 0)).toBe(true);
    expect(second.skipped.frontier_snapshots).toBe(1);
  });

  it('enforces that commands and authority grants never travel', () => {
    sourceDb
      .prepare(
        "INSERT INTO capabilities (id, name, domain, description) VALUES ('combo:version-control', 'VC', 'devops', 'git')"
      )
      .run();
    registerSkill(sourceDb, { id: 'skill:custom', verify: 'echo dangerous' });
    sourceDb
      .prepare(
        "INSERT INTO authority (capability_id, action, mode, source) VALUES ('combo:version-control', 'execute', 'autonomous', 'test')"
      )
      .run();

    exportSync(sourceDb, syncFile);
    const content = JSON.parse(readFileSync(syncFile, 'utf8'));
    expect(content.tables.authority).toBeUndefined();
    expect(content.tables.declared_checks).toBeUndefined();

    importSync(targetDb, syncFile);
    expect(targetDb.prepare('SELECT COUNT(*) n FROM declared_checks').get()?.n).toBe(0);
    expect(targetDb.prepare('SELECT COUNT(*) n FROM authority').get()?.n).toBe(0);
  });
});

describe('in-process CLI flag handling', () => {
  it('returns JSON for briefing when --json flag is passed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ambit-cli-test-'));
    const dbPath = join(dir, 'test.db');
    const db = getDb(dbPath);
    migrate(db);
    db.prepare(
      "INSERT INTO capabilities (id, name, domain, description, state) VALUES ('c1', 'Cap', 'devops', 'test', 'reached')"
    ).run();

    const result = capture(db, ['briefing', '--json']) as any;
    expect(typeof result).toBe('object');
    expect(result).toHaveProperty('environment');
    expect(result).toHaveProperty('before_acting');

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
