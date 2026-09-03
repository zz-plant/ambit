/**
 * The projections the visualiser reads.
 *
 * These used to live inside the API server as hand-written SQL — a second
 * implementation of the model, in a different SQLite driver, drifting from the
 * engine's own. The server is a reader of the graph like any other, so what it
 * reads belongs beside everything else that reads it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.ts';
import { ENGINE_DIR } from './paths.ts';
import { REACHED_SQL } from './vocabulary.ts';
import {
  NODE_TYPES,
  PROPOSAL_STATUSES,
  type NodeType,
  type ProposalRow,
  type ProposalStatus,
  type TechTreeResponse,
  type TreeConnection,
  type TreeItem,
} from '../shared/api.ts';

/** A category the client can draw, or 'config' — never a value it has no case for. */
function nodeType(category: string): NodeType {
  const mapped =
    category === 'combo' ? 'possibility' : category === 'mcp' ? 'mcp-server' : category;
  return (NODE_TYPES as readonly string[]).includes(mapped) ? (mapped as NodeType) : 'config';
}

/**
 * The capability graph in the shape the visualiser renders.
 *
 * Actions conferred by a capability are excluded deliberately. A capability
 * confers several, so including them would multiply the node count without
 * changing what the picture says — the era columns and the three states are a
 * designed visual grammar, and legibility is the product. The finer vocabulary
 * is answered by `ambit graph actions`, which asks for one capability's actions
 * rather than all of them at once.
 *
 * Actions a *person* supplies stay: there are few of them, and they are the
 * only thing connecting a human node to the rest of the graph.
 */
export function techTreeView(db: Db): TechTreeResponse {
  const caps = db
    .prepare(
      `SELECT id, name, domain, description, category, state, unlock_cost_setup, lifecycle
     FROM capabilities c WHERE c.kind != 'action' OR NOT EXISTS (
       SELECT 1 FROM dependencies d JOIN capabilities p ON p.id = d.from_capability
       WHERE d.to_capability = c.id AND d.kind = 'provides' AND p.kind = 'capability'
     )`
    )
    .all();

  const visible = new Set(caps.map(c => c.id));
  const deps = db
    .prepare('SELECT from_capability, to_capability, is_hard_requisite FROM dependencies')
    .all()
    .filter(d => visible.has(d.from_capability) && visible.has(d.to_capability));

  // Era and the "researchable now" state are what make this read as a tech tree
  // rather than a list: Civ's whole grammar is reached / can be researched next
  // / still locked, laid out left to right by era.
  let tree: { nodes?: { id: string; era: number }[]; eras?: Record<string, string> } = {};
  try {
    tree = JSON.parse(readFileSync(join(ENGINE_DIR, 'techtree.json'), 'utf8'));
  } catch {
    /* the curated tree is optional */
  }
  const eraById = new Map((tree.nodes || []).map(n => [`combo:${n.id}`, n.era]));

  // When each capability's check last ran, and how it went — the map draws the
  // difference between proven and merely configured, so it needs the evidence
  // beside the structure.
  const lastEvidence = new Map<string, { at: string; passed: boolean }>(
    db
      .prepare(
        `SELECT capability_id, action, MAX(timestamp) AS at FROM session_learning
       WHERE action IN ('verified','failed') GROUP BY capability_id`
      )
      .all()
      .map(r => [r.capability_id, { at: r.at, passed: r.action === 'verified' }])
  );

  const stateById = new Map<string, string>(caps.map(c => [c.id, c.state]));
  const hardPrereqs = new Map<string, string[]>();
  for (const d of deps) {
    if (!d.is_hard_requisite) continue;
    if (!hardPrereqs.has(d.to_capability)) hardPrereqs.set(d.to_capability, []);
    hardPrereqs.get(d.to_capability)!.push(d.from_capability);
  }

  /** Locked, but everything it requires is already reached. */
  const isNext = (id: string, state: string) =>
    state === 'locked' && (hardPrereqs.get(id) || []).every(p => stateById.get(p) !== 'locked');

  const items: TreeItem[] = caps.map(c => ({
    id: c.id,
    name: c.name,
    type: nodeType(c.category),
    // Locked tech-tree nodes render as the 'specified' (wireframe) state, which
    // is how the visualiser already draws something not yet built.
    status: c.state === 'locked' ? 'specified' : 'built',
    description: c.description,
    position: { x: 0, y: 0, z: 0 },
    meta: {
      domain: c.domain,
      state: c.state,
      setupSeconds: c.unlock_cost_setup,
      era: eraById.get(c.id),
      eraName: eraById.has(c.id) ? tree.eras?.[String(eraById.get(c.id))] : undefined,
      next: isNext(c.id, c.state),
      lifecycle: c.lifecycle,
      lastChecked: lastEvidence.get(c.id)?.at,
    },
  }));

  const connections: TreeConnection[] = deps.map(d => ({
    from: d.from_capability,
    to: d.to_capability,
    type: d.is_hard_requisite ? 'hard-dep' : 'soft-dep',
  }));

  return { items, connections };
}

/**
 * The three counts the live stream reports. Each is guarded on its own: a
 * database predating frontier_snapshots used to throw on the second query and
 * zero the counts from the first, reporting an empty graph for a full one.
 */
export function graphSummary(db: Db): { reached: number; total: number; observations: number } {
  let reached = 0,
    total = 0,
    observations = 0;
  try {
    const counts = db
      // Counted the same way every other surface counts it. This said
      // `state != 'locked'`, which agrees with the rest only because a third
      // state has never been added — and would have diverged silently the day
      // one was.
      .prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN ${REACHED_SQL} THEN 1 ELSE 0 END) AS reached
         FROM capabilities`
      )
      .get();
    total = counts?.total ?? 0;
    reached = counts?.reached ?? 0;
  } catch {
    /* no capabilities table yet */
  }
  try {
    observations = db.prepare('SELECT COUNT(*) AS n FROM frontier_snapshots').get()?.n ?? 0;
  } catch {
    /* ledger predates this database */
  }
  return { reached, total, observations };
}

/** Proposals for the approval UI: the full rows, newest first. */
export function recentProposals(db: Db, limit = 50): ProposalRow[] {
  let rows: Record<string, any>[];
  try {
    rows = db.prepare('SELECT * FROM proposals ORDER BY created_at DESC LIMIT ?').all(limit);
  } catch {
    return [];
  }
  return rows.map(r => ({
    ...r,
    status: (PROPOSAL_STATUSES as readonly string[]).includes(r.status)
      ? (r.status as ProposalStatus)
      : 'draft',
  })) as ProposalRow[];
}

/** How often a person had to step in, per capability — the heatmap's input. */
export function interventionHeatmap(db: Db): Record<string, any>[] {
  try {
    return db
      .prepare(
        `SELECT capability_id, COUNT(*) as count, MAX(timestamp) as last_seen
       FROM session_learning
       WHERE action IN ('intervene', 'confirm', 'failed', 'blocked', 'approved')
       GROUP BY capability_id`
      )
      .all();
  } catch {
    return [];
  }
}
