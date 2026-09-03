/**
 * What lets an agent's ambit actually widen, rather than merely be measured.
 *
 * Section 12 gave the agent a way to notice a gap and ask about it. These are
 * the pieces that decide whether anything comes of the asking: evidence that
 * accrues from real work, a threshold somebody is prompted to set, a smaller
 * blast radius traded for unattended operation, a place to practise, a ceiling
 * instead of a gate, and a record of what this person actually says yes to.
 */
import { describe, expect, it } from 'vitest';
import { makeGraph, learn } from './testing/graph.ts';
import { canExecute, governingMode, specificity } from './assurance.ts';
import {
  setPromotion,
  evaluatePromotions,
  suggestPromotions,
  declareSandbox,
  removeSandbox,
  evidenceCount,
} from './assure/promote.ts';
import { setBudget, budgetReport, clearBudget, parseAmount } from './budgets.ts';
import { observedPreferences, observedReport, preferredOption } from './observed.ts';
import { objectReport } from './objects.ts';
import { rejectProposal, approveProposals } from './governance.ts';
import { pendingDrafts, pendingMessage } from './attention.ts';

function environment() {
  return makeGraph({
    capabilities: [
      { id: 'combo:deploy', name: 'Deploy', kind: 'capability' },
      { id: 'combo:secrets', name: 'Secret Management', kind: 'capability' },
      { id: 'human:kanav', name: 'Kanav', kind: 'actor', category: 'human' },
    ],
    authority: [
      { capability: 'combo:deploy', action: 'execute', mode: 'confirm' },
      { capability: 'combo:secrets', action: 'execute', mode: 'forbidden' },
    ],
  });
}

// ── scope traded for mode ────────────────────────────────────────────────────

describe('a smaller blast radius bought with unattended operation', () => {
  it('lets a grant about this target beat a grant about everything', () => {
    expect(specificity('')).toBe(0);
    expect(specificity('env:staging')).toBeGreaterThan(0);
    expect(
      governingMode([
        { mode: 'confirm', scope: '' },
        { mode: 'autonomous', scope: 'env:staging' },
      ])
    ).toBe('autonomous');
  });

  it('never lets a narrow grant reach past a refusal', () => {
    expect(
      governingMode([
        { mode: 'forbidden', scope: '' },
        { mode: 'autonomous', scope: 'env:staging/service' },
      ])
    ).toBe('forbidden');
  });

  it('promotes on staging and leaves production asking', () => {
    const db = environment();
    setPromotion(db, {
      capability: 'combo:deploy',
      after: 2,
      scope: 'env:staging',
      person: 'kanav',
    });
    learn(db, 'combo:deploy', 'verified', { notes: 'staging' });
    learn(db, 'combo:deploy', 'verified', { notes: 'staging' });
    db.prepare(
      "UPDATE session_learning SET object = 'env:staging' WHERE action = 'verified'"
    ).run();

    expect(evaluatePromotions(db).promoted[0]).toMatchObject({ scope: 'env:staging' });
    expect(canExecute(db, { capability: 'combo:deploy', target: 'env:staging' })).toMatchObject({
      verdict: 'yes',
    });
    expect(canExecute(db, { capability: 'combo:deploy', target: 'env:production' })).toMatchObject({
      verdict: 'ask',
    });
    db.close();
  });
});

// ── real work as evidence ────────────────────────────────────────────────────

describe('evidence from doing the job', () => {
  it('counts a successful use the way it counts a passing check', () => {
    const db = environment();
    db.prepare("INSERT INTO work_runs (id, goal, outcome) VALUES ('r1', 'ship', 'success')").run();
    db.prepare(
      "INSERT INTO capability_use (run_id, capability_id) VALUES ('r1', 'combo:deploy')"
    ).run();
    const e = evidenceCount(db, 'combo:deploy', 30);
    expect(e.uses).toBe(1);
    expect(e.evidence).toBe(1);
    db.close();
  });

  it('does not treat a failed run as a failing capability', () => {
    const db = environment();
    db.prepare("INSERT INTO work_runs (id, goal, outcome) VALUES ('r1', 'ship', 'failed')").run();
    db.prepare(
      "INSERT INTO capability_use (run_id, capability_id) VALUES ('r1', 'combo:deploy')"
    ).run();
    const e = evidenceCount(db, 'combo:deploy', 30);
    expect(e.uses).toBe(0);
    expect(e.failures).toBe(0);
    db.close();
  });

  it('earns a promotion on work alone, without a synthetic check', () => {
    const db = environment();
    setPromotion(db, { capability: 'combo:deploy', after: 2, person: 'kanav' });
    for (const id of ['r1', 'r2']) {
      db.prepare('INSERT INTO work_runs (id, goal, outcome) VALUES (?, ?, ?)').run(
        id,
        'ship',
        'success'
      );
      db.prepare('INSERT INTO capability_use (run_id, capability_id) VALUES (?, ?)').run(
        id,
        'combo:deploy'
      );
    }
    expect(evaluatePromotions(db).promoted[0]).toMatchObject({ now: 'autonomous' });
    db.close();
  });
});

// ── the threshold nobody set ─────────────────────────────────────────────────

