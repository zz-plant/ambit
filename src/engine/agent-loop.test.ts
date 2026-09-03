/**
 * The long-running agent's loop — roadmap §12.
 *
 * These are the acceptance tests the roadmap section states, written as tests
 * rather than as prose: a session that fails three times shows the deficit
 * without anyone recording it, a refusal costs one call and files itself, a
 * threshold set once widens a grant on evidence and one failure puts it back,
 * and a container rebuilt from nothing gets its history back.
 */
import { describe, expect, it } from 'vitest';
import { makeGraph, learn, daysAgo } from './testing/graph.ts';
import { classifySignal, captureFailure, signalReport } from './failures.ts';
import { canExecute } from './assurance.ts';
import { setPromotion, evaluatePromotions, promotionReport } from './assure/promote.ts';
import { nextSteps } from './next.ts';
import { briefing, briefingText } from './briefing.ts';
import { registerSkill, registeredSkills } from './skills.ts';
import { exportSync, importSync } from './sync.ts';
import { deficits } from './planning.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A small graph with one reached capability and one a step away. */
function environment() {
  return makeGraph({
    capabilities: [
      { id: 'combo:shell-execution', name: 'Shell Execution', kind: 'capability' },
      { id: 'combo:version-control', name: 'Version Control', kind: 'capability' },
      {
        id: 'combo:continuous-delivery',
        name: 'Continuous Delivery',
        kind: 'capability',
        state: 'locked',
        setupSeconds: 1800,
      },
      { id: 'combo:retrieval', name: 'Retrieval', kind: 'capability', state: 'locked' },
      { id: 'mcp:git', name: 'git', kind: 'provider' },
      { id: 'human:kanav', name: 'Kanav', kind: 'actor', category: 'human' },
    ],
    dependencies: [
      { from: 'combo:shell-execution', to: 'combo:version-control' },
      { from: 'combo:version-control', to: 'combo:continuous-delivery' },
      { from: 'mcp:git', to: 'combo:version-control', kind: 'provides' },
    ],
    authority: [
      { capability: 'combo:version-control', action: 'execute', mode: 'confirm' },
      { capability: 'combo:shell-execution', action: 'observe', mode: 'autonomous' },
      { capability: 'combo:retrieval', action: 'execute', mode: 'forbidden' },
    ],
  });
}

// ── §12.2 the ledger fills itself ────────────────────────────────────────────

describe('failures the runtime already reports', () => {
  it('classifies what a shell says about a missing binary', () => {
    expect(classifySignal({ message: 'bash: rg: command not found' })).toMatchObject({
      class: 'tool',
    });
    expect(classifySignal({ exitCode: 127 })).toMatchObject({ class: 'tool' });
    expect(classifySignal({ message: 'EACCES: permission denied, open /etc/hosts' })).toMatchObject(
      {
        class: 'permission',
      }
    );
    expect(classifySignal({ message: 'connect ECONNREFUSED 127.0.0.1:5432' })).toMatchObject({
      class: 'infrastructure',
    });
    expect(classifySignal({ errorKind: 'rate_limit' })).toMatchObject({ class: 'reliability' });
  });

  it('says nothing about a failure that is only work going wrong', () => {
    expect(classifySignal({ exitCode: 1, message: 'Expected 3 to equal 4' })).toBeNull();
    expect(classifySignal({ message: 'TypeError: undefined is not a function' })).toBeNull();
  });

  it('turns three failed sessions into a deficit nobody recorded', () => {
    const db = environment();
    for (let i = 0; i < 3; i++) {
      captureFailure(db, {
        source: 'opencode',
        tool: 'git push --force',
        message: 'fatal: permission denied to write to repository',
      });
    }
    const found = deficits(db) as any[];
    const vc = found.find(d => d.id === 'combo:version-control');
    expect(vc.times_blocked).toBe(3);
    expect(vc.causes.join()).toContain('permission');
    db.close();
  });

  it('keeps a failure it cannot attribute rather than dropping it', () => {
    const db = environment();
    captureFailure(db, { tool: 'terraform', message: 'terraform: command not found' });
    const report = signalReport(db, 30) as any;
    expect(report.observed).toBe(1);
    expect(report.unattributed[0]).toMatchObject({ tool: 'terraform', times: 1 });
    // Nothing was written against a capability, so the deficit report is unchanged.
    expect(deficits(db)).toMatchObject({ note: expect.stringContaining('Nothing recorded') });
    db.close();
  });
});

// ── §12.3 one question before acting ─────────────────────────────────────────

