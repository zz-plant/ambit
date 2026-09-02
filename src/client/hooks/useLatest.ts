import { type RefObject, useEffect, useRef } from 'react';

/**
 * A ref that always holds the latest value.
 *
 * For an effect that should run once — open a stream, bind a key listener —
 * but call handlers that close over current state. Listing the handlers as
 * dependencies would re-run the effect on every render; reading them through
 * this ref keeps the effect mounted once and the behaviour current.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
