/**
 * What a URL says about the view, in both directions.
 *
 * Every piece of view state that is worth sending to someone else lives here:
 * which view, which node, which lens, and whether the map is collapsed to that
 * node's neighbourhood. `readLinkState` is applied once when the
 * app mounts; `writeLinkState` runs on every change, so the address bar is
 * always a link to what is on screen and the Share button is a copy of it.
 * Pure, so the rule can be tested without a window.
 */

/**
 * The views. `tree` is the map, `config` is My Setup, `loop` is Time & cost,
 * `audit` is the trail. The words are the URL's, kept so that links written
 * before the setup view stopped being a second map still open where they did.
 */
export const VIEWS = ['tree', 'config', 'loop', 'audit'] as const;
export type View = (typeof VIEWS)[number];

/**
 * How the map is coloured. The lens changes nothing else about the view.
 *
 * There were three. The third, Shared credentials, coloured any node whose id
 * contained github, docker, 1password or credential: a string match dressed
 * as an analysis, on a map whose curated nodes never matched it. The engine's
 * own credential report is `ambit credentials`.
 */
export const LENSES = ['default', 'attention', 'authority'] as const;
export type ActiveLens = (typeof LENSES)[number];

/**
 * How far a collapse reaches from the selected node, and which way. `collapse`
 * keeps only that neighbourhood on the map. `focus` already means the selected
 * node, and letting it imply a collapse would change every link that exists,
 * so a collapse is its own flag and off unless a link says so.
 */
export const FOCUS_DEPTHS = [1, 2, 3] as const;
export type FocusDepth = (typeof FOCUS_DEPTHS)[number];
export const FOCUS_DIRECTIONS = ['needs', 'both', 'enables'] as const;
export type FocusDirection = (typeof FOCUS_DIRECTIONS)[number];
export const DEFAULT_FOCUS_DEPTH: FocusDepth = 2;

/**
 * The tour's steps a link may open on. A docs page reached from a search links
 * into the demo, and the visitor came for one answer: the page on outages
 * opens the outage, the page on config files opens the paste box. Each used to
 * start on the tour's first card, which is about something else.
 */
export const TOUR_STEPS = ['next', 'outage', 'failing', 'approval', 'yours'] as const;
export type TourStep = (typeof TOUR_STEPS)[number];
export const DEFAULT_FOCUS_DIRECTION: FocusDirection = 'both';

/**
 * The query string this document was opened with, or '' where there is no
 * document. The store is imported by node-side tests as well as by the app,
 * and `window` is not a name that exists in both.
 */
export function currentSearch(): string {
  return (globalThis as { location?: { search?: string } }).location?.search ?? '';
}

export interface LinkState {
  view: View;
  /** Whether the link named a view at all, so a narrow screen may pick its own. */
  viewStated: boolean;
  focusId: string | null;
  docsOpen: boolean;
  /** `?demo=1`: skip the "Open the demo" click so a shared link opens on the graph. */
  demo: boolean;
  /** `?guide=off`: never show the first-run guide, for screenshots. */
  guideOff: boolean;
  lens: ActiveLens;
  /**
   * `?at=`: the second of the observation the map is scrubbed to, in UTC, or
   * null for now. A timestamp and not a snapshot id, so a link works on
   * another machine holding the same ledger. Optional, so a state written
   * before the timeline existed still describes a view.
   */
  at?: string | null;
  /** `?collapse=1`: keep only the selected node's neighbourhood on the map. */
  collapse: boolean;
  /** `?depth=`: hops from the node, 1 to 3. */
  depth: FocusDepth;
  /** `?dir=`: `needs`, `both` or `enables`. */
  dir: FocusDirection;
  /**
   * `?tour=`: run the demo's tour from this step, seen before or not. Read
   * once and never written back, so the address bar a reader shares is the
   * view and not the tour.
   */
  tour?: TourStep | null;
}

/**
 * A timestamp as the one second it names, `2026-09-26T10:00:00Z`, or null when
 * it names none. The ledger writes `2026-09-26 10:00:00`, a link may carry
 * either form, and a date that does not exist is not rolled into one that
 * does: an unknown value is how a link falls back to now.
 */
export function readSecond(value: string | null | undefined): string | null {
  const m = value?.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})Z?$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return `${new Date(time).toISOString().slice(0, 19)}Z` === iso ? iso : null;
}

const oneOf = <T extends string>(allowed: readonly T[], value: string | null, fallback: T): T =>
  value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

/** A depth from the address bar: one of the three, and anything else is the default. */
const depthOf = (value: string | null): FocusDepth => {
  const n = Number(value);
  return (FOCUS_DEPTHS as readonly number[]).includes(n) ? (n as FocusDepth) : DEFAULT_FOCUS_DEPTH;
};

