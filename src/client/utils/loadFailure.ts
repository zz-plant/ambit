/**
 * Whether an error is a view's code failing to arrive, as against the view
 * failing once it had.
 *
 * A deploy replaces the hashed files an open page was built from, and the
 * request for one that is gone rejects with the browser's own words: Chrome
 * says it failed to fetch a dynamically imported module, Firefox that there
 * was an error loading one, Safari that importing a module script failed, and
 * Vite that it was unable to preload a file. Anything else thrown while a
 * view draws is a bug in the view, and telling the person to reload onto a
 * newer build sends them round a loop that ends where it started.
 */
const MISSING_FILE =
  /dynamically imported module|importing a module script failed|unable to preload/i;

export function isMissingFile(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ChunkLoadError' || MISSING_FILE.test(error.message);
}
