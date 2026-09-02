/**
 * Which view `?demo=1` opens on.
 *
 * That link is the first one in the README and the one the social preview
 * points at, and the hero GIF beside it is a picture of the tech tree: seven
 * era columns. The link landed on "My Setup" — a flat list of twenty-five
 * config entries — so the front door showed something other than what brought
 * people to it, and the tree was one unmarked click away.
 */
import { expect, test } from 'vitest';
import { readLinkState } from './linkState';

/** The rule App.tsx applies when it decides the initial source. */
const initialSource = (search: string) => readLinkState(search).source;

test('the demo link opens the view its own hero image shows', () => {
  expect(initialSource('?demo=1')).toBe('tree');
});

test('an explicit view still wins, so shared links keep pointing where they did', () => {
  expect(initialSource('?demo=1&view=config')).toBe('config');
  expect(initialSource('?view=tree')).toBe('tree');
  expect(initialSource('?view=config')).toBe('config');
});

test('a normal local visit is unchanged — your own setup is the default', () => {
  expect(initialSource('')).toBe('config');
  expect(initialSource('?focus=mcp:git')).toBe('config');
});
