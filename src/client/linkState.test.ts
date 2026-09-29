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

test('the trail is a view a link can open', () => {
  expect(writeLinkState({ ...base, view: 'audit' })).toBe('?view=audit');
  expect(roundTrip({ view: 'audit' }).view).toBe('audit');
  expect(readLinkState('?view=audit').viewStated).toBe(true);
});

test('a link says whether it named a view, so a narrow screen can choose', () => {
  expect(readLinkState('?view=tree').viewStated).toBe(true);
  expect(readLinkState('?demo=1').viewStated).toBe(false);
  expect(readLinkState('?view=sideways').viewStated).toBe(false);
});

test('the playhead travels as the second it names, and now is the default', () => {
  const at = '2026-09-26T10:00:00Z';
  expect(writeLinkState({ ...base, at })).toBe('?view=tree&at=2026-09-26T10%3A00%3A00Z');
  expect(roundTrip({ at }).at).toBe(at);
  // Now is written as nothing, so a link to the present stays as it was.
  expect(writeLinkState({ ...base, at: null })).toBe('?view=tree');
  expect(readLinkState('?view=tree').at).toBeNull();
});

test('a playhead is read as a second, and anything that names none is now', () => {
  // The ledger's own form, with its space as a link encodes one.
  expect(readLinkState('?at=2026-09-26+10:00:00').at).toBe('2026-09-26T10:00:00Z');
  expect(readLinkState('?at=2026-09-26T10:00:00').at).toBe('2026-09-26T10:00:00Z');
  // A snapshot id is not a time: ids differ between machines.
  expect(readLinkState('?at=42').at).toBeNull();
  expect(readLinkState('?at=last-tuesday').at).toBeNull();
  // A date that does not exist is not rolled into one that does.
  expect(readLinkState('?at=2026-02-30T10:00:00Z').at).toBeNull();
});

test('a lens nothing can render is not accepted from the address bar', () => {
  // `credentials` was a lens that coloured nodes by a substring of their id;
  // a link that still names it opens on the standard map.
  expect(readLinkState('?lens=credentials').lens).toBe('default');
  expect(readLinkState('?lens=infrared').lens).toBe('default');
  expect(readLinkState('?lens=attention').lens).toBe('attention');
});
