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
import { readLinkState } from './linkState';

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
