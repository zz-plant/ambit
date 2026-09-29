import { gapOf, isFailing } from '../components/civ/layout';
import type { Connection, Item } from './configImporter';

/** One required prerequisite, and whether it is in place on this machine. */
export interface Need {
  id: string;
  name: string;
  met: boolean;
  /** Why it is not met: never reached, or reached and its check is failing. */
  why?: 'not reached' | 'check failing';
}

export interface CapabilityNeeds {
  /** What is missing first, nearest to the capability first, then what is met. */
  required: Need[];
  /** How many of `required` are met. */
  met: number;
  /**
   * Credentials the capability and its required prerequisites rest on, as the
   * config declared them. Ambit stores no secret and checks none, so these are
   * named and never marked met or missing: that would be a claim nothing measured.
   */
  credentials: { id: string; name: string }[];
}

/**
 * What taking a capability on needs, and how much of it is here.
 *
 * The required prerequisites are the ones the engine's plan walks: the
 * capability's own, and those of every prerequisite still unreached, since
 * reaching one of them needs its own. Each is met when it is reached and its
 * check is not failing, which is `planFor`'s reading (its `degraded` list is
 * the reached ones that fail), and missing otherwise. `gapOf` supplies the
 * unreached ones, so the map's "Blocked by" sentence and this list are one walk.
 *
 * The needs are the capability's, not an option's: the catalog says what an
 * option costs and where it installs from, and nothing about what it requires,
 * so every option of one capability needs the same things. Null when the
 * capability is not a node on this graph.
 */
export function needsOf(
  items: Item[],
  connections: Connection[],
  id: string
): CapabilityNeeds | null {
  const byId = new Map(items.map(i => [i.id, i]));
  if (!byId.has(id)) return null;

  // The prerequisites of the capability and of whatever is still missing. What
  // is already reached has had its own needs met, so its are not asked for.
  const { missing } = gapOf(items, connections, id);
  const nearest = [...missing];
  const required = new Map<string, Item>();
  for (const c of connections) {
    if (c.type !== 'hard-dep' || (c.to !== id && !missing.has(c.to))) continue;
    const node = byId.get(c.from);
    if (node) required.set(node.id, node);
  }

  const needs: Need[] = [...required.values()].map(node => {
    const reached = node.status === 'built';
    const failing = isFailing(node);
    return {
      id: node.id,
      name: node.name,
      met: reached && !failing,
      why: !reached ? 'not reached' : failing ? 'check failing' : undefined,
    };
  });
  // Unreached first, and nearest first among them, then failing, then met. In
  // each group a capability comes before the entries that supply it, since the
  // capabilities are what a person is choosing between.
  const rank = (n: Need) => (n.met ? 2 : n.why === 'check failing' ? 1 : 0);
  const supplier = (n: Need) => (byId.get(n.id)?.type === 'possibility' ? 0 : 1);
  needs.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      supplier(a) - supplier(b) ||
      nearest.indexOf(a.id) - nearest.indexOf(b.id)
  );

  // Whose credentials it rests on: the capability, what it requires, and what
  // supplies those. A credential hangs off the provider that presents it.
  const holders = new Set<string>([id]);
  for (const node of [byId.get(id) as Item, ...required.values()]) {
    holders.add(node.id);
    for (const p of (node.meta?.providers as string[] | undefined) ?? []) holders.add(p);
  }
  const credentials = new Map<string, { id: string; name: string }>();
  for (const holder of holders) {
    for (const cred of (byId.get(holder)?.meta?.credentials as string[] | undefined) ?? []) {
      credentials.set(cred, { id: cred, name: byId.get(cred)?.name ?? cred });
    }
  }

  return {
    required: needs,
    met: needs.filter(n => n.met).length,
    credentials: [...credentials.values()],
  };
}