describe('asking for a threshold', () => {
  it('names a grant confirmed by hand again and again', () => {
    const db = environment();
    learn(db, 'combo:deploy', 'verified');
    learn(db, 'combo:deploy', 'verified');
    for (let i = 0; i < 4; i++) {
      db.prepare(
        "INSERT INTO human_intervention (actor_id, kind, capability_id) VALUES ('human:kanav', 'authority', 'combo:deploy')"
      ).run();
    }
    const [s] = suggestPromotions(db) as any[];
    expect(s).toMatchObject({ id: 'combo:deploy', asked_by_hand: 4 });
    expect(s.set_it).toContain('ambit authority promote deploy execute');
    db.close();
  });

  it('says nothing while a check is failing', () => {
    const db = environment();
    learn(db, 'combo:deploy', 'failed', { score: 0 });
    for (let i = 0; i < 4; i++) {
      db.prepare(
        "INSERT INTO human_intervention (actor_id, kind, capability_id) VALUES ('human:kanav', 'authority', 'combo:deploy')"
      ).run();
    }
    expect(suggestPromotions(db)).toHaveLength(0);
    db.close();
  });
});

// ── somewhere to practise ────────────────────────────────────────────────────

describe('a declared sandbox', () => {
  it('relaxes confirmation inside itself', () => {
    const db = environment();
    declareSandbox(db, 'env:staging', 'kanav', 'the staging cluster');
    expect(canExecute(db, { capability: 'combo:deploy', target: 'env:staging/api' })).toMatchObject(
      { verdict: 'yes' }
    );
    expect(canExecute(db, { capability: 'combo:deploy', target: 'env:production' })).toMatchObject({
      verdict: 'ask',
    });
    db.close();
  });

  it('is never a way round a refusal', () => {
    const db = environment();
    declareSandbox(db, 'env:staging', 'kanav');
    expect(canExecute(db, { capability: 'combo:secrets', target: 'env:staging' })).toMatchObject({
      verdict: 'no',
    });
    db.close();
  });

  it('needs a person, and can be withdrawn', () => {
    const db = environment();
    expect(declareSandbox(db, 'env:staging', 'nobody')).toMatchObject({
      error: expect.stringContaining('not a person'),
    });
    declareSandbox(db, 'env:staging', 'kanav');
    expect(removeSandbox(db, 'env:staging')).toMatchObject({ removed: 'env:staging' });
    expect(canExecute(db, { capability: 'combo:deploy', target: 'env:staging' })).toMatchObject({
      verdict: 'ask',
    });
    db.close();
  });
});

// ── a ceiling instead of a gate ──────────────────────────────────────────────

describe('standing budgets', () => {
  it('reads dollars and stores cents', () => {
    expect(parseAmount('$20')).toBe(2000);
    expect(parseAmount('20')).toBe(2000);
    expect(parseAmount('500c')).toBe(500);
    expect(parseAmount('nonsense')).toBeUndefined();
  });

  it('needs a person, like every other delegation', () => {
    const db = environment();
    expect(
      setBudget(db, { capability: 'combo:deploy', amount: '$20', person: 'nobody' })
    ).toMatchObject({ error: expect.stringContaining('not a person') });
    db.close();
  });

  it('allows a spend inside the ceiling and refuses one beyond it', () => {
    const db = environment();
    setBudget(db, { capability: 'combo:deploy', amount: '$20', person: 'kanav' });
    expect(canExecute(db, { capability: 'combo:deploy', spendCents: 500 })).toMatchObject({
      verdict: 'ask',
    });
    expect(canExecute(db, { capability: 'combo:deploy', spendCents: 5000 })).toMatchObject({
      verdict: 'no',
    });
    expect((budgetReport(db) as any).budgets[0]).toMatchObject({ remaining: '$20.00' });
    expect(clearBudget(db, 'combo:deploy')).toMatchObject({ cleared: 'combo:deploy' });
    db.close();
  });

  it('starts a new period rather than staying spent for ever', () => {
    const db = environment();
    setBudget(db, { capability: 'combo:deploy', amount: '$20', period: 'month', person: 'kanav' });
    db.prepare(
      "UPDATE budgets SET spent_cents = 2000, period_start = datetime('now', '-40 days')"
    ).run();
    expect(canExecute(db, { capability: 'combo:deploy', spendCents: 1000 })).toMatchObject({
      verdict: 'ask',
    });
    db.close();
  });
});

// ── learning from the yeses and the noes ─────────────────────────────────────

function withProposals(db: any, rows: Array<[string, string, any]>) {
  for (const [id, status, steps] of rows) {
    db.prepare(
      "INSERT INTO proposals (id, goal, status, steps, simulated) VALUES (?, 'goal', ?, ?, '{}')"
    ).run(id, status === 'rejected' ? 'draft' : status, JSON.stringify(steps));
    if (status === 'rejected') rejectProposal(db, id, 'kanav', 'too expensive');
  }
}

