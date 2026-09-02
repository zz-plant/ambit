/**
 * What a URL asks the app to open on.
 *
 * `?view=tree`, `?docs=open`, `?focus=<id>` and `?demo=1` make a particular
 * state linkable — for sharing an angle, and for capturing documentation
 * screenshots reproducibly. This is read once, when the app mounts; the
 * toggles own every later change. Pure, so the rule can be tested without a
 * window.
 */

export type Source = 'config' | 'tree';
export type View = 'graph' | 'loop';

export interface LinkState {
  source: Source;
  view: View;
  focusId: string | null;
  docsOpen: boolean;
  /** `?demo=1`: skip the "Open the demo" click so a shared link opens on the graph. */
  demo: boolean;
  /** `?guide=off`: never show the first-run guide, for screenshots. */
  guideOff: boolean;
}

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
  };
}
