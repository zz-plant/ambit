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
import {
  linkFocus,
  readLinkState,
  type ShareState,
  writeAddress,
  writeLinkState,
} from './linkState';

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

// ── Collapsing the map to a node's neighbourhood ─────────────────────────────

test('a collapse survives the round trip, with its depth and its direction', () => {
  const state = {
    focusId: 'combo:shell-execution',
    collapse: true,
    depth: 3,
    dir: 'needs',
  } as const;
  expect(roundTrip(state)).toMatchObject(state);
  expect(roundTrip({ ...state, depth: 1, dir: 'enables' })).toMatchObject({
    collapse: true,
    depth: 1,
    dir: 'enables',
  });
});

test('a link carries a collapse only as far as it differs from the default', () => {
  expect(writeLinkState({ ...base, collapse: true })).toBe('?view=tree&collapse=1');
  // Two hops, both ways, is what a collapse means with nothing said.
  expect(writeLinkState({ ...base, collapse: true, depth: 2, dir: 'both' })).toBe(
    '?view=tree&collapse=1'
  );
  expect(writeLinkState({ ...base, collapse: true, depth: 3, dir: 'enables' })).toBe(
    '?view=tree&collapse=1&depth=3&dir=enables'
  );
  // Off is not written, and a caller that never collapses writes what it always did.
  expect(writeLinkState({ ...base, collapse: false })).toBe('?view=tree');
  expect(writeLinkState(base)).toBe('?view=tree');
});

test('a link without the collapse keys opens the map as it always did', () => {
  for (const search of ['', '?view=tree', '?view=tree&focus=mcp:git&lens=attention']) {
    expect(readLinkState(search)).toMatchObject({ collapse: false, depth: 2, dir: 'both' });
  }
  // `focus` is the selected node and never implies a collapse: an existing link is unchanged.
  expect(readLinkState('?focus=combo:shell-execution')).toMatchObject({
    focusId: 'combo:shell-execution',
    collapse: false,
  });
  expect(writeLinkState({ ...base, focusId: 'combo:shell-execution' })).toBe(
    '?view=tree&focus=combo%3Ashell-execution'
  );
});

test('a link with the collapse keys opens the same view, and what cannot be read is the default', () => {
  expect(readLinkState('?collapse=1&depth=1&dir=enables')).toMatchObject({
    collapse: true,
    depth: 1,
    dir: 'enables',
  });
  // Depth is one of three hops, and a direction is one of three words.
  for (const depth of ['0', '4', '-1', 'two', '', '1.5']) {
    expect(readLinkState(`?depth=${depth}`).depth).toBe(2);
  }
  expect(readLinkState('?dir=sideways').dir).toBe('both');
  expect(readLinkState('?dir=').dir).toBe('both');
  // Only 1 turns a collapse on.
  for (const flag of ['0', 'yes', 'true', '']) {
    expect(readLinkState(`?collapse=${flag}`).collapse).toBe(false);
  }
});

test('a collapse comes with a node the graph holds, or not at all', () => {
  const graph = [{ id: 'combo:shell-execution' }, { id: 'combo:model-routing' }];
  const read = (search: string) => linkFocus(readLinkState(search), graph);

  expect(read('?view=tree&focus=combo:shell-execution&collapse=1')).toEqual({
    id: 'combo:shell-execution',
    collapse: true,
  });
  expect(read('?view=tree&focus=combo:shell-execution')).toEqual({
    id: 'combo:shell-execution',
    collapse: false,
  });
  // Nothing named, or a node this graph does not hold: nothing to select, and
  // no collapse left waiting for the next node anyone clicks.
  expect(read('?view=tree&collapse=1')).toBeNull();
  expect(read('?view=tree&focus=combo:nope&collapse=1')).toBeNull();
  // Before the graph is read there is nothing to find it in.
  expect(linkFocus(readLinkState('?focus=combo:shell-execution&collapse=1'), [])).toBeNull();
});

test('a history write the browser refuses is skipped, and the page goes on', () => {
  // Safari throws once a page writes history a hundred times in thirty
  // seconds, and scrubbing a long ledger writes once per tick: the throw came
  // out of an effect, and could take the page down with it.
  const written: string[] = [];
  const bar = (refuse: boolean) => ({
    location: { search: '?view=tree', hash: '#top' },
    history: {
      replaceState: (_data: unknown, _unused: string, url: string) => {
        if (refuse) throw new Error('SecurityError: too many calls to the History API');
        written.push(url);
      },
    },
  });
  expect(() => writeAddress(bar(true), '?view=tree&at=2026-09-21T09%3A00%3A00Z')).not.toThrow();
  writeAddress(bar(false), '?view=loop');
  // What is already there is not written again.
  writeAddress(bar(false), '?view=tree');
  expect(written).toEqual(['?view=loop#top']);
});
