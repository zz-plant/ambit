/**
 * Which view `?demo=1` opens on.
 *
 * That link is the first one in the README and the one the social preview
 * points at, and the hero GIF beside it is a picture of the map: seven era
 * columns. The link landed on "My Setup", a flat list of twenty-five config
 * entries, so the front door showed something other than what brought people
 * to it, and the map was one unmarked click away.
 */
import { expect, test } from 'vitest';
import { hostedLanding, initialView as landingView, readLinkState } from './linkState';

/** The rule App.tsx applies when it decides the initial view. */
const initialView = (search: string) => readLinkState(search).view;

test('the demo link opens the view its own hero image shows', () => {
  expect(initialView('?demo=1')).toBe('tree');
});

test('an explicit view still wins, so shared links keep pointing where they did', () => {
  expect(initialView('?demo=1&view=config')).toBe('config');
  expect(initialView('?view=tree')).toBe('tree');
  expect(initialView('?view=config')).toBe('config');
});

test('a normal local visit is unchanged: your own setup is the default', () => {
  expect(initialView('')).toBe('config');
  expect(initialView('?focus=mcp:git')).toBe('config');
});

/** Where a visit lands once the host is known. */
const landing = (search: string, hosted: boolean) => hostedLanding(readLinkState(search), hosted);

test('a bare visit to the hosted site is the demo, on the map', () => {
  // The welcome page there existed to offer the demo, and every visitor to
  // it was there for the demo.
  expect(landing('', true)).toMatchObject({ demo: true, view: 'tree' });
});

test('a hosted link that names a view keeps it', () => {
  expect(landing('?view=loop', true)).toMatchObject({ demo: true, view: 'loop' });
});

test('a local visit is not turned into a demo', () => {
  expect(landing('', false)).toMatchObject({ demo: false, view: 'config' });
});

test('a phone opens the demo on the map when the tour will narrate it, and on the list after', () => {
  // At phone width the map alone is texture, so a narrow screen opens on My
  // Setup. The tour's cascade with its sentence under it reads on a phone.
  const link = readLinkState('?demo=1');
  expect(landingView(link, true, true)).toBe('tree');
  expect(landingView(link, true, false)).toBe('config');
  expect(landingView(readLinkState('?demo=1&view=loop'), true, true)).toBe('loop');
});
