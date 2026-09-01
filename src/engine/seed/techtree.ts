/**
 * The curated capability model — the tech tree itself.
 *
 * Authored data rather than anything discovered on a machine: the eras, the
 * compound capabilities and the prerequisites between them. It is what makes a
 * fresh graph a map with somewhere to go rather than an inventory.
 */
import { loadTechTree } from '../paths.ts';
import type { Db } from '../db.ts';
import { edgeWriter } from './writers.ts';

/**
 * Places the user on the curated capability tree in techtree.json.
 *
 * The tree is authored content, the way a Civ tech tree is: everyone gets the
 * same one and differs only in where they are on it. That is what makes the
 * unlock analyses work without the user hand-authoring the interesting half —
 * previously they returned empty until someone wrote their own combos.
 *
 * Each node is matched against the ids already seeded from the user's config:
 *   detected                        → unlocked, with an edge from what proved it
 *   prerequisites met, not detected → locked, and surfaced as researchable next
 *   prerequisites unmet             → locked, further out
 *
 * Nodes are stored with a `combo:` prefix and category, because that is what
 * the existing unlock analyses select on.
 */
function seedTechTree(db: Db, insert: any): number {
  const tree = loadTechTree();
  if (!tree?.nodes?.length) return 0;

  // What the environment actually turned up. Actions are excluded: they are
  // created by this function from the tree's own contracts, so on a re-seed the
  // tree would detect itself — `act:web-research/search` matches web-research's
  // `search` pattern, and the node would appear to be provided by the node.
  // Human-supplied actions are excluded for the same reason, which was already
  // latent before contracts existed.
  const owned: string[] = db
    .prepare("SELECT id FROM capabilities WHERE kind != 'capability' AND kind != 'action'")
    .all()
    .map((r: any) => r.id);
  const modelCount = owned.filter(id => id.startsWith('model:')).length;

  const link = edgeWriter(db);

  // Which of the user's capabilities, if any, prove each node.
  const evidence = new Map<string, string[]>();
  for (const node of tree.nodes || []) {
    const patterns: string[] = node.detect?.any || [];
    const hits = owned.filter(id =>
      patterns.some(p => {
        try {
          return new RegExp(p, 'i').test(id);
        } catch {
          return false;
        }
      })
    );
    const meetsMin = !node.detect?.min_models || modelCount >= node.detect.min_models;
    evidence.set(node.id, hits.length && meetsMin ? hits : []);
  }

  // Resolve in era order so a node's prerequisites are settled before it is.
  // Without this the tree contradicts itself — reporting Offline Capable as
  // reached while Local Embeddings, which it requires, is still locked.
  const ordered = [...(tree.nodes || [])].sort((a: any, b: any) => (a.era || 0) - (b.era || 0));
  const unlocked = new Set<string>();

  let count = 0;
  for (const node of ordered) {
    const id = `combo:${node.id}`;
    const proof = evidence.get(node.id) || [];
    const missing: string[] = (node.requires || []).filter((r: string) => !unlocked.has(r));
    const reached = proof.length > 0 && missing.length === 0;
    if (reached) unlocked.add(node.id);

    // Having the tooling for a node whose prerequisites are unmet is the most
    // useful thing the tree can tell you, so say it rather than hiding it.
    const blocked = proof.length > 0 && missing.length > 0;
    const names = (ids: string[]) =>
      ids.map(r => tree.nodes.find((n: any) => n.id === r)?.name || r).join(', ');
    const description = reached
      ? node.description
      : blocked
        ? `${node.description} — configured, but ${names(missing)} is not in place yet`
        : `${node.description} — ${node.hint || ''}`.trim();

    insert.run(
      id,
      node.name,
      node.domain || 'meta',
      description,
      'combo',
      reached ? 'unlocked' : 'locked',
      reached ? 0.7 : 0
    );
    // The insert is OR IGNORE, so on a re-seed it does nothing — which left
    // every tech-tree node frozen at whatever the first run computed. Change
    // your config, re-run bootstrap, and the tree would not move. State is
    // derived, so it has to be written every time.
    db.prepare(
      `UPDATE capabilities SET state = ?, description = ?, maturity_score = ?,
       unlock_cost_setup = ?, unlock_cost_tokens = ?,
       updated_at = CASE WHEN state != ? THEN datetime('now') ELSE updated_at END
       WHERE id = ?`
    ).run(
      reached ? 'unlocked' : 'locked',
      description,
      reached ? 0.7 : 0,
      node.setup_seconds || 0,
      node.tokens || 0,
      reached ? 'unlocked' : 'locked',
      id
    );
    count++;

    // The concrete actions the capability confers, each a node of its own.
    //
    // This is the difference between knowing the system has Version Control and
    // knowing it may read a repository and may not merge to its default branch.
    // The action's state mirrors the capability's — an action is reachable
    // exactly when the thing conferring it is — and its authority does not, so
    // that a reached capability can still hold an action nobody may perform.
    //
    // A contract entry is a name, or `{ id, verify }` when the action declares
    // its own check — reading a repository is a weaker claim than having read a
    // particular repository, and the action's evidence should be able to say so.
    for (const action of node.contract?.can || []) {
      const actionName = action.id ?? action;
      const actionId = `act:${node.id}/${actionName}`;
      insert.run(
        actionId,
        actionName,
        node.domain || 'meta',
        `${node.name} can ${String(actionName).replace(/_/g, ' ')}`,
        'action',
        reached ? 'unlocked' : 'locked',
        reached ? 0.7 : 0
      );
      db.prepare('UPDATE capabilities SET state = ?, maturity_score = ? WHERE id = ?').run(
        reached ? 'unlocked' : 'locked',
        reached ? 0.7 : 0,
        actionId
      );
      link.run(id, actionId, 1, 'Provides this action');
      count++;
    }

    // Edges from the user's own capabilities to the node they unlock, so
    // `tt impact` can answer what breaks if a given tool goes away.
    for (const hit of proof.slice(0, 6)) {
      link.run(hit, id, 1, 'Provides this capability');
    }
    // Tier progression between tree nodes.
    for (const req of node.requires || []) {
      link.run(`combo:${req}`, id, 1, 'Tech tree prerequisite');
    }
    for (const opt of node.optional || []) {
      link.run(`combo:${opt}`, id, 0, 'Strengthens this capability');
    }
  }

  return count;
}

export { seedTechTree };