describe('asking before acting', () => {
  it('answers yes, ask and no in one word', () => {
    const db = environment();
    expect(
      canExecute(db, { capability: 'combo:shell-execution', action: 'observe' })
    ).toMatchObject({ verdict: 'yes' });
    expect(canExecute(db, { capability: 'combo:version-control' })).toMatchObject({
      verdict: 'ask',
    });
    expect(canExecute(db, { capability: 'combo:retrieval' })).toMatchObject({ verdict: 'no' });
    db.close();
  });

  it('names what is missing when the answer is no', () => {
    const db = environment();
    const answer = canExecute(db, { capability: 'combo:continuous-delivery' }) as any;
    expect(answer.verdict).toBe('no');
    expect(answer.reason).toContain('No grant');
    db.close();
  });

  it('tells an agent not to retry a forbidden action under another name', () => {
    const db = environment();
    const answer = canExecute(db, { capability: 'combo:retrieval' }) as any;
    expect(answer.reason).toContain('do not retry');
    db.close();
  });
});

// ── §12.4 a curriculum ───────────────────────────────────────────────────────

describe('what to reach next', () => {
  it('offers what is one step away, and says the ranking is structural', () => {
    const db = environment();
    const r = nextSteps(db) as any;
    expect(r.basis).toContain('structural');
    expect(r.next.map((n: any) => n.id)).toContain('combo:continuous-delivery');
    expect(r.next[0].propose).toMatch(/^ambit propose /);
    db.close();
  });

  it('ranks by what has actually blocked work once anything has', () => {
    const db = environment();
    for (let i = 0; i < 4; i++) {
      captureFailure(db, {
        tool: 'deploy',
        message: 'ECONNREFUSED',
        capabilityId: 'combo:continuous-delivery',
      });
    }
    const r = nextSteps(db) as any;
    expect(r.basis).toContain('observed');
    expect(r.next[0].id).toBe('combo:continuous-delivery');
    expect(r.next[0].why).toContain('4 times');
    db.close();
  });

  it('does not offer a capability more than one acquisition away', () => {
    const db = makeGraph({
      capabilities: [
        { id: 'combo:a', kind: 'capability', state: 'locked' },
        { id: 'combo:b', kind: 'capability', state: 'locked' },
        { id: 'combo:far', kind: 'capability', state: 'locked' },
      ],
      dependencies: [
        { from: 'combo:a', to: 'combo:far' },
        { from: 'combo:b', to: 'combo:far' },
      ],
    });
    const ids = (nextSteps(db) as any).next.map((n: any) => n.id);
    expect(ids).not.toContain('combo:far');
    db.close();
  });
});

// ── §12.1 the briefing ───────────────────────────────────────────────────────

describe('the session briefing', () => {
  it('leads with what is broken and stays inside the budget', () => {
    const db = environment();
    db.prepare(
      "UPDATE capabilities SET lifecycle = 'broken' WHERE id = 'combo:version-control'"
    ).run();
    const text = briefingText(db);
    expect(text.split('\n')[0]).toContain('Ambit ·');
    expect(text).toContain('Version Control');
    expect(text).toContain('ambit_can');
    // 1,200 tokens at four characters each, the cap the roadmap states.
    expect(text.length).toBeLessThanOrEqual(1200 * 4);
    db.close();
  });

  it('refuses to let an unseeded graph read as an empty environment', () => {
    const db = makeGraph();
    expect(briefingText(db)).toContain('has not run in this environment');
    db.close();
  });

  it('reports what blocked work in the last week without being told', () => {
    const db = environment();
    captureFailure(db, { tool: 'git', message: 'permission denied' });
    const b = briefing(db) as any;
    expect(b.blocked_recently?.join()).toContain('Version Control');
    db.close();
  });
});

// ── §12.5 the agent's own growth ─────────────────────────────────────────────

describe('registering what the agent built', () => {
  it('refuses a skill with no check', () => {
    const db = environment();
    expect(registerSkill(db, { id: 'skill:release-notes' })).toMatchObject({
      error: expect.stringContaining('A skill with no check'),
    });
    db.close();
  });

  it('puts a proven skill on the map, attributed to the agent', () => {
    const db = environment();
    const r = registerSkill(db, {
      id: 'skill:release-notes',
      provides: 'version-control',
      verify: 'node --version',
      runtime: 'claude-code',
    }) as any;
    expect(r.verification).toBe('verified');
    expect(r.provides).toBe('combo:version-control');
    expect((registeredSkills(db) as any).skills[0]).toMatchObject({
      id: 'skill:release-notes',
      registered_by: 'claude-code',
    });
    db.close();
  });

  it('is honest when the check does not pass', () => {
    const db = environment();
    const r = registerSkill(db, {
      id: 'skill:broken',
      verify: 'false',
    }) as any;
    expect(r.verification).toBe('failed');
    expect(r.note).toContain('does not pass');
    db.close();
  });
});

// ── §12.6 evidence becomes authority ─────────────────────────────────────────

