/**
 * Where a setup stands on the curated tree, from the ids its config turned up.
 *
 * The engine seeds this into the graph (`seedTechTree`), and the hosted page
 * runs it on a config pasted into the tab, so a visitor sees their own setup
 * placed by the same rule `ambit` would place it by. Before, the page drew the
 * pasted entries as a list and told the visitor to install the engine to see
 * them on the map, which is where the demo had said all along the answer was.
 *
 * Pure: no file, no database. The caller loads the tree (the engine merges an
 * overlay first; the page has only the shipped one).
 */

/** A curated node, as much of it as placing needs. */
export interface PlaceableNode {
  id: string;
  name: string;
  description: string;
  era?: number;
  hint?: string;
  requires?: string[];
  optional?: string[];
  detect?: { any?: string[]; min_models?: number; requires_met?: boolean };
}

export interface Placement<N extends PlaceableNode = PlaceableNode> {
  node: N;
  /** Something in the config provides it, or it is a capstone, and every requirement is reached. */
  reached: boolean;
  /** The config ids that provide it; empty when nothing does. */
  proof: string[];
  /** Requirements not reached yet, by node id. */
  missing: string[];
  /** The node's description, with what holds it back when it is configured and blocked. */
  description: string;
}

/**
 * Each node in era order, so a node's prerequisites are settled before it is.
 *
 *   detected, prerequisites met     → reached, with what proved it
 *   prerequisites met, not detected → a next step
 *   prerequisites unmet             → further out
 *
 * A capstone declares `detect: { "requires_met": true }` and no patterns:
 * nothing on a machine is the capstone itself, so it is reached exactly when
 * everything it requires is.
 */
export function placeOnTree<N extends PlaceableNode>(nodes: N[], owned: string[]): Placement<N>[] {
  const modelCount = owned.filter(id => id.startsWith('model:')).length;
  const nameOf = new Map(nodes.map(n => [n.id, n.name]));
  const names = (ids: string[]) => ids.map(r => nameOf.get(r) || r).join(', ');

  // Without the order the tree contradicts itself: Offline Capable reported
  // reached while Local Embeddings, which it requires, is still locked.
  const ordered = [...nodes].sort((a, b) => (a.era || 0) - (b.era || 0));
  const unlocked = new Set<string>();

  return ordered.map(node => {
    const patterns = node.detect?.any || [];
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
    const proof = hits.length && meetsMin ? hits : [];
    const missing = (node.requires || []).filter(r => !unlocked.has(r));
    const capstone = node.detect?.requires_met === true;
    const reached = (capstone || proof.length > 0) && missing.length === 0;
    if (reached) unlocked.add(node.id);

    // Having the tooling for a node whose prerequisites are unmet is the most
    // useful thing the tree can tell you, so say it instead of hiding it.
    const blocked = proof.length > 0 && missing.length > 0;
    const description = reached
      ? node.description
      : blocked
        ? `${node.description} — configured, but ${names(missing)} is not in place yet`
        : node.hint
          ? // Two sentences, not one with a second dash: the hint is an
            // instruction, and it read as a clause trailing off the description.
            `${node.description}. ${node.hint}`
          : node.description;

    return { node, reached, proof, missing, description };
  });
}
