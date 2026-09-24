/**
 * What a URL says about the view, in both directions.
 *
 * Every piece of view state that is worth sending to someone else lives here:
 * which view, which node, which lens. `readLinkState` is applied once when the
 * app mounts; `writeLinkState` runs on every change, so the address bar is
 * always a link to what is on screen and the Share button is a copy of it.
 * Pure, so the rule can be tested without a window.
 */

/**
 * The three views. `tree` is the map, `config` is My Setup, `loop` is Time &
 * cost. The words are the URL's, kept so that links written before the setup
 * view stopped being a second map still open where they did.
 */
export const VIEWS = ['tree', 'config', 'loop'] as const;
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
}

const oneOf = <T extends string>(allowed: readonly T[], value: string | null, fallback: T): T =>
  value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

export function readLinkState(search: string): LinkState {
  const params = new URLSearchParams(search);
  const stated = params.get('view');
  const demo = params.get('demo') === '1';
  return {
    // ?demo=1 is the link the README leads with and the one the hero image is
    // a picture of: the map, seven eras. A local visit opens on the machine's
    // own setup. An explicit view wins over both.
    view: oneOf(VIEWS, stated, demo ? 'tree' : 'config'),
    viewStated: (VIEWS as readonly string[]).includes(stated ?? ''),
    focusId: params.get('focus') || null,
    docsOpen: params.get('docs') === 'open',
    demo,
    guideOff: params.get('guide') === 'off',
    lens: oneOf(LENSES, params.get('lens'), 'default'),
  };
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

/** What `writeLinkState` needs to know. The guide and the stated-ness are read-side facts. */
export type ShareState = Omit<LinkState, 'guideOff' | 'viewStated'>;

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
  return '?' + params.toString();
}