describe('authority that widens on evidence', () => {
  it('needs a person to set the threshold', () => {
    const db = environment();
    expect(
      setPromotion(db, { capability: 'version-control', after: 3, person: 'nobody' })
    ).toMatchObject({ error: expect.stringContaining('not a person in the graph') });
    db.close();
  });

  it('refuses to put a threshold on a forbidden grant', () => {
    const db = environment();
    expect(setPromotion(db, { capability: 'retrieval', after: 3, person: 'kanav' })).toMatchObject({
      error: expect.stringContaining('not a slow yes'),
    });
    db.close();
  });

  it('refuses a threshold of one, because one run is not a pattern', () => {
    const db = environment();
    expect(
      setPromotion(db, { capability: 'version-control', after: 1, person: 'kanav' })
    ).toMatchObject({ error: expect.stringContaining('at least 2') });
    db.close();
  });

  it('promotes on evidence and demotes on a single failure', () => {
    const db = environment();
    setPromotion(db, { capability: 'version-control', after: 3, window: '30d', person: 'kanav' });

    learn(db, 'combo:version-control', 'verified');
    expect(evaluatePromotions(db).promoted).toHaveLength(0);

    learn(db, 'combo:version-control', 'verified');
    learn(db, 'combo:version-control', 'verified');
    const promoted = evaluatePromotions(db).promoted;
    expect(promoted[0]).toMatchObject({ action: 'execute', now: 'autonomous' });
    expect(canExecute(db, { capability: 'combo:version-control' })).toMatchObject({
      verdict: 'yes',
    });

    learn(db, 'combo:version-control', 'failed', { score: 0 });
    const demoted = evaluatePromotions(db).demoted;
    expect(demoted[0]).toMatchObject({ now: 'confirm' });
    expect(canExecute(db, { capability: 'combo:version-control' })).toMatchObject({
      verdict: 'ask',
    });
    db.close();
  });

  it('holds a promotion while a check is failing inside the window', () => {
    const db = environment();
    setPromotion(db, { capability: 'version-control', after: 2, person: 'kanav' });
    learn(db, 'combo:version-control', 'verified', { at: daysAgo(2) });
    learn(db, 'combo:version-control', 'verified', { at: daysAgo(1) });
    learn(db, 'combo:version-control', 'failed', { score: 0, at: daysAgo(1) });
    expect(evaluatePromotions(db).promoted).toHaveLength(0);
    expect((promotionReport(db) as any).thresholds[0].status).toContain('held');
    db.close();
  });
});

// ── §12.8 a ledger that travels ──────────────────────────────────────────────

describe('syncing a graph between machines', () => {
  it("rebuilds a container's history, and refuses to carry commands", () => {
    const dir = mkdtempSync(join(tmpdir(), 'ambit-sync-'));
    const file = join(dir, 'sync.json');
    const source = environment();
    captureFailure(source, { tool: 'git', message: 'permission denied' });
    registerSkill(source, { id: 'skill:notes', verify: 'node --version' });
    const wrote = exportSync(source, file) as any;
    expect(wrote.excluded).toContain('skill check commands');
    source.close();

    const fresh = environment();
    const result = importSync(fresh, file) as any;
    expect(result.added.session_learning).toBeGreaterThan(0);
    expect((deficits(fresh) as any[])[0].id).toBe('combo:version-control');
    // The skill arrived; its command did not, and the file says so.
    expect(result.checks_to_reregister[0].id).toBe('skill:notes');
    expect(fresh.prepare('SELECT COUNT(*) n FROM declared_checks').get()?.n).toBe(0);
    fresh.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('is a no-op the second time', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ambit-sync-'));
    const file = join(dir, 'sync.json');
    const source = environment();
    captureFailure(source, { tool: 'git', message: 'permission denied' });
    exportSync(source, file);
    source.close();

    const fresh = environment();
    importSync(fresh, file);
    const second = importSync(fresh, file) as any;
    expect(Object.values(second.added).every(n => n === 0)).toBe(true);
    fresh.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('never carries an authority grant across machines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ambit-sync-'));
    const file = join(dir, 'sync.json');
    const source = environment();
    source
      .prepare(
        "UPDATE authority SET mode = 'autonomous' WHERE capability_id = 'combo:version-control'"
      )
      .run();
    exportSync(source, file);
    source.close();

    const fresh = environment();
    importSync(fresh, file);
    expect(canExecute(fresh, { capability: 'combo:version-control' })).toMatchObject({
      verdict: 'ask',
    });
    fresh.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── what a recurring cause means ─────────────────────────────────────────────

describe('the verdict on a recurring deficit', () => {
  it('calls a repeated refusal a grant rather than an acquisition', () => {
    const db = environment();
    for (let i = 0; i < 3; i++) {
      captureFailure(db, {
        tool: 'git push',
        message: '403 Forbidden',
        capabilityId: 'combo:version-control',
      });
    }
    const found = (deficits(db) as any[])[0];
    expect(found.verdict).toContain('This is a grant');
    expect(found.recommendation).toBe('ambit authority version-control');
    db.close();
  });

  it('calls a repeatedly unreachable host a repair', () => {
    const db = environment();
    for (let i = 0; i < 3; i++) {
      captureFailure(db, {
        tool: 'git fetch',
        message: 'ECONNREFUSED',
        capabilityId: 'combo:version-control',
      });
    }
    expect((deficits(db) as any[])[0].verdict).toContain('This is a repair');
    db.close();
  });
});