export function readLinkState(search: string): LinkState {
  const params = new URLSearchParams(search);
  const stated = params.get('view');
  const demo = params.get('demo') === '1';
  return {
    // ?demo=1 is the link the README leads with and the one the hero image is
    // a picture of: the map, nine eras. A local visit opens on the machine's
    // own setup. An explicit view wins over both.
    view: oneOf(VIEWS, stated, demo ? 'tree' : 'config'),
    viewStated: (VIEWS as readonly string[]).includes(stated ?? ''),
    focusId: params.get('focus') || null,
    docsOpen: params.get('docs') === 'open',
    demo,
    guideOff: params.get('guide') === 'off',
    lens: oneOf(LENSES, params.get('lens'), 'default'),
    at: readSecond(params.get('at')),
    collapse: params.get('collapse') === '1',
    depth: depthOf(params.get('depth')),
    dir: oneOf(FOCUS_DIRECTIONS, params.get('dir'), DEFAULT_FOCUS_DIRECTION),
    tour: (TOUR_STEPS as readonly string[]).includes(params.get('tour') ?? '')
      ? (params.get('tour') as TourStep)
      : null,
  };
}

/**
 * What a link asks of the map once the graph has been read: the node to
 * select, and whether to collapse to it. A collapse is to that node's
 * neighbourhood, so it comes with a node the graph holds or not at all:
 * `?collapse=1` alone, or naming a node this graph lacks, used to wait in the
 * store and in the address bar, and the first node anyone clicked collapsed
 * the map at once.
 */
export function linkFocus(
  link: Pick<LinkState, 'focusId' | 'collapse'>,
  items: readonly { id: string }[]
): { id: string; collapse: boolean } | null {
  const id = link.focusId;
  return id && items.some(i => i.id === id) ? { id, collapse: link.collapse } : null;
}

/**
 * What a visit to the hosted site with no query string opens on.
 *
 * The published site has no engine behind it, so a bare visit used to land on
 * a welcome page whose job was to offer the demo, and the demo was one click
 * further. Every visitor to that page was there for the demo; the page was a
 * door in front of an open door. A hosted visit now is the demo, on the map,
 * which is where the tour runs. A link that states a view still wins, and a
 * local visit is left alone: there the empty state is a real answer about a
 * machine that has not been seeded.
 */
export function hostedLanding(link: LinkState, hosted: boolean): LinkState {
  if (!hosted || link.demo) return link;
  return { ...link, demo: true, view: link.viewStated ? link.view : 'tree' };
}

/**
 * Where a visit lands. The link decides when it names a view. A narrow
 * screen that was not told opens on My Setup: at phone width the map is
 * texture and the list is not, and the map stays one tap away. The exception
 * is a first visit to the demo, where the tour narrates the map: a cascade
 * with a sentence under it reads on a phone, and it is the whole pitch.
 */
export function initialView(link: LinkState, narrow: boolean, touring = false): View {
  if (link.viewStated) return link.view;
  if (touring) return 'tree';
  return narrow && link.view === 'tree' ? 'config' : link.view;
}

/**
 * What `writeLinkState` needs to know. The guide and the stated-ness are
 * read-side facts. The collapse fields are optional: a caller that never
 * collapses has nothing to say about them, and a link without them is today's map.
 */
export type ShareState = Omit<
  LinkState,
  'guideOff' | 'viewStated' | 'collapse' | 'depth' | 'dir' | 'tour'
> &
  Partial<Pick<LinkState, 'collapse' | 'depth' | 'dir'>>;

/** Where an address is written: the page's location and history, or a stand-in for them. */
export interface AddressBar {
  location: { search: string; hash: string };
  history: { replaceState: (data: unknown, unused: string, url: string) => void };
}

/**
 * Put `search` in the address bar, if it is not there already. Safari throws
 * once a page writes history a hundred times in thirty seconds, and scrubbing
 * a long ledger writes once per tick, so a write the browser refuses is
 * skipped: the next change writes the address again.
 */
export function writeAddress(bar: AddressBar, search: string): void {
  if (bar.location.search === search) return;
  try {
    bar.history.replaceState({}, '', search + bar.location.hash);
  } catch {
    /* the address bar catches up on the next change */
  }
}

/**
 * The query string for a view, defaults omitted.
 *
 * A link that carries every parameter at its default value is unreadable and
 * says nothing, so only what differs is written. `view` is the exception: it is
 * always stated, because its default depends on `demo` and on the screen, and
 * a reader should not have to know either rule to predict where a link lands.
 */
export function writeLinkState(state: ShareState): string {
  const params = new URLSearchParams();
  params.set('view', state.view);
  if (state.demo) params.set('demo', '1');
  if (state.focusId) params.set('focus', state.focusId);
  if (state.docsOpen) params.set('docs', 'open');
  if (state.lens !== 'default') params.set('lens', state.lens);
  if (state.at) params.set('at', state.at);
  if (state.collapse) params.set('collapse', '1');
  if (state.depth !== undefined && state.depth !== DEFAULT_FOCUS_DEPTH) {
    params.set('depth', String(state.depth));
  }
  if (state.dir !== undefined && state.dir !== DEFAULT_FOCUS_DIRECTION)
    params.set('dir', state.dir);
  return '?' + params.toString();
}
