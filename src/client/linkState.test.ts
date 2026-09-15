/**
 * The URL as the app's shareable state.
 *
 * Every one of these parameters could be read and none could be produced: a
 * person could be *sent* a link to a focused node under the attention lens and
 * had no way to make one, because nothing wrote the URL and no control copied
 * it. These hold the round trip, what is written is what is read back, and
 * the two rules that keep the link short and honest.
 */
import { expect, test } from 'vitest';
import { readLinkState, writeLinkState, type ShareState } from './linkState';

const base: ShareState = {
  view: 'tree',
  focusId: null,
  docsOpen: false,
  demo: false,
  lens: 'default',
};

const roundTrip = (state: Partial<ShareState>) =>
  readLinkState(writeLinkState({ ...base, ...state }));

test('every piece of shareable state survives the round trip', () => {
  const state: ShareState = {
    view: 'config',
    focusId: 'mcp:kubernetes',
    docsOpen: true,
    demo: true,
    lens: 'attention',
  };
  expect(roundTrip(state)).toMatchObject(state);
});

test('a link carries only what differs, so it stays readable', () => {
  // view is always stated: its default depends on demo and on the screen, and
  // a reader should not have to know either rule to predict where a link lands.
  expect(writeLinkState(base)).toBe('?view=tree');
  expect(writeLinkState({ ...base, lens: 'attention' })).toBe('?view=tree&lens=attention');
});

test('the three views are the three words the URL has always used', () => {
  expect(roundTrip({ view: 'loop' }).view).toBe('loop');
  expect(roundTrip({ view: 'config' }).view).toBe('config');
  expect(readLinkState('?view=sideways').view).toBe('config');
});

test('a link says whether it named a view, so a narrow screen can choose', () => {
  expect(readLinkState('?view=tree').viewStated).toBe(true);
  expect(readLinkState('?demo=1').viewStated).toBe(false);
  expect(readLinkState('?view=sideways').viewStated).toBe(false);
});

test('a lens nothing can render is not accepted from the address bar', () => {
  // `credentials` was a lens that coloured nodes by a substring of their id;
  // a link that still names it opens on the standard map.
  expect(readLinkState('?lens=credentials').lens).toBe('default');
  expect(readLinkState('?lens=infrared').lens).toBe('default');
  expect(readLinkState('?lens=attention').lens).toBe('attention');
});
