import { expect, test } from 'vitest';
import { isMissingFile } from './loadFailure';

test('a file that did not arrive is told apart from a view that threw', () => {
  // Each browser's words for a dynamic import that failed, and Vite's.
  for (const message of [
    'Failed to fetch dynamically imported module: https://x/assets/CivTree-a1.js',
    'error loading dynamically imported module: https://x/assets/CivTree-a1.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/index-a1.css',
  ])
    expect([message, isMissingFile(new TypeError(message))]).toEqual([message, true]);
  const chunk = new Error('Loading chunk 3 failed');
  chunk.name = 'ChunkLoadError';
  expect(isMissingFile(chunk)).toBe(true);

  // A bug in the view is not a stale build.
  expect(isMissingFile(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(
    false
  );
  expect(isMissingFile(new Error('Maximum update depth exceeded'))).toBe(false);
  expect(isMissingFile('a thrown string')).toBe(false);
  expect(isMissingFile(null)).toBe(false);
});
