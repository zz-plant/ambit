/**
 * A graph built in memory, for tests that want to call an engine function.
 *
 * The engine's original suite could only reach it by spawning `node`, seeding a
 * real config and reading stdout — so a broken ranking function and a broken
 * CLI printer failed the same way. This builds the same shapes directly, which
 * makes a unit test possible and makes it fast enough to write many.
 */
import { getDb, type Db } from '../db.ts';
import { migrate } from '../migrate.ts';

export interface CapabilityFixture {
  id: string;
  name?: string;
  domain?: string;
  description?: string;
  category?: string;
  state?: 'locked' | 'unlocked' | 'active';
  kind?: 'capability' | 'action' | 'provider' | 'resource' | 'actor' | 'runtime' | 'credential';
  lifecycle?: 'unknown' | 'configured' | 'verified' | 'reliable' | 'degraded' | 'broken';
  maturity?: number;
  setupSeconds?: number;
  updatedAt?: string;
}

export interface DependencyFixture {
  from: string;
  to: string;
  hard?: boolean;
  kind?: 'requires' | 'provides' | 'uses' | 'authorizes' | 'runs_on';
}

export interface GraphFixture {
  capabilities?: CapabilityFixture[];
  dependencies?: DependencyFixture[];
  authority?: {
    capability: string;
    action?: string;
    mode: 'auto' | 'confirm' | 'deny';
    holder?: string;
    scope?: string;
    source?: string;
  }[];
}

/** An in-memory graph with the schema applied and the given rows written. */
export function makeGraph(fixture: GraphFixture = {}): Db {
  const db = getDb(':memory:');
  migrate(db as never);

  const cap = db.prepare(
    `INSERT OR REPLACE INTO capabilities
       (id, name, domain, description, category, state, kind, lifecycle,
        maturity_score, unlock_cost_setup, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
  );
  for (const c of fixture.capabilities ?? []) {
    cap.run(
      c.id,
      c.name ?? c.id.split(':').pop()!,
      c.domain ?? 'infra',
      c.description ?? '',
      c.category ?? 'skill',
      c.state ?? 'unlocked',
      c.kind ?? 'capability',
      c.lifecycle ?? 'verified',
      c.maturity ?? 0.5,
      c.setupSeconds ?? 0,
      c.updatedAt ?? null
    );
  }

  const dep = db.prepare(
    `INSERT OR REPLACE INTO dependencies (from_capability, to_capability, is_hard_requisite, kind)
     VALUES (?, ?, ?, ?)`
  );
  for (const d of fixture.dependencies ?? []) {
    dep.run(d.from, d.to, d.hard === false ? 0 : 1, d.kind ?? 'requires');
  }

  const auth = db.prepare(
    `INSERT OR REPLACE INTO authority (capability_id, action, mode, holder, scope, source, note)
     VALUES (?, ?, ?, ?, ?, ?, '')`
  );
  for (const a of fixture.authority ?? []) {
    auth.run(
      a.capability,
      a.action ?? 'execute',
      a.mode,
      a.holder ?? '',
      a.scope ?? '',
      a.source ?? 'test'
    );
  }

  return db;
}

/** Records an outcome the way the engine's own learning table stores one. */
export function learn(
  db: Db,
  capabilityId: string,
  action: string,
  opts: { score?: number; session?: string; at?: string; notes?: string } = {}
): void {
  db.prepare(
    `INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes, timestamp)
     VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
  ).run(
    opts.session ?? 'test',
    capabilityId,
    action,
    opts.score ?? 1,
    opts.notes ?? '',
    opts.at ?? null
  );
}

/** An ISO-ish timestamp `n` days in the past, in the format SQLite writes. */
export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
}
