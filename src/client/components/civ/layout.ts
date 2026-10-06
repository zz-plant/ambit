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
import type { FocusDirection } from '../../linkState';
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
export const NODE_R = 22;
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

/**
 * The nodes a focus keeps around one node: itself, and everything within
 * `depth` hops of it in the direction asked. `needs` follows prerequisites,
 * `enables` follows dependants, and `both` is those two walks together. It is
 * not a walk that ignores direction: what a node's prerequisite also enables
 * is a sibling, and is neither what this needs nor what it enables.
 *
 * `within` is the set the map draws. The edge list holds edges to nodes the
 * map never shows (the demo has 97, and 42 of them join two drawn nodes), and
 * a hop through one of those would count a neighbourhood nobody can see, so a
 * walk never leaves `within`. A node the map does not draw has no
 * neighbourhood on it, and gets an empty set.
 */
export function neighbourhood(
  connections: Connection[],
  id: string,
  depth: number,
  direction: FocusDirection,
  within: Set<string>
): Set<string> {
  const shown = new Set<string>();
  if (!within.has(id)) return shown;
  shown.add(id);
  const { downstream, upstream } = buildAdjacency(connections, null);
  const walk = (edges: Map<string, string[]>) => {
    const seen = new Set([id]);
    let frontier = [id];
    for (let hop = 0; hop < depth && frontier.length; hop++) {
      const next: string[] = [];
      for (const current of frontier) {
        for (const n of edges.get(current) || []) {
          if (!within.has(n) || seen.has(n)) continue;
          seen.add(n);
          shown.add(n);
          next.push(n);
        }
      }
      frontier = next;
    }
  };
  if (direction !== 'enables') walk(upstream);
  if (direction !== 'needs') walk(downstream);
  return shown;
}

/** What a collapse leaves on the map, and what it takes off. */
export interface Collapse {
  /** The ids the map still draws. */
  shown: Set<string>;
  /** How many of the map's nodes are hidden: the whole map less what is shown. */
  hidden: number;
  /** How many nodes the whole map draws. */
  total: number;
}

/**
 * The map collapsed to one node's neighbourhood, or nothing where the node is
 * not on the map, which is an entry of My Setup and has no place to collapse to.
 */
export function collapseTo(
  items: Item[],
  connections: Connection[],
  id: string,
  depth: number,
  direction: FocusDirection
): Collapse | null {
  const drawn = new Set(visibleItems(items).map(i => i.id));
  if (!drawn.has(id)) return null;
  const shown = neighbourhood(connections, id, depth, direction, drawn);
  return { shown, hidden: drawn.size - shown.size, total: drawn.size };
}

/**
 * Where `j` and `k` go: the next node in the list, or the previous, wrapping
 * at the ends and skipping any that a collapse has hidden. Nothing selected
 * starts at the first going forward and the last going back. Null where there
 * is nowhere to go, so the selection is never handed back to the toggle that
 * would clear it.
 */
export function stepSelection(
  list: Item[],
  selectedId: string | null,
  step: 1 | -1,
  shown?: Set<string> | null
): string | null {
  const pool = shown ? list.filter(i => shown.has(i.id)) : list;
  if (!pool.length) return null;
  const at = pool.findIndex(i => i.id === selectedId);
  const to = at < 0 ? (step === 1 ? 0 : pool.length - 1) : (at + step + pool.length) % pool.length;
  return pool[to].id === selectedId ? null : pool[to].id;
}

/** The edge kinds that mean "supplies", as the engine names them. */
const PROVISION_KINDS = new Set(['provides', 'contributes']);

/** Whether an edge supplies its target, as opposed to being something it requires. */
export const isProvision = (c: Connection): boolean => PROVISION_KINDS.has(c.kind ?? '');

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

/**
 * The gap in an order it can be closed: each step after every step it needs,
 * the way Civ numbers the path to a distant tech. A set lit all at once said
 * what stood in the way and not where to start, and Launch Ready's six steps
 * sit across four columns. Ties go to the earlier era, then the name, so the
 * numbers do not move between renders. The node itself is not a step.
 */
export function routeTo(items: Item[], connections: Connection[], id: string): string[] {
  const { missing } = gapOf(items, connections, id);
  const byId = new Map(items.map(i => [i.id, i]));
  const required = new Map<string, string[]>();
  for (const c of connections) {
    if (c.type !== 'hard-dep') continue;
    if (!required.has(c.to)) required.set(c.to, []);
    required.get(c.to)!.push(c.from);
  }
  const era = (x: string) => Number(byId.get(x)?.meta?.era) || 0;
  const name = (x: string) => byId.get(x)?.name || x;
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (node: string) => {
    if (seen.has(node)) return;
    seen.add(node);
    const needs = (required.get(node) || [])
      .filter(p => missing.has(p))
      .sort((a, b) => era(a) - era(b) || name(a).localeCompare(name(b)));
    for (const p of needs) visit(p);
    if (missing.has(node)) order.push(node);
  };
  visit(id);
  return order;
}