describe('what this person actually approves', () => {
  it('records a refusal, which used to go unrecorded', () => {
    const db = environment();
    db.prepare(
      "INSERT INTO proposals (id, goal, status, steps, simulated) VALUES ('p1', 'add a thing', 'draft', '[]', '{}')"
    ).run();
    expect(rejectProposal(db, 'p1', 'kanav', 'not now')).toMatchObject({ reason: 'not now' });
    expect(db.prepare("SELECT status FROM proposals WHERE id = 'p1'").get()?.status).toBe(
      'rejected'
    );
    db.close();
  });

  it('learns a lean only after three decisions', () => {
    const db = environment();
    withProposals(db, [
      ['p1', 'approved', [{ privacy: 'local' }]],
      ['p2', 'approved', [{ privacy: 'local' }]],
    ]);
    db.prepare("UPDATE proposals SET approved_by = 'human:kanav' WHERE status = 'approved'").run();
    expect(observedPreferences(db)).toHaveLength(0);

    withProposals(db, [['p3', 'rejected', [{ privacy: 'hosted', recurring_cost: '$20/mo' }]]]);
    withProposals(db, [['p4', 'rejected', [{ privacy: 'hosted', recurring_cost: '$9/mo' }]]]);
    withProposals(db, [['p5', 'rejected', [{ privacy: 'hosted', recurring_cost: '$5/mo' }]]]);
    const learned = observedPreferences(db);
    expect(learned.find(l => l.trait === 'privacy:hosted')).toMatchObject({ leans: 'refused' });
    db.close();
  });

  it('drafts the alternative the record favours, and says why', () => {
    const db = environment();
    withProposals(db, [
      ['p1', 'rejected', [{ privacy: 'hosted' }]],
      ['p2', 'rejected', [{ privacy: 'hosted' }]],
      ['p3', 'rejected', [{ privacy: 'hosted' }]],
    ]);
    const picked = preferredOption(db, [{ privacy: 'hosted' }, { privacy: 'local' }]);
    expect(picked.index).toBe(1);
    expect(picked.because).toContain('privacy:hosted refused');
    expect((observedReport(db) as any).rejected).toBe(3);
    db.close();
  });
});

// ── the cost of a yes ────────────────────────────────────────────────────────

describe('what is waiting on a person', () => {
  it('carries the decision rather than announcing that one exists', () => {
    const db = environment();
    db.prepare(
      `INSERT INTO proposals (id, goal, status, steps, simulated) VALUES
       ('p1', 'reach Retrieval', 'draft', ?, ?)`
    ).run(
      JSON.stringify([{ setup_seconds: 900, recurring_cost: '$9/mo', inverse: { a: 1 } }]),
      JSON.stringify({ unblocked: [{ name: 'Local Embeddings' }] })
    );
    const [draft] = pendingDrafts(db) as any[];
    expect(draft).toMatchObject({ cost: '15m', recurring: '$9/mo', applicable: true });
    expect(draft.unlocks).toContain('Local Embeddings');

    const message = pendingMessage(db);
    expect(message).toContain('reach Retrieval');
    expect(message).toContain('unlocks Local Embeddings');
    expect(message).toContain('ambit approve p1');
    db.close();
  });

  it('approves several in one sitting, each on its own artifact', () => {
    const db = environment();
    for (const id of ['p1', 'p2']) {
      db.prepare(
        "INSERT INTO proposals (id, goal, status, steps, simulated) VALUES (?, 'goal', 'draft', '[]', '{}')"
      ).run(id);
    }
    const result = approveProposals(db, ['p1', 'p2'], 'kanav') as any;
    expect(result.approved).toBe(2);
    expect(db.prepare("SELECT COUNT(*) n FROM proposals WHERE status = 'approved'").get()?.n).toBe(
      2
    );
    db.close();
  });
});

// ── what may be done to what ─────────────────────────────────────────────────

describe('actions that carry an object', () => {
  it('answers per target, not per verb', () => {
    const db = environment();
    db.prepare(
      `INSERT INTO authority (capability_id, action, mode, holder, scope, source, note)
       VALUES ('combo:deploy', 'execute', 'autonomous', '', 'env:staging', 'test', '')`
    ).run();
    learn(db, 'combo:deploy', 'verified');
    db.prepare(
      "UPDATE session_learning SET object = 'env:staging' WHERE action = 'verified'"
    ).run();

    const report = objectReport(db, 'env:staging') as any;
    expect(report.may).toContain('Deploy · execute');
    expect(report.evidence[0]).toMatchObject({ proved: '1 passing' });

    // The same proof says nothing about a different object.
    const other = objectReport(db, 'env:production') as any;
    expect(other.may).toBeUndefined();
    db.close();
  });

  it('reports evidence about this object in the decision itself', () => {
    const db = environment();
    learn(db, 'combo:deploy', 'verified');
    db.prepare(
      "UPDATE session_learning SET object = 'env:staging' WHERE action = 'verified'"
    ).run();
    const answer = canExecute(db, {
      capability: 'combo:deploy',
      target: 'env:staging',
    }) as any;
    expect(answer.evidence_here).toMatchObject({ passes: 1 });
    expect(
      (canExecute(db, { capability: 'combo:deploy', target: 'env:production' }) as any)
        .evidence_here
    ).toBeUndefined();
    db.close();
  });
});
