import { useEffect, useRef } from 'react';
import { addressMode, type ShareState, writeAddress, writeLinkState } from '../linkState';

/**
 * Keeps the address bar equal to what is on screen.
 *
 * Every piece of state a link can carry was readable from a URL and writable
 * from nowhere: you could be sent a link to a lens or a focused node, and never
 * produce one. A change of view is a navigation and is pushed, so Back and
 * Forward step between where someone has been; the rest replaces, because a
 * lens or a scrub is not a place, and writes often enough that pushing each
 * one would run into the browser's rate limit while a ledger scrubs. The URL
 * is read at mount and on `popstate`, so rewriting it never re-enters the app.
 */
export function useUrlSync(state: ShareState) {
  const search = writeLinkState(state);
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const before = previous.current;
    previous.current = search;
    if (before === null) return writeAddress(window, search);
    writeAddress(window, search, addressMode(before, search));
  }, [search]);
  return search;
}