/**
 * What a rebuild of the graph reached, as the sentence the page shows: the
 * nodes of the tree that are reached now and were not, and the ones that
 * became next steps because of it. Null when nothing was reached, so the page
 * says only that it reloaded. A node the old graph did not hold is left out:
 * the tree gaining a node is the model changing, not the machine.
 */
export function unlockedSince(before: Item[], after: Item[]): string | null {
  const was = new Map(before.map(i => [i.id, i]));
  const tree = (i: Item) => i.type === 'possibility';
  const reached = after.filter(
    i => tree(i) && i.status === 'built' && was.has(i.id) && was.get(i.id)!.status !== 'built'
  );
  if (!reached.length) return null;
  const opened = after.filter(
    i => tree(i) && isNext(i) && was.has(i.id) && !isNext(was.get(i.id)!)
  );
  const list = (items: Item[]) => {
    const names = items.slice(0, 3).map(i => i.name);
    const more = items.length - names.length;
    if (more > 0) return `${names.join(', ')} and ${more} more`;
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  };
  const head = `${list(reached)} reached`;
  if (!opened.length) return `${head}.`;
  return `${head}, which makes ${list(opened)} ${opened.length === 1 ? 'a next step' : 'next steps'}.`;
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

/**
 * The x a column's nodes sit on: the middle of its band. The renderer drew
 * nodes here while this placed the edges 24 units to the left of it, so every
 * edge on the map entered its circle off centre. One function, both readers.
 */
export const columnCentre = (ci: number): number => START_X + ci * COL_W + COL_W / 2 - 16;

/**
 * The faint band a column sits in, from its header down to the legend. The map
 * draws it behind the column and the minimap draws it as the era's bar, so
 * the thumbnail is the map's own shape.
 */
export const bandOf = (ci: number, sceneHeight: number) => ({
  x: START_X + ci * COL_W - 8,
  y: START_Y - 45,
  width: COL_W - 16,
  height: sceneHeight - START_Y - 20,
});

export interface Placed {
  x: number;
  y: number;
  item: Item;
}

/** Where each node sits in the scene, by column then row. */
export function layoutNodes({ cols, colOrder }: Columns): Map<string, Placed> {
  const map = new Map<string, Placed>();
  colOrder.forEach((column, ci) => {
    const cx = columnCentre(ci);
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
    // The key lived under the last row; it opens from the controls now.
    height: Math.max(...colOrder.map(d => (cols[d]?.length || 0) * ROW_H), 5) + START_Y + 24,
  };
}

/**
 * How far below the top of the canvas's scroller the canvas starts under the
 * map's headline, in pixels: what the canvas's own top margin does not already
 * clear. The range line shares the zoom and lens controls' row, which that
 * margin is for, so a line of range and a line of finding (82px in all) is the
 * 40px it always was, and each line either of them wraps to adds its own. A
 * fixed 40px let the finding sit on the era names at 900px. Until the headline
 * is measured it is that 40px.
 */
export function headlineReserve(height: number | null): number {
  return height === null ? 40 : Math.max(0, height - 42);
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
 * Where a node stands on its era's ladder. Failing is a state of its own:
 * `status` is structural, and a reached node whose check failed is configured
 * and not working. The era header counted it as reached and read "5 of 5"
 * over a column with a red node in it.
 */
export type RungState = 'reached' | 'failing' | 'next' | 'blocked';

export const rungOf = (item: Item): RungState =>
  item.status === 'built'
    ? isFailing(item)
      ? 'failing'
      : 'reached'
    : isNext(item)
      ? 'next'
      : 'blocked';

/** A column's nodes by state. The era header draws this and the ladder lists it, so they cannot disagree. */
export interface Progress {
  total: number;
  /** Reached, with a check that has not failed. */
  reached: number;
  failing: number;
  next: number;
  blocked: number;
  /** Setup time of everything not yet reached, in seconds. Zero when nothing carries an estimate. */
  seconds: number;
}

export function columnProgress(list: Item[]): Progress {
  const progress: Progress = {
    total: list.length,
    reached: 0,
    failing: 0,
    next: 0,
    blocked: 0,
    seconds: 0,
  };
  for (const item of list) {
    progress[rungOf(item)] += 1;
    if (item.status !== 'built') progress.seconds += Number(item.meta?.setupSeconds) || 0;
  }
  return progress;
}

/**
 * What a blocked node waits for, in the words the panel and the ladder share:
 * the prerequisites it names directly come first, three at most, then a count
 * of the rest, then the setup time all of them add up to.
 */
export function blockedBy(
  items: Item[],
  connections: Connection[],
  id: string,
  gap = gapOf(items, connections, id)
): { names: string[]; more: number; seconds: number } {
  const byId = new Map(items.map(i => [i.id, i]));
  const missing = [...gap.missing];
  const direct = missing.filter(p => connections.some(c => c.from === p && c.to === id));
  const named = (direct.length ? direct : missing).slice(0, 3);
  return {
    names: named.map(p => byId.get(p)?.name || p),
    more: missing.length - named.length,
    seconds: gap.seconds,
  };
}

/**
 * The required prerequisites of a node that are reached and failing. `next`
 * from the engine's tree is state-only: a node whose prerequisite is
 * configured and not working still reads as a next step, where the engine's
 * own `ambit next` counts that prerequisite as missing. The ladder keeps the
 * state the map draws and says what is wrong underneath it.
 */
export function failingNeeds(items: Item[], connections: Connection[], id: string): Item[] {
  const byId = new Map(items.map(i => [i.id, i]));
  const out: Item[] = [];
  for (const c of connections) {
    if (c.to !== id || c.type !== 'hard-dep') continue;
    const from = byId.get(c.from);
    if (from && isFailing(from) && !out.includes(from)) out.push(from);
  }
  return out;
}

/** "A", "A and B", "A, B and C". */
const listOf = (names: string[]): string =>
  names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** One line of a ladder: a node, where it stands, and the one fact that explains it. */
export interface Rung {
  item: Item;
  state: RungState;
  /** A next step's setup time as the map writes it beside the node. Absent when none is recorded. */
  estimate?: string;
  /** What it waits for, or what is wrong with it. Absent for a node that is reached and passing. */
  detail?: string;
}

export interface EraLadder {
  era: number;
  name: string;
  progress: Progress;
  rows: Rung[];
}

/** The order of a ladder: what needs attention first, then what is done. */
const RUNG_RANK: Record<RungState, number> = { failing: 0, next: 1, blocked: 2, reached: 3 };

/**
 * An era as a ladder of its nodes: how far up it you are, and for each rung
 * either that it is reached, or what it takes. Failing comes first, then the
 * next steps cheapest first, then blocked, then reached. A rung with no
 * estimate has none to show, and sorts after those that do.
 */
export function eraLadder(items: Item[], connections: Connection[], era: number): EraLadder | null {
  const list = items.filter(i => eraOf(i) === era);
  if (!list.length) return null;
  const cost = (i: Item) => Number(i.meta?.setupSeconds) || Number.POSITIVE_INFINITY;
  const rows = list.map((item): Rung => {
    const state = rungOf(item);
    const stuck =
      state === 'reached' || state === 'failing' ? [] : failingNeeds(items, connections, item.id);
    const clauses: string[] = [];
    if (state === 'failing') clauses.push('Configured, but not working');
    if (state === 'blocked') {
      const { names, more, seconds } = blockedBy(items, connections, item.id);
      if (names.length) {
        clauses.push(
          `Waits for ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}${
            seconds ? `, about ${readableSeconds(seconds)} of setup first` : ''
          }`
        );
      }
    }
    if (stuck.length) {
      clauses.push(
        `Needs ${listOf(stuck.map(i => i.name))}, which ${stuck.length === 1 ? 'is' : 'are'} failing ${
          stuck.length === 1 ? 'its check' : 'their checks'
        }`
      );
    }
    return {
      item,
      state,
      estimate: state === 'next' ? costOf(item) || undefined : undefined,
      detail: clauses.length ? clauses.join('; ') : undefined,
    };
  });
  rows.sort(
    (a, b) =>
      RUNG_RANK[a.state] - RUNG_RANK[b.state] ||
      (a.state === 'next' ? cost(a.item) - cost(b.item) || 0 : 0) ||
      a.item.name.localeCompare(b.item.name)
  );
  return { era, name: columnLabel(`era:${era}`, list), progress: columnProgress(list), rows };
}

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
  /**
   * The next step to lead with, and how much it would open: the engine's first
   * pick when it ranked any, else the one that opens the most, cheapest first
   * on a tie.
   */
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
export function mapFindings(
  items: Item[],
  connections: Connection[],
  ranked: string[] = []
): MapFindings {
  const tree = visibleItems(items).filter(i => !isEntry(i));
  const failing = tree.filter(isFailing);
  let best: MapFindings['best'];
  // The engine ranks what to reach next for My Setup, Time & cost and `ambit
  // next`, by what blocked work and then by leverage per hour. The map ranked
  // by its own rule and named a different step on the same page, so its pick
  // is the engine's whenever the engine made one that is on the map.
  const byId = new Map(tree.map(i => [i.id, i]));
  const pick = ranked.map(id => byId.get(id)).find(i => i && i.status !== 'built' && isNext(i));
  if (pick) best = { item: pick, reaches: unlockCascade(items, connections, pick.id).size };
  for (const item of best ? [] : tree) {
    if (item.status === 'built' || !isNext(item)) continue;
    const reaches = unlockCascade(items, connections, item.id).size;
    const cost = Number(item.meta?.setupSeconds) || Number.POSITIVE_INFINITY;
    const bestCost = Number(best?.item.meta?.setupSeconds) || Number.POSITIVE_INFINITY;
    if (!best || reaches > best.reaches || (reaches === best.reaches && cost < bestCost)) {
      best = { item, reaches };
    }
  }
  let weakest: MapFindings['weakest'];
  // A node on the map, since that is what the line names and Simulate lights:
  // an entry can share a node's name (tool:bash is "Shell Execution" too), and
  // the line then named the node and counted the entry, one more than the
  // banner said. The runtime is the agent itself: losing it stops everything,
  // which is true and tells nobody anything.
  for (const item of tree) {
    if (item.status !== 'built' || isRuntimeNode(item)) continue;
    // The same count the outage banner states when this one is simulated.
    const stops = outageImpact(items, outageSplit(items, connections, item.id)).stopped.length;
    if (stops > (weakest?.stops ?? 0)) weakest = { item, stops };
  }
  return { failing, best, verified: tree.filter(isProven).length, weakest };
}

/**
 * What a running simulation implies, in one sentence: the banner says it, and
 * the saved image leads with it, so the two cannot disagree about a count.
 */
export function simulationSentence(
  mode: string,
  name: string,
  cascade: Set<string>,
  weakened: Set<string> | undefined,
  items: Item[]
): string {
  const n = cascade.size;
  const plural = (count: number) => (count === 1 ? 'capability' : 'capabilities');
  if (mode === 'outage') {
    const outage = outageSentence(name, outageImpact(items, { stops: cascade, weakened }));
    return outage.before + outage.count + outage.after;
  }
  if (mode === 'gap') {
    // The gap's price: the setup time of everything in it, added up.
    const seconds = items
      .filter(i => cascade.has(i.id))
      .reduce((t, i) => t + (Number(i.meta?.setupSeconds) || 0), 0);
    return `Reaching ${name} needs ${n} more ${plural(n)} first${
      seconds ? `, about ${readableSeconds(seconds)} of setup` : ''
    }.`;
  }
  return `Adding ${name} would make ${n} more ${plural(n)} reachable.`;
}

/** A zoom and the scroll offsets that put a set of scene points in view. */
export interface Framing {
  zoom: number;
  left: number;
  top: number;
}

/**
 * The zoom and scroll that frame `points` inside the part of the canvas a
 * person can see: `view` is that part, measured from the scroller's top-left,
 * so a card laid over the bottom of the map shrinks it. Fitting the whole tree
 * to a phone left its labels at four pixels; framing only what is lit keeps
 * them legible. When even the floor is too wide, the frame starts at the
 * leftmost point, since a cascade spreads rightward from its origin.
 */
export function frameScene(
  points: { x: number; y: number }[],
  view: { top: number; width: number; height: number },
  opts: { min: number; max: number; pad?: number; inset?: number }
): Framing | null {
  if (!points.length || view.width <= 0 || view.height <= 0) return null;
  const pad = opts.pad ?? NODE_R + 40;
  const inset = opts.inset ?? 0;
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  // Labels hang below a node, so the box reaches further down than up.
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad + 24;
  const fit = Math.min(view.width / (maxX - minX), view.height / (maxY - minY));
  const zoom = +Math.max(opts.min, Math.min(opts.max, fit)).toFixed(2);
  const wide = (maxX - minX) * zoom > view.width;
  const tall = (maxY - minY) * zoom > view.height;
  const left = wide ? minX * zoom + inset : ((minX + maxX) / 2) * zoom + inset - view.width / 2;
  const top = tall
    ? minY * zoom - view.top
    : ((minY + maxY) / 2) * zoom - view.top - view.height / 2;
  return { zoom, left: Math.max(0, Math.round(left)), top: Math.max(0, Math.round(top)) };
}
