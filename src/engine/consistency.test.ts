/**
 * The seams where one fact used to be written down more than once.
 *
 * Each of these guards a place where two copies of the same rule had drifted or
 * were about to: a summary query that lived in five files, a definition of
 * *reached* that differed in the visualiser, a spend recorder that invented a
 * budget, and a sync file that carried an observation without the run it
 * pointed at.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeGraph } from './testing/graph.ts';
import { graphCounts, notSeeded, REACHED_SQL } from './vocabulary.ts';
import { canExecute, recordSpend } from './assurance.ts';
import { budgetReport, setBudget } from './budgets.ts';
import { exportSync, importSync } from './sync.ts';
import { statusReport } from './cli/reports.ts';
import { graphSummary } from './views.ts';
import { evidenceCount } from './assure/promote.ts';

function graph() {
  return makeGraph({
    capabilities: [
      { id: 'combo:a', name: 'A', kind: 'capability', state: 'unlocked' },
      { id: 'combo:b', name: 'B', kind: 'capability', state: 'active' },
      { id: 'combo:c', name: 'C', kind: 'capability', state: 'locked' },
      { id: 'act:a/x', name: 'x', kind: 'action', state: 'unlocked' },
      { id: 'human:kanav', name: 'Kanav', kind: 'actor', category: 'human' },
    ],
    authority: [{ capability: 'combo:a', action: 'execute', mode: 'autonomous' }],
  });
}

describe('one definition of reached', () => {
  it('counts the same way in the status report and the live stream', () => {
    const db = graph();
    const counts = graphCounts(db);
    const status = statusReport(db) as any;
    expect(status.reached).toBe(counts.reached);
    expect(status.total).toBe(counts.total);

    // The visualiser counts every row including actions, so its total is
    // larger; what must agree is which states count as reached.
    const summary = graphSummary(db);
    const everything = db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN ${REACHED_SQL} THEN 1 ELSE 0 END) AS reached FROM capabilities`
      )
      .get();
    expect(summary.reached).toBe(everything?.reached);
    expect(summary.total).toBe(everything?.total);
    db.close();
  });

  it('gives one answer when the graph was never built here', () => {
    expect(notSeeded().meaning).toBe(notSeeded('anything').meaning);
    expect(notSeeded('ambit seed').fix).toBe('ambit seed');
  });
});

describe('recording spend', () => {
  it('does not invent a budget, and so cannot refuse everything afterwards', () => {
    const db = graph();
    expect(canExecute(db, { capability: 'combo:a', spendCents: 100 }).decision).toBe('ALLOW');
    const spend = recordSpend(db, 'combo:a', 'execute', '', 100) as any;
    expect(spend.recorded).toBe(false);
    // The bug this guards: a zero-ceiling row was created, remaining went
    // negative, and every later spend was refused by a budget the report did
    // not list.
    expect(canExecute(db, { capability: 'combo:a', spendCents: 100 }).decision).toBe('ALLOW');
    expect((budgetReport(db) as any).budgets).toEqual([]);
    db.close();
  });

  it('spends against a budget that exists, and says what is left', () => {
    const db = graph();
    setBudget(db, { capability: 'combo:a', amount: '$5', person: 'kanav' });
    const spend = recordSpend(db, 'combo:a', 'execute', '', 100) as any;
    expect(spend).toMatchObject({ recorded: true, remaining_cents: 400 });
    expect(canExecute(db, { capability: 'combo:a', spendCents: 401 }).verdict).toBe('no');
    db.close();
  });
});

describe('a sync that carries what it points at', () => {
  it('brings the runs across, so use-based evidence survives a rebuild', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ambit-consistency-'));
    const file = join(dir, 'sync.json');
    const source = graph();
    source
      .prepare("INSERT INTO work_runs (id, goal, outcome) VALUES ('r1', 'ship', 'success')")
      .run();
    source
      .prepare("INSERT INTO capability_use (run_id, capability_id) VALUES ('r1', 'combo:a')")
      .run();
    source
      .prepare(
        "INSERT INTO human_intervention (run_id, actor_id, kind, capability_id) VALUES ('r1', 'human:kanav', 'authority', 'combo:a')"
      )
      .run();
    expect(evidenceCount(source, 'combo:a', 30).uses).toBe(1);
    exportSync(source, file);
    source.close();

    const fresh = graph();
    importSync(fresh, file);
    // The bug this guards: interventions hold a foreign key to a run, the runs
    // did not travel, and every intervention was silently skipped on import.
    expect(fresh.prepare('SELECT COUNT(*) n FROM work_runs').get()?.n).toBe(1);
    expect(fresh.prepare('SELECT COUNT(*) n FROM human_intervention').get()?.n).toBe(1);
    expect(evidenceCount(fresh, 'combo:a', 30).uses).toBe(1);
    fresh.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('still refuses to carry a grant or a command', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ambit-consistency-'));
    const file = join(dir, 'sync.json');
    const source = graph();
    const wrote = exportSync(source, file) as any;
    expect(wrote.excluded).toContain('authority grants');
    expect(wrote.excluded).toContain('skill check commands');
    source.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('what runs without a person is reported where a person looks', () => {
  it('names sandboxes and standing budgets in status', () => {
    const db = graph();
    db.prepare(
      "INSERT INTO sandboxes (target, declared_by) VALUES ('env:staging', 'human:kanav')"
    ).run();
    setBudget(db, { capability: 'combo:a', amount: '$5', person: 'kanav' });
    const status = statusReport(db) as any;
    expect(status.unattended[0]).toMatchObject({ sandboxes: 1, standing_budgets: 1 });
    db.close();
  });
});
