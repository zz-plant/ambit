/**
 * What the authority model looks like to a person reading it.
 *
 * Three reports over the same tables `canExecute` decides from: what each
 * capability is permitted, what each of its actions is permitted, and whether
 * a grant's scope actually covers a target. Reading and deciding are separate
 * files because only one of them gates execution.
 */
import type { Db } from '../db.ts';
import { usable } from './lifecycle.ts';
import { narrower, scopeCovers } from './decide.ts';
import type { CapabilityRow } from '../rows.ts';

/**
 * Where a capability's authority is narrower than its technical reach.
 *
 * Being able to perform an action is not permission to perform it, so the two
 * are tracked apart. A capability that is reached but gated is not autonomously
 * exercisable, and that difference is the whole point of separating them.
 *
 * Read from the `authority` table rather than re-parsed out of the curated tree
 * at report time, because the tree is no longer the only source: a runtime
 * states what it permits — Hermes reports `approvals.mode` and
 * `approvals.cron_mode` — and what it permits applies to everything it
 * contributes. Where a declaration and a runtime disagree the narrower wins,
 * and the report names which source narrowed it, since that is the half worth
 * knowing.
 */
function authorityReport(db: Db) {
  const grants = db
    .prepare(
      `SELECT a.capability_id, a.action, a.mode, a.holder, a.scope, a.source, a.note,
              c.name, c.state, c.kind, c.lifecycle
       FROM authority a JOIN capabilities c ON c.id = a.capability_id
       ORDER BY c.name, a.action`
    )
    .all();
  if (grants.length === 0) {
    return {
      note: 'No authority declared. Seed a graph, or declare authority on a capability in the model.',
    };
  }

  // Runtime-wide grants apply to everything that runtime contributes, so they
  // are stored once against the runtime node and resolved here rather than
  // copied onto every capability at seed — where a later contribution would
  // silently miss them.
  const runtimeReach = new Map<string, Set<string>>();
  for (const r of db
    .prepare(
      `SELECT rt.from_capability runtime, p.to_capability capability
     FROM dependencies rt JOIN dependencies p ON p.from_capability = rt.to_capability
     WHERE rt.kind = 'contributes' AND p.kind = 'provides'`
    )
    .all()) {
    if (!runtimeReach.has(r.runtime)) runtimeReach.set(r.runtime, new Set());
    runtimeReach.get(r.runtime)!.add(r.capability);
  }
  // And one hop further, onto the actions those capabilities confer: a runtime
  // that requires approval for everything it executes requires it for the
  // individual actions too, or the finer vocabulary would quietly be the freer
  // one.
  const conferred = new Map<string, string[]>();
  for (const r of db
    .prepare(
      `SELECT d.from_capability capability, d.to_capability action
     FROM dependencies d JOIN capabilities c ON c.id = d.to_capability
     WHERE d.kind = 'provides' AND c.kind = 'action'`
    )
    .all()) {
    if (!conferred.has(r.capability)) conferred.set(r.capability, []);
    conferred.get(r.capability)!.push(r.action);
  }
  for (const reach of runtimeReach.values()) {
    for (const capId of [...reach])
      for (const actionId of conferred.get(capId) || []) reach.add(actionId);
  }

  // Collected first and resolved after, so which source wins does not depend on
  // the order rows come back in.
  const collected = new Map<string, any>();
  const record = (
    id: string,
    name: string,
    state: string,
    kind: string,
    lifecycle: string,
    action: string,
    mode: string,
    source: string,
    scope: string
  ) => {
    const key = `${id}|${action}|${scope}`;
    if (!collected.has(key)) {
      collected.set(key, {
        name,
        id,
        kind,
        action,
        scope: scope || undefined,
        reached: state !== 'locked' && usable(lifecycle),
        lifecycle,
        grants: [],
      });
    }
    collected.get(key)!.grants.push({ source, mode });
  };

  const nodes = new Map(
    db
      .prepare('SELECT id, name, state, kind, lifecycle FROM capabilities')
      .all<Pick<CapabilityRow, 'id' | 'name' | 'state' | 'kind' | 'lifecycle'>>()
      .map(c => [c.id, c] as const)
  );

  for (const g of grants) {
    if (g.kind === 'runtime') {
      // A runtime's own grant is a statement about everything it supplies.
      for (const capId of runtimeReach.get(g.capability_id) || []) {
        const target = nodes.get(capId);
        if (!target) continue;
        record(
          capId,
          target.name,
          target.state,
          target.kind,
          target.lifecycle,
          g.action,
          g.mode,
          g.source,
          g.scope
        );
      }
      continue;
    }
    record(
      g.capability_id,
      g.name,
      g.state,
      g.kind,
      g.lifecycle,
      g.action,
      g.mode,
      g.source,
      g.scope
    );
  }

  const detail = [...collected.values()]
    .map(entry => {
      const mode = entry.grants.map((g: any) => g.mode).reduce(narrower);
      const declared = entry.grants.filter((g: any) => g.source === 'techtree');
      // Narrowed means a runtime is stricter than the model says the action is
      // — the case worth surfacing, because it is the machine in front of you
      // disagreeing with the general description.
      const narrowedBy =
        declared.length && narrower(declared[0].mode, mode) !== declared[0].mode
          ? entry.grants.find((g: any) => g.mode === mode && g.source !== 'techtree')?.source
          : entry.grants.length === 1 &&
              entry.grants[0].source !== 'techtree' &&
              mode !== 'autonomous'
            ? entry.grants[0].source
            : undefined;
      const { grants: _grants, ...rest } = entry;
      return {
        ...rest,
        mode,
        sources: entry.grants.map((g: any) => g.source),
        narrowed_by: narrowedBy,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const execute = detail.filter(d => d.action === 'execute' || !['observe'].includes(d.action));
  const named = (rows: any[]) => rows.map(r => (r.scope ? `${r.name} · ${r.scope}` : r.name));

  return {
    autonomous: named(execute.filter(r => r.reached && r.mode === 'autonomous')),
    needs_approval: named(execute.filter(r => r.reached && r.mode === 'confirm')),
    forbidden: named(execute.filter(r => r.mode === 'forbidden')),
    narrowed_by_runtime: named(execute.filter(r => r.narrowed_by)),
    note: 'reached means the system can perform it; mode says whether it may without asking. A degraded or broken capability is not listed as reached however its permission reads.',
    detail,
  };
}

/**
 * The concrete actions a capability confers, and whether each may be performed.
 *
 * The coarse node answers "does this system have version control". This answers
 * the question that actually decides what an agent may do next: it may read the
 * repository and commit, and it may not merge to the default branch. Authority
 * is per action because permission is per action; the capability being reached
 * says nothing about which half of it is permitted.
 */
function actionsReport(db: Db, capId?: string) {
  const scope = capId
    ? capId.startsWith('combo:') || capId.includes(':')
      ? capId
      : `combo:${capId}`
    : undefined;

  const actions = db
    .prepare(
      `SELECT a.id, a.name, a.state, a.lifecycle, a.description, d.from_capability capability, c.name capability_name
       FROM capabilities a
       JOIN dependencies d ON d.to_capability = a.id AND d.kind = 'provides'
       JOIN capabilities c ON c.id = d.from_capability
       WHERE a.kind = 'action' AND c.kind = 'capability'
       ORDER BY c.name, a.name`
    )
    .all()
    .filter((r: any) => !scope || r.capability === scope);

  if (actions.length === 0) {
    return scope
      ? {
          note: `${scope} declares no contract. Only some capabilities name their actions; see contract.can in the model.`,
        }
      : {
          note: 'No actions in the graph. Seed one, or declare contract.can on a capability in the model.',
        };
  }

  // Effective authority, resolved the same way `tt authority` resolves it, so
  // the two surfaces cannot disagree about what is permitted.
  const authority = authorityReport(db) as any;
  const modeOf = new Map<string, any>();
  for (const row of authority.detail || []) {
    if (row.action !== 'execute' || row.scope) continue;
    modeOf.set(row.id, row);
  }

  const rows = actions.map((a: any) => {
    const grant = modeOf.get(a.id);
    return {
      name: a.name,
      id: a.id,
      capability: a.capability_name,
      // Reachable is not enough to act on: a broken action cannot be performed
      // whatever the capability's state says, and it must not read as
      // exercisable.
      reached: a.state !== 'locked' && usable(a.lifecycle),
      mode: grant?.mode || 'autonomous',
      narrowed_by: grant?.narrowed_by,
      lifecycle: a.lifecycle,
    };
  });

  return {
    actions: rows.length,
    // Reached and permitted, which is the only combination an agent can act on
    // unattended. The other three are each interesting for a different reason.
    exercisable: rows.filter(r => r.reached && r.mode === 'autonomous').map(r => r.id),
    needs_approval: rows.filter(r => r.reached && r.mode === 'confirm').map(r => r.id),
    forbidden: rows.filter(r => r.mode === 'forbidden').map(r => r.id),
    detail: rows,
  };
}

/**
 * What a scope actually covers, and what it does not.
 *
 *   tt scope repo:owner/name
 *
 * Lists every authority grant, whether its scope covers the target, and the
 * effective mode the covering grants resolve to. The point is the mismatch: a
 * grant scoped to `repo:other` does not cover `repo:owner/name`, and the graph
 * should be able to say that out loud rather than leaving a stored string that
 * reads like coverage until someone checks.
 */
function scopeReport(db: Db, target?: string) {
  if (!target)
    return {
      error: 'Usage: ambit authority scope <target> — e.g. repo:owner/name, device:nuc, svc:ollama',
    };
  const grants = db
    .prepare(
      `SELECT a.capability_id, a.action, a.mode, a.holder, a.scope, a.source, a.note,
              c.name, c.state, c.kind, c.lifecycle
       FROM authority a JOIN capabilities c ON c.id = a.capability_id
       ORDER BY c.name, a.action, a.scope`
    )
    .all();
  if (grants.length === 0) {
    return {
      target,
      note: 'No authority declared. Seed a graph, or declare authority on a capability in the model.',
    };
  }

  const rows = grants.map((g: any) => ({
    name: g.name,
    id: g.capability_id,
    action: g.action,
    mode: g.mode,
    source: g.source,
    // The stored scope, and whether it actually covers the target asked about.
    scope: g.scope || '(unscoped)',
    covers: scopeCovers(g.scope || '', target),
    note: g.note || undefined,
  }));

  const covering = rows.filter(r => r.covers);
  const excluded = rows.filter(r => !r.covers);
  return {
    target,
    covers: covering.length,
    excluded: excluded.length,
    grants: rows,
    // The effective mode for the target: the narrowest of the covering grants,
    // which is the answer to "may this target be touched, and how much".
    effective: covering.length ? covering.map(r => r.mode).reduce(narrower) : 'forbidden',
    note: excluded.length
      ? `${excluded.length} grant(s) are scoped elsewhere and do not cover ${target}. The effective mode is from the covering grants only.`
      : undefined,
  };
}

export { authorityReport, actionsReport, scopeReport };
