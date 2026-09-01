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

export const TYPE_FILTERS = ['all', 'server', 'agent', 'skill', 'combo'] as const;
export type TypeFilter = (typeof TYPE_FILTERS)[number];

/** Column order for the config view, where columns are domains rather than eras. */
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

export const ERA_LABELS: Record<string, string> = {
  physical: 'Physical',
  infra: 'Foundation',
  devops: 'Pipeline',
  backend: 'Services',
  frontend: 'Interface',
  'ai-ml': 'Intelligence',
  quality: 'Guard',
  meta: 'Orchestration',
  security: 'Fortress',
};

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

export const columnLabel = (key: string, items: Item[]): string => {
  if (!key.startsWith('era:')) return ERA_LABELS[key] || key;
  const named = items.find(i => i.meta?.eraName);
  return (named?.meta?.eraName as string) || `Era ${key.slice(4)}`;
};

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
 * The items a filter admits.
 *
 * If anything carries an era we are looking at the tech tree; show that alone,
 * so the columns mean one thing and prerequisites read left to right.
 */
export function visibleItems(items: Item[], filter: TypeFilter): Item[] {
  const eraItems = items.filter(i => eraOf(i) !== undefined);
  if (eraItems.length > 0) return eraItems;
  if (filter === 'all') return items;
  const byFilter: Record<string, string> = {
    server: 'mcp-server',
    agent: 'agent',
    skill: 'skill',
    combo: 'possibility',
  };
  return items.filter(i => i.type === byFilter[filter] || i.type === 'framework');
}

export interface Columns {
  cols: Record<string, Item[]>;
  colOrder: string[];
}

/** Groups items into columns and decides the order those columns appear in. */
export function buildColumns(items: Item[]): Columns {
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
  return { cols, colOrder };
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
