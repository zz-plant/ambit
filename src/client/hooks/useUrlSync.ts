import { useEffect } from 'react';
import { type ShareState, writeAddress, writeLinkState } from '../linkState';

/**
 * Keeps the address bar equal to what is on screen.
 *
 * Every piece of state a link can carry was readable from a URL and writable
 * from nowhere: you could be sent a link to a lens or a focused node, and never
 * produce one. `replaceState` and not `pushState` because these are not
 * navigations — Back should leave the app, not step through eleven lens
 * changes — and the URL is read only at mount, so rewriting it never re-enters
 * the app.
 */
export function useUrlSync(state: ShareState) {
  const search = writeLinkState(state);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    writeAddress(window, search);
  }, [search]);
  return search;
}
