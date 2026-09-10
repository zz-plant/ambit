/**
 * What a URL says about the view, in both directions.
 *
 * Every piece of view state that is worth sending to someone else lives here:
 * which graph, which view, which node, which lens, which filter. `readLinkState`
 * is applied once when the app mounts; `writeLinkState` runs on every change, so
 * the address bar is always a link to what is on screen and the Share button is
 * a copy of it. Pure, so the rule can be tested without a window.
 */

export type Source = 'config' | 'tree';
export type View = 'graph' | 'loop';

/** How the map is coloured. The lens changes nothing else about the view. */
export const LENSES = ['default', 'attention', 'credentials'] as const;
export type ActiveLens = (typeof LENSES)[number];

/**
 * Which kinds of node the setup view draws. The tree view shows its own eras.
 *
 * 'compact' was in this list and in no renderer: `visibleItems` has a case for
 * each of the others and none for that one, so it fell through to "frameworks
 * only" — a filter that hid the whole graph, reachable only by typing it into
 * the address bar.
 */
export const TREE_FILTERS = ['all', 'server', 'agent', 'skill', 'combo'] as const;
export type TreeFilter = (typeof TREE_FILTERS)[number];

/**
 * The query string this document was opened with, or '' where there is no
 * document. The store is imported by node-side tests as well as by the app,
 * and `window` is not a name that exists in both.
 */
export function currentSearch(): string {
  return (globalThis as { location?: { search?: string } }).location?.search ?? '';
}

export interface LinkState {
  source: Source;
  view: View;
  focusId: string | null;
  docsOpen: boolean;
  /** `?demo=1`: skip the "Open the demo" click so a shared link opens on the graph. */
  demo: boolean;
  /** `?guide=off`: never show the first-run guide, for screenshots. */
  guideOff: boolean;
  lens: ActiveLens;
  treeFilter: TreeFilter;
}

const oneOf = <T extends string>(allowed: readonly T[], value: string | null, fallback: T): T =>
  value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

export function readLinkState(search: string): LinkState {
  const params = new URLSearchParams(search);
  const view = params.get('view');
  const demo = params.get('demo') === '1';
  return {
    // ?demo=1 is the link the README leads with and the one the hero image is
    // a picture of — the tech tree, seven eras. It used to land on My Setup, a
    // flat list of twenty-five config entries, so the front door showed
    // something other than what brought people to it. An explicit view wins.
    source: view === 'tree' ? 'tree' : view === 'config' ? 'config' : demo ? 'tree' : 'config',
    view: view === 'loop' ? 'loop' : 'graph',
    focusId: params.get('focus') || null,
    docsOpen: params.get('docs') === 'open',
    demo,
    guideOff: params.get('guide') === 'off',
    lens: oneOf(LENSES, params.get('lens'), 'default'),
    treeFilter: oneOf(TREE_FILTERS, params.get('treeFilter'), 'all'),
  };
}

/** What `writeLinkState` needs to know. The guide is a first-run state, not a view. */
export type ShareState = Omit<LinkState, 'guideOff'>;

/**
 * The query string for a view — defaults omitted.
 *
 * A link that carries every parameter at its default value is unreadable and
 * says nothing, so only what differs is written. `view` is the exception: it is
 * always stated, because its default depends on `demo` and a reader should not
 * have to know that rule to predict where a link lands.
 */
export function writeLinkState(state: ShareState): string {
  const params = new URLSearchParams();
  params.set('view', state.view === 'loop' ? 'loop' : state.source);
  if (state.demo) params.set('demo', '1');
  if (state.focusId) params.set('focus', state.focusId);
  if (state.docsOpen) params.set('docs', 'open');
  if (state.lens !== 'default') params.set('lens', state.lens);
  if (state.treeFilter !== 'all') params.set('treeFilter', state.treeFilter);
  return '?' + params.toString();
}
