/**
 * The trail as one stream.
 *
 * `ambit audit` reads the recent window as three lists, capped at 40, 20 and
 * 20 on their own, so a busy week lost its older events before anything was
 * merged, and a delegation revision appeared in none of them. The ledger also
 * stores time two ways, SQLite's `2026-09-29 14:02:11` and ISO with a `T`,
 * and sorted as text the two misorder: a space sorts before a `T`, so every
 * ISO stamp on a date reads as later than every SQLite one on that date.
 */
import { expect, test } from 'vitest';
import type { Db } from './db.ts';
import { auditStream } from './audit.ts';
import { makeGraph } from './testing/graph.ts';

/** A day inside the default window, and a stamp on it in either stored form. */
const day = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
const sqlite = (hour: string) => `${day} ${hour}:00:00`;
const iso = (hour: string) => `${day}T${hour}:00:00.000Z`;

function graph(): Db {
  return makeGraph({
    capabilities: [
      { id: 'human:web', name: 'you', category: 'human', kind: 'actor' },
      { id: 'combo:shell', name: 'Shell', category: 'combo', kind: 'capability' },
    ],
  });
}

function act(db: Db, session: string, capability: string, action: string, at: string, notes = '') {
  db.prepare(
    `INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes, timestamp)
     VALUES (?, ?, ?, 1, ?, ?)`
  ).run(session, capability, action, notes, at);
}

/** A delegation record as the log stores it, with only the fields the trail reads. */
function record(db: Db, id: string, kind: string, at: string, content: Record<string, unknown>) {
  const body = {
    record_id: id,
    kind,
    actor: { id: 'ambit', kind: 'service' },
    subject: 'combo:shell/execute',
    summary: `${kind} of the shell grant`,
    time: { as_of: at, recorded_at: at },
    content,
  };
  db.prepare(
    `INSERT INTO delegation_records (record_id, kind, subject, recorded_at, body, hash)
     VALUES (?, ?, ?, ?, ?, 'unchecked')`
  ).run(id, kind, body.subject, at, JSON.stringify(body));
}

test('approvals, demotions and delegation revisions merge in true time order', () => {
  const db = graph();
  db.prepare(
    `INSERT INTO proposals (id, goal, status, steps, simulated, created_at, approved_by, approved_at, approval_artifact)
     VALUES ('prop-a', 'reach the shell', 'approved', '[]', '{}', ?, 'human:web', ?, '{"sig":"s"}')`
  ).run(sqlite('02'), sqlite('05'));
  // The echo an approval leaves in the learning table: the same decision.
  act(db, 'approval', 'human:web', 'approved', sqlite('05'), 'prop-a: reach the shell');
  record(db, 'ambit:revision:1', 'revision', iso('03'), {
    mode_now: 'confirm',
    mode_declared: 'unattended',
  });
  record(db, 'ambit:revision:answer:1', 'revision', iso('06'), { disposition: 'upheld' });
  act(db, 'authority', 'combo:shell', 'demoted', sqlite('07'), 'execute: back to confirm');

  const { events, truncated } = auditStream(db);
  db.close();

  expect(events.map(e => [e.action, e.outcome?.word])).toEqual([
    ['demoted', 'grant narrowed'],
    ['revision', 'objection upheld'],
    ['approved', 'signed'],
    ['revision', 'grant narrowed'],
    ['proposed', undefined],
  ]);
  expect(events.map(e => e.at)).toEqual([...events.map(e => e.at)].sort().reverse());
  expect(events.every(e => e.at.includes('T') && e.at.endsWith('Z'))).toBe(true);
  expect(truncated).toBe(false);
  // The approval is one line, the row's, and it says who and what.
  expect(events.find(e => e.action === 'approved')).toMatchObject({
    actor: 'human:web',
    target: 'prop-a',
    summary: 'reach the shell',
  });
});

