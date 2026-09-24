/**
 * Where every node in the tree goes, and which nodes are on screen at all.
 *
 * Split out of CivTree.tsx, which was 1,067 lines and — being a React
 * component full of SVG — had no test coverage whatsoever. All of this is a
 * pure function of its inputs: what column an item belongs in, which items a
 * filter admits, how the columns order, where each node lands, and what is
 * reachable from a selection. None of it needed a DOM to be correct, and none
 * of it was checked.
 *
 * The component keeps the rendering and the interaction. This keeps the
 * arithmetic and the graph walking, which is the part that can be wrong in
 * ways nobody would notice by looking.
 */
import type { Connection, Item } from '../../utils/configImporter';

/**
 * Column order for a graph with no eras, where columns are domains. The map is
 * the tree; this is what a graph export that carries no era falls back to.
 */
export const DOMAIN_ORDER = [
  'infra',
  'devops',
  'backend',
  'frontend',
  'ai-ml',
  'quality',
  'meta',
  'security',
];

/** Geometry. The node radius and the column and row pitch, in scene units. */
export const NODE_R = 28;
export const COL_W = 170;
export const ROW_H = 105;
export const START_X = 90;
export const START_Y = 70;

/** `meta` is an untyped bag; these narrow the two fields the tree reads. */
export const domainOf = (item: Item): string => (item.meta?.domain as string) || 'meta';

/** Tech-tree items carry an era; config items fall back to their domain. */
export const eraOf = (item: Item): number | undefined =>
  typeof item.meta?.era === 'number' ? (item.meta.era as number) : undefined;

export const columnOf = (item: Item): string => {
  const era = eraOf(item);
  return era === undefined ? domainOf(item) : `era:${era}`;
};

/**
 * A column's name. An era is named by the tree; a domain is named by the
 * glossary's own word for it, which is the word the detail panel uses too. The
 * domain columns used to read Foundation, Pipeline, Guard and Fortress, none
 * of which is a word the glossary or the panel ever says, and Foundation is
 * also the tree's first era.
 */
export const columnLabel = (key: string, items: Item[]): string => {
  if (!key.startsWith('era:')) return key;
  const named = items.find(i => i.meta?.eraName);
  return (named?.meta?.eraName as string) || `Era ${key.slice(4)}`;
};

/**
 * The node that everything else hangs off — the agent runtime itself.
 *
 * Keyed `runtime:opencode` by the engine and, since the config view was
 * realigned, by `importConfig` too. `framework` is still accepted because the
 * demo's hand-authored loop snapshot uses it.
 */
export function isRuntimeNode(item: { id: string; type: string }): boolean {
  return item.id === 'runtime:opencode' || item.type === 'runtime' || item.type === 'framework';
}

/** Prerequisites met, nothing detected — the frontier you can take next. */
export const isNext = (item: Item): boolean => item.meta?.next === true;

