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
  expect(initialView('?demo=1')).toBe('map');
});

test('an explicit view still wins, so shared links keep pointing where they did', () => {
  expect(initialView('?demo=1&view=setup')).toBe('setup');
  expect(initialView('?view=map')).toBe('map');
  expect(initialView('?view=setup')).toBe('setup');
  // A link written before the rename still lands where it did.
  expect(initialView('?view=tree')).toBe('map');
  expect(initialView('?demo=1&view=config')).toBe('setup');
});

test('a normal local visit is unchanged: your own setup is the default', () => {
  expect(initialView('')).toBe('setup');
  expect(initialView('?focus=mcp:git')).toBe('setup');
});

/** Where a visit lands once the host is known. */
const landing = (search: string, hosted: boolean) => hostedLanding(readLinkState(search), hosted);

test('a bare visit to the hosted site is the demo, on the map', () => {
  // The welcome page there existed to offer the demo, and every visitor to
  // it was there for the demo.
  expect(landing('', true)).toMatchObject({ demo: true, view: 'map' });
});

test('a hosted link that names a view keeps it', () => {
  expect(landing('?view=cost', true)).toMatchObject({ demo: true, view: 'cost' });
});

test('a local visit is not turned into a demo', () => {
  expect(landing('', false)).toMatchObject({ demo: false, view: 'setup' });
});

test('a phone opens the demo on the map when the tour will narrate it, and on the list after', () => {
  // At phone width the map alone is texture, so a narrow screen opens on My
  // Setup. The tour's cascade with its sentence under it reads on a phone.
  const link = readLinkState('?demo=1');
  expect(landingView(link, true, true)).toBe('map');
  expect(landingView(link, true, false)).toBe('setup');
  expect(landingView(readLinkState('?demo=1&view=cost'), true, true)).toBe('cost');
});

test('a docs page can open the tour on the step it is about', () => {
  // A visitor who searched for what breaks when a server goes down reads the
  // page on outages, and its link into the demo opens on the outage, not on
  // the tour's first card.
  expect(landing('?tour=outage', true)).toMatchObject({ demo: true, view: 'map', tour: 'outage' });
  expect(readLinkState('?demo=1&tour=yours').tour).toBe('yours');
  expect(readLinkState('?demo=1&tour=sideways').tour).toBeNull();
  expect(readLinkState('?demo=1').tour).toBeNull();
});

test('a phone follows a tour link onto the map', () => {
  // The tour narrates the map, so a link that asks for it opens there even
  // for a visitor who has seen it: App passes the link's step as touring.
  const link = readLinkState('?demo=1&tour=failing');
  expect(landingView(link, true, Boolean(link.tour))).toBe('map');
});