test('a window busier than the old cap of 40 acts shows every one, up to the limit', () => {
  const db = graph();
  for (let i = 0; i < 60; i++) {
    const at = new Date(Date.now() - (i + 1) * 3_600_000).toISOString().slice(0, 19);
    act(db, 'verify', 'combo:shell', 'verified', at.replace('T', ' '));
  }

  const all = auditStream(db);
  expect(all.events).toHaveLength(60);
  expect(all.truncated).toBe(false);

  // One cut, after the merge: the newest fifty, and it says there were more.
  const cut = auditStream(db, { limit: 50 });
  db.close();
  expect(cut.events).toHaveLength(50);
  expect(cut.truncated).toBe(true);
  expect(cut.events.map(e => e.id)).toEqual(all.events.slice(0, 50).map(e => e.id));
});

test('an event states an outcome only where one was recorded', () => {
  const db = graph();
  act(db, 'verify', 'combo:shell', 'failed', sqlite('08'), 'fatal: token ghp_example leaked');
  act(
    db,
    'approval',
    'human:web',
    'rejected',
    sqlite('09'),
    'prop-b: add a hosted store — not now'
  );
  act(db, 'config', 'combo:shell', 'built', sqlite('10'), 'configured');
  db.prepare(
    `INSERT INTO work_runs (id, goal, started_at, ended_at, outcome) VALUES
       ('run-ok', 'restart ollama', ?, ?, 'completed'),
       ('run-blocked', 'deploy', ?, ?, 'blocked_unauthorized'),
       ('run-odd', 'rehearse', ?, ?, 'simulated'),
       ('run-open', 'still going', ?, NULL, NULL)`
  ).run(
    sqlite('11'),
    sqlite('12'),
    sqlite('11'),
    sqlite('12'),
    sqlite('11'),
    sqlite('12'),
    sqlite('11')
  );

  const events = auditStream(db).events;
  db.close();
  const find = (action: string, target: string) =>
    events.find(e => e.action === action && e.target === target);

  // A check's verb is its result; what its command printed is not served.
  expect(find('failed', 'combo:shell')).toMatchObject({
    outcome: { word: 'check failed', tone: 'bad' },
  });
  expect(find('failed', 'combo:shell')?.summary).toBeUndefined();
  expect(JSON.stringify(events)).not.toContain('ghp_example');
  // A person in the act is the actor, and the note names the proposal.
  expect(find('rejected', 'prop-b')).toMatchObject({
    actor: 'human:web',
    summary: 'add a hosted store — not now',
  });
  expect(find('rejected', 'prop-b')?.outcome).toBeUndefined();
  expect(find('built', 'combo:shell')?.outcome).toBeUndefined();
  // A run's own word, marked only where the vocabulary knows it.
  expect(find('ended', 'run-ok')?.outcome).toEqual({ word: 'completed', tone: 'good' });
  expect(find('ended', 'run-blocked')?.outcome).toEqual({
    word: 'blocked_unauthorized',
    tone: 'bad',
  });
  expect(find('ended', 'run-odd')?.outcome).toEqual({ word: 'simulated', tone: 'neutral' });
  expect(find('started', 'run-open')?.outcome).toBeUndefined();
  expect(find('ended', 'run-open')).toBeUndefined();
});

test('the window is a window, and a graph with no ledger is an empty trail', () => {
  const db = graph();
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  act(db, 'verify', 'combo:shell', 'verified', old);
  expect(auditStream(db).events).toEqual([]);
  expect(auditStream(db, { days: 60 }).events).toHaveLength(1);
  db.close();

  const empty = makeGraph({});
  expect(auditStream(empty)).toEqual({ days: 30, limit: 200, events: [], truncated: false });
  empty.close();
  // No graph at all: the same empty trail, over the window that was asked for.
  expect(auditStream(null, { days: 7, limit: -3 })).toEqual({
    days: 7,
    limit: 200,
    events: [],
    truncated: false,
  });
});
