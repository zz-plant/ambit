/**
 * The URL as the app's shareable state.
 *
 * Every one of these parameters could be read and none could be produced: a
 * person could be *sent* a link to a focused node under the attention lens and
 * had no way to make one, because nothing wrote the URL and no control copied
 * it. These hold the round trip — what is written is what is read back — and
 * the two rules that keep the link short and honest.
 */
import { expect, test } from 'vitest';
import { readLinkState, writeLinkState, type ShareState } from './linkState';

const base: ShareState = {
  source: 'tree',
  view: 'graph',
  focusId: null,
  docsOpen: false,
  demo: false,
  lens: 'default',
  treeFilter: 'all',
};

const roundTrip = (state: Partial<ShareState>) =>
  readLinkState(writeLinkState({ ...base, ...state }));

test('every piece of shareable state survives the round trip', () => {
  const state: ShareState = {
    source: 'config',
    view: 'graph',
    focusId: 'mcp:kubernetes',
    docsOpen: true,
    demo: true,
    lens: 'attention',
    treeFilter: 'agent',
  };
  expect(roundTrip(state)).toMatchObject(state);
});

test('a link carries only what differs, so it stays readable', () => {
  // view is always stated: its default depends on demo, and a reader should
  // not have to know that rule to predict where a link lands.
  expect(writeLinkState(base)).toBe('?view=tree');
  expect(writeLinkState({ ...base, lens: 'credentials' })).toBe('?view=tree&lens=credentials');
});

test('the loop view is a view, not a graph source', () => {
  expect(writeLinkState({ ...base, view: 'loop' })).toBe('?view=loop');
  expect(roundTrip({ view: 'loop' }).view).toBe('loop');
});

test('a filter nothing can render is not accepted from the address bar', () => {
  // `compact` was in the accepted list and in no renderer, so it fell through
  // to "frameworks only" — a filter that hid the graph, reachable only by
  // typing it into the URL.
  expect(readLinkState('?treeFilter=compact').treeFilter).toBe('all');
  expect(readLinkState('?lens=infrared').lens).toBe('default');
  expect(readLinkState('?treeFilter=skill').treeFilter).toBe('skill');
});