export const costOf = (item: Item): string => {
  const s = item.meta?.setupSeconds as number | undefined;
  if (!s) return '';
  return s >= 3600 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 60)}m`;
};

export interface Adjacency {
  downstream: Map<string, string[]>;
  upstream: Map<string, string[]>;
  /** Everything reachable from the selection, following edges both ways. */
  chainIds: Set<string>;
}

export function buildAdjacency(connections: Connection[], selectedId: string | null): Adjacency {
  const downstream = new Map<string, string[]>();
  const upstream = new Map<string, string[]>();
  for (const c of connections) {
    if (!downstream.has(c.from)) downstream.set(c.from, []);
    downstream.get(c.from)!.push(c.to);
    if (!upstream.has(c.to)) upstream.set(c.to, []);
    upstream.get(c.to)!.push(c.from);
  }

  const chainIds = new Set<string>();
  if (selectedId) {
    const queue = [selectedId];
    while (queue.length) {
      const id = queue.shift();
      if (!id || chainIds.has(id)) continue;
      chainIds.add(id);
      for (const n of downstream.get(id) || []) queue.push(n);
      for (const n of upstream.get(id) || []) queue.push(n);
    }
  }
  return { downstream, upstream, chainIds };
}

/**
 * The items the map draws.
 *
 * If anything carries an era we are looking at the tree; show that alone, so
 * the columns mean one thing and prerequisites read left to right. The
 * machine's own entries are in the same list, and they are what My Setup
 * shows; on the map they appear as the evidence behind a node, not as nodes.
 * A graph with no eras at all, an export that carries none, is drawn as it
 * stands.
 */
export function visibleItems(items: Item[]): Item[] {
  const eraItems = items.filter(i => eraOf(i) !== undefined);
  return eraItems.length > 0 ? eraItems : items;
}

/** The machine's own entries: everything that is not a node of the tree. */
export const isEntry = (item: Item): boolean => eraOf(item) === undefined;

/** Where a node stands, for ordering: reached first, then the frontier, then blocked. */
const stateRank = (item: Item): number => (item.status === 'built' ? 0 : isNext(item) ? 1 : 2);

/**
 * Wrap a name onto at most two lines of roughly `perLine` characters.
 *
 * A long name used to be cut at eighteen characters with an ellipsis, so the
 * map read "Private Data Handli…" under a column wide enough for the whole
 * name on two lines. A third line would collide with the next row, so what
 * does not fit on two is still cut, and only then.
 */
export function wrapLabel(name: string, perLine = 16): string[] {
  const words = name.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if ((line + ' ' + word).length <= perLine) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines;
  const second = lines.slice(1).join(' ');
  return [lines[0], second.length > perLine ? second.slice(0, perLine - 1) + '…' : second];
}

/**
 * What stops if `id` went down: everything reachable along dependency edges,
 * any number of hops. The outage simulation draws this set, and the detail
 * panel states its size, so the two are one walk.
 */
export function outageCascade(connections: Connection[], id: string): Set<string> {
  const { downstream } = buildAdjacency(connections, null);
  const cascade = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of downstream.get(current) || []) {
      if (!cascade.has(next)) {
        cascade.add(next);
        queue.push(next);
      }
    }
  }
  return cascade;
}

/**
 * How many hops each node of a simulation sits from the node it started at,
 * along dependency edges. The map staggers the cascade by this, so an outage
 * reads as something spreading outward and not as a page that changed colour.
 * Only nodes in `within` are counted; the walk does not pass through others.
 */
export function cascadeDepths(
  connections: Connection[],
  rootId: string,
  within: Set<string>
): Map<string, number> {
  const { downstream } = buildAdjacency(connections, null);
  const depth = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of downstream.get(current) || []) {
      if (!within.has(next) || depth.has(next)) continue;
      depth.set(next, depth.get(current)! + 1);
      queue.push(next);
    }
  }
  return depth;
}

/** The edge kinds that mean "supplies", as the engine names them. */
const PROVISION_KINDS = new Set(['provides', 'contributes']);

/**
 * What an outage of `id` does, in two sets: what stops, and what only loses a
 * provider. The cascade used to paint everything downstream red, so losing
 * one of two providers read the same as losing the only one. A node stops
 * when a required prerequisite stops, or when every one of its providers has;
 * it is weakened when it keeps another provider, or when the edge was optional.
 * Edges without a kind, from data older than the kind, count as requirements,
 * which is the old answer.
 */
export function outageSplit(
  items: Item[],
  connections: Connection[],
  id: string
): { stops: Set<string>; weakened: Set<string> } {
  const byId = new Map(items.map(i => [i.id, i]));
  const out = new Map<string, Connection[]>();
  for (const c of connections) {
    if (!out.has(c.from)) out.set(c.from, []);
    out.get(c.from)!.push(c);
  }
  const gone = new Set<string>([id]);
  const weakened = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of out.get(current) || []) {
      const node = byId.get(edge.to);
      if (!node || gone.has(edge.to)) continue;
      let stops: boolean;
      if (edge.kind && PROVISION_KINDS.has(edge.kind)) {
        const providers = (node.meta?.providers as string[] | undefined) ?? [edge.from];
        stops = providers.every(p => gone.has(p));
      } else {
        stops = edge.type === 'hard-dep';
      }
      if (stops) {
        gone.add(edge.to);
        weakened.delete(edge.to);
        queue.push(edge.to);
      } else {
        weakened.add(edge.to);
      }
    }
  }
  gone.delete(id);
  return { stops: gone, weakened };
}

/**
 * What stands between a node and being reached: every required prerequisite
 * that is not reached, any number of hops up, and the setup time they add up
 * to. Blocked is the glossary's most informative state and the map drew it as
 * a faded circle; this is the sentence the panel says instead.
 */
export function gapOf(
  items: Item[],
  connections: Connection[],
  id: string
): { missing: Set<string>; seconds: number } {
  const byId = new Map(items.map(i => [i.id, i]));
  const required = new Map<string, string[]>();
  for (const c of connections) {
    if (c.type !== 'hard-dep') continue;
    if (!required.has(c.to)) required.set(c.to, []);
    required.get(c.to)!.push(c.from);
  }
  const missing = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const p of required.get(current) || []) {
      const node = byId.get(p);
      if (!node || node.status === 'built' || missing.has(p)) continue;
      missing.add(p);
      queue.push(p);
    }
  }
  let seconds = 0;
  for (const m of missing) seconds += Number(byId.get(m)?.meta?.setupSeconds) || 0;
  return { missing, seconds };
}

/** Seconds as the map writes them: minutes under an hour, hours above. */
export const readableSeconds = (s: number): string =>
  !s ? '' : s >= 3600 ? `${Math.round((s / 3600) * 10) / 10}h` : `${Math.round(s / 60)}m`;

/**
 * What becomes reachable if `id` were reached: every node whose required
 * prerequisites are then all met, closed over itself. The unlock simulation
 * draws this set and the detail panel states its size.
 *
 * Only what depends on `id` counts. The closure is taken twice, with and
 * without it, and the difference is the answer. Taken once, it credited every
 * node already reachable from somewhere else, so on the demo tree each of six
 * unrelated next steps "made 18 more reachable", the same 18.
 */
export function unlockCascade(items: Item[], connections: Connection[], id: string): Set<string> {
  const required = new Map<string, string[]>();
  for (const c of connections) {
    if (c.type !== 'hard-dep') continue;
    if (!required.has(c.to)) required.set(c.to, []);
    required.get(c.to)!.push(c.from);
  }
  const reached = new Set(items.filter(i => i.status === 'built').map(i => i.id));
  // `barred` is never admitted: without it, the baseline would reach `id`
  // itself the moment its own prerequisites were met, and so everything after.
  const closure = (start: Set<string>, barred?: string) => {
    const have = new Set(start);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [target, prereqs] of required) {
        if (have.has(target) || target === barred) continue;
        if (prereqs.every(p => have.has(p))) {
          have.add(target);
          changed = true;
        }
      }
    }
    return have;
  };
  const without = closure(reached, id);
  const unlocked = new Set<string>();
  for (const n of closure(new Set([...reached, id]))) {
    if (n !== id && !without.has(n)) unlocked.add(n);
  }
  return unlocked;
}

/**
 * The path an edge takes: a curve that leaves and arrives horizontally, so a
 * bundle of edges into one node fans instead of converging as straight lines
 * through everything between. An edge inside one column bows out to the right.
 */
export function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(x2 - x1) < 1) {
    const bulge = 40;
    return `M${x1},${y1} C${x1 + bulge},${y1} ${x2 + bulge},${y2} ${x2},${y2}`;
  }
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

export interface Columns {
  cols: Record<string, Item[]>;
  colOrder: string[];
}

/**
 * Groups items into columns, decides the order those columns appear in, and
 * orders the rows inside each so that a node sits near what it connects to.
 *
 * Rows used to follow insertion order, so height on the map meant nothing
 * while the Docs claimed it showed how far up the tree something sat. Now
 * each column starts in state order, reached first, and a few barycenter
 * sweeps pull every node toward the mean row of its neighbours. The heuristic
 * is the standard one for layered graphs; it does not promise no crossings,
 * only fewer, and the same input always gives the same order.
 */
export function buildColumns(items: Item[], connections: Connection[] = []): Columns {
  const cols: Record<string, Item[]> = {};
  for (const item of items) {
    const key = columnOf(item);
    if (!cols[key]) cols[key] = [];
    cols[key].push(item);
  }
  // Eras run in numeric order so the tree reads left to right, oldest first.
  const eras = Object.keys(cols)
    .filter(k => k.startsWith('era:'))
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  const colOrder = [...eras, ...DOMAIN_ORDER.filter(d => cols[d]?.length)];
  for (const key of Object.keys(cols)) if (!colOrder.includes(key)) colOrder.push(key);

  for (const key of colOrder) {
    cols[key].sort((a, b) => stateRank(a) - stateRank(b) || a.name.localeCompare(b.name));
  }
  orderRows(cols, colOrder, connections);
  return { cols, colOrder };
}

/** How many sweeps the ordering makes. Four is where the demo tree stops changing. */
const SWEEPS = 4;

/**
 * Barycenter ordering, in place. Each sweep walks the columns in one
 * direction and sorts every column by the mean row of each node's neighbours
 * in the other columns, ties broken by the current position so an unconnected
 * node keeps its place.
 */
function orderRows(cols: Record<string, Item[]>, colOrder: string[], connections: Connection[]) {
  const present = new Set(colOrder.flatMap(k => cols[k].map(i => i.id)));
  const neighbours = new Map<string, string[]>();
  for (const c of connections) {
    if (!present.has(c.from) || !present.has(c.to) || c.from === c.to) continue;
    if (!neighbours.has(c.from)) neighbours.set(c.from, []);
    if (!neighbours.has(c.to)) neighbours.set(c.to, []);
    neighbours.get(c.from)!.push(c.to);
    neighbours.get(c.to)!.push(c.from);
  }
  if (neighbours.size === 0) return;

  const rowOf = new Map<string, number>();
  const index = () => {
    for (const key of colOrder) {
      cols[key].forEach((item, r) => {
        rowOf.set(item.id, r);
      });
    }
  };
  index();

  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    const order = sweep % 2 === 0 ? colOrder : [...colOrder].reverse();
    for (const key of order) {
      const column = cols[key];
      const bary = new Map<string, number>();
      for (const item of column) {
        const rows = (neighbours.get(item.id) || []).map(n => rowOf.get(n) ?? 0);
        bary.set(
          item.id,
          rows.length ? rows.reduce((s, r) => s + r, 0) / rows.length : (rowOf.get(item.id) ?? 0)
        );
      }
      column.sort(
        (a, b) => bary.get(a.id)! - bary.get(b.id)! || rowOf.get(a.id)! - rowOf.get(b.id)!
      );
      column.forEach((item, r) => {
        rowOf.set(item.id, r);
      });
    }
  }
}

export interface Placed {
  x: number;
  y: number;
  item: Item;
}

/** Where each node sits in the scene, by column then row. */
export function layoutNodes({ cols, colOrder }: Columns): Map<string, Placed> {
  const map = new Map<string, Placed>();
  colOrder.forEach((column, ci) => {
    const cx = START_X + ci * COL_W + COL_W / 2 - 40;
    (cols[column] || []).forEach((item, ri) => {
      map.set(item.id, { x: cx, y: START_Y + ri * ROW_H + NODE_R, item });
    });
  });
  return map;
}

/**
 * The scene's extent, which the SVG viewBox is sized from.
 *
 * The floor of 5 on the height is the original's and is kept deliberately: an
 * empty graph still needs a canvas with a size, or the viewBox collapses.
 */
export function sceneSize({ cols, colOrder }: Columns): { width: number; height: number } {
  return {
    width: START_X + colOrder.length * COL_W + 60,
    height: Math.max(...colOrder.map(d => (cols[d]?.length || 0) * ROW_H), 5) + START_Y + 60,
  };
}

/**
 * Reached, and its check failed: configured, and not working. The engine's
 * `usable(lifecycle)` is the same rule; the client has no engine to ask.
 */
export const isFailing = (item: Item): boolean =>
  item.status === 'built' && ['degraded', 'broken'].includes(String(item.meta?.lifecycle ?? ''));

/**
 * Reached, and its check passed: the part of the range there is evidence for.
 * `PROVEN` in the engine's vocabulary.ts is the same list, transcribed.
 */
export const isProven = (item: Item): boolean =>
  item.status === 'built' && ['verified', 'reliable'].includes(String(item.meta?.lifecycle ?? ''));

/**
 * An outage's `stops`, split by what each node was doing before it. `stopped`
 * was reached and passing its check, and is the only part that stops working.
 * `broken` was reached and already failing, so the outage takes nothing from
 * it. `cutOff` was never reached. The map draws all three red; a sentence
 * about the outage has to tell them apart, or a root with twelve unreached
 * dependents reads as twelve things that stopped.
 */
export interface OutageImpact {
  stopped: Item[];
  broken: Item[];
  cutOff: Item[];
  /** Reached, keeps another provider, and only loses this one. */
  thinned: Item[];
}

export function outageImpact(
  items: Item[],
  split: { stops: Set<string>; weakened?: Set<string> }
): OutageImpact {
  const hit = items.filter(i => split.stops.has(i.id));
  return {
    stopped: hit.filter(i => i.status === 'built' && !isFailing(i)),
    broken: hit.filter(isFailing),
    cutOff: hit.filter(i => i.status !== 'built'),
    // Something never reached had no provider to lose.
    thinned: items.filter(i => split.weakened?.has(i.id) && i.status === 'built'),
  };
}

/**
 * The outage sentence the banner and the detail panel both say, in three
 * pieces so the panel can emphasise the count. Only `stopped` is said to stop
 * working; what was never reached is cut off, and what was failing already is
 * named as failing. `others` reads "4 other capabilities" for a subject that
 * is itself a capability ("this").
 */
export function outageSentence(
  subject: string,
  impact: OutageImpact,
  others = false
): { before: string; count: string; after: string } {
  const weakened = impact.thinned.length;
  const plural = (n: number) => (n === 1 ? 'capability' : 'capabilities');
  const stopped = impact.stopped.length;
  const cutOff = impact.cutOff.length;
  const broken = impact.broken.length;
  const rest = [
    cutOff ? `${cutOff} not set up yet would be cut off` : '',
    broken ? `${broken} ${broken === 1 ? 'was' : 'were'} already failing` : '',
  ].filter(Boolean);
  const tail = rest.length ? ` ${rest.join(', and ')}.` : '';
  const before = `If ${subject} went down, `;
  const nothing = rest.length ? 'nothing that works would stop' : 'nothing else would stop working';
  if (stopped) {
    return {
      before,
      count: `${stopped} ${others ? 'other ' : ''}${plural(stopped)}`,
      after: ` would stop working${weakened ? ` and ${weakened} would lose a provider` : ''}.${tail}`,
    };
  }
  if (weakened) {
    return {
      before,
      count: '',
      after: `${nothing}, but ${weakened} ${plural(weakened)} would lose a provider.${tail}`,
    };
  }
  return {
    before,
    count: '',
    after: rest.length
      ? `nothing that works would stop.${tail}`
      : 'nothing else would stop working.',
  };
}

/**
 * What a reached node may do without asking, as the authority lens paints it.
 * `ungranted` is reached with no execute grant at all: the gate refuses it
 * ("No grant covers ...") until someone grants one, which is a different
 * thing to say from a refusal somebody wrote. A node that is not reached has
 * nothing to act with, and one the engine sent no authority for is not given
 * one here; both return undefined and the lens leaves them unpainted.
 */
export type AuthorityMark = 'autonomous' | 'confirm' | 'forbidden' | 'ungranted';

export function authorityMark(item: Item): AuthorityMark | undefined {
  if (item.status !== 'built') return undefined;
  const authority = item.meta?.authority as { execute?: string; ungranted?: boolean } | undefined;
  if (!authority?.execute) return undefined;
  if (authority.ungranted) return 'ungranted';
  return (['autonomous', 'confirm', 'forbidden'] as const).find(m => m === authority.execute);
}

/** The lens's words for each mark, which the legend and the headline share. */
export const AUTHORITY_LABEL: Record<AuthorityMark, string> = {
  autonomous: 'Acts without asking',
  confirm: 'Asks first',
  forbidden: 'Forbidden',
  ungranted: 'No grant yet',
};

/**
 * What a node needs beyond the agent, as the map marks it: a person (who
 * approves it, supplies it, or supplies it with a machine) or a device its
 * provider runs on. A person outranks a device when both hold, since asking
 * someone is the costlier dependency. A recurring cost is economic, not
 * joint, and is left to the panel.
 */
export type JointMark = 'person' | 'device';

export function jointMark(item: Item): JointMark | undefined {
  const structure = (item.meta?.structure as string[] | undefined) ?? [];
  if (structure.some(d => ['institutional', 'cognitive', 'machine-composed-human'].includes(d)))
    return 'person';
  if (structure.includes('physical')) return 'device';
  return undefined;
}

/** What the map says before anyone asks, in the order it matters. */
export interface MapFindings {
  /** Reached, with a check that failed: configured, and not working. */
  failing: Item[];
  /** The next step that reaches the most, cheapest first on a tie. */
  best?: { item: Item; reaches: number };
  /** The size of the range there is evidence for: tree nodes with a passing check. */
  verified: number;
  /**
   * The one reached node whose loss would stop the most that works, counted
   * the way the outage banner counts. Absent when no single loss stops any.
   */
  weakest?: { item: Item; stops: number };
}

/**
 * The map's headline. It used to have none: sixty circles and a legend, and
 * the reader was left to find the one failing check and to work out which
 * outlined node was worth reaching. Both are answers the page can compute, so
 * it states them, and the circles become the evidence for a sentence.
 */
export function mapFindings(items: Item[], connections: Connection[]): MapFindings {
  const tree = visibleItems(items).filter(i => !isEntry(i));
  const failing = tree.filter(isFailing);
  let best: MapFindings['best'];
  for (const item of tree) {
    if (item.status === 'built' || !isNext(item)) continue;
    const reaches = unlockCascade(items, connections, item.id).size;
    const cost = Number(item.meta?.setupSeconds) || Number.POSITIVE_INFINITY;
    const bestCost = Number(best?.item.meta?.setupSeconds) || Number.POSITIVE_INFINITY;
    if (!best || reaches > best.reaches || (reaches === best.reaches && cost < bestCost)) {
      best = { item, reaches };
    }
  }
  let weakest: MapFindings['weakest'];
  // The runtime is the agent itself: losing it stops everything, which is
  // true and tells nobody anything. The weakest point is a piece of the setup.
  for (const item of items) {
    if (item.status !== 'built' || isRuntimeNode(item)) continue;
    // The same count the outage banner states when this one is simulated.
    const stops = outageImpact(items, outageSplit(items, connections, item.id)).stopped.length;
    if (stops > (weakest?.stops ?? 0)) weakest = { item, stops };
  }
  return { failing, best, verified: tree.filter(isProven).length, weakest };
}
