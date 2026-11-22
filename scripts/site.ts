/**
 * Where the published site lives: the origin a crawler or a link card sees, and
 * the path prefix under it.
 *
 * Both default to GitHub Pages, which serves the demo under /ambit/. A build
 * for a host that serves the root sets AMBIT_SITE_BASE=/ and AMBIT_SITE_ORIGIN
 * to that host. The page, the docs, the sitemap and the absolute links inside
 * them all read these two, so no build can name a host it is not on.
 */

const DEFAULT_ORIGIN = 'https://zz-plant.github.io';
const DEFAULT_BASE = '/ambit/';

/** A prefix with one leading and one trailing slash, which every link built from it assumes. */
function prefix(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return DEFAULT_BASE;
  if (value === '/') return '/';
  return `/${value.replace(/^\/+|\/+$/g, '')}/`;
}

export { DEFAULT_BASE, DEFAULT_ORIGIN };

/** The host, without a trailing slash: `https://example.com`. */
export const ORIGIN = (process.env.AMBIT_SITE_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, '');

/** The path the site is served under: `/` or `/ambit/`. */
export const BASE = prefix(process.env.AMBIT_SITE_BASE);
