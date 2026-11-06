/**
 * What a component test renders against: the store, and a browser. The suite
 * has no DOM, so a test sets up both by hand.
 */
import { afterAll, beforeAll } from 'vitest';
import { useAmbitStore } from '../store/ambitStore';

/**
 * Put the store in a state, for a server render. `renderToStaticMarkup` reads
 * the server snapshot, zustand's initial state object, so a plain `setState` is
 * invisible to it, and both halves are set here.
 */
export function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

/**
 * A window and localStorage for this test file, put back when it ends. The
 * first-run card reads as seen, and `search` is the address the page opens on.
 */
export function stubBrowser(search: string) {
  const { window: originalWindow, localStorage: originalLocalStorage } = globalThis;
  beforeAll(() => {
    const mediaQuery = { matches: false, addEventListener() {}, removeEventListener() {} };
    Object.assign(globalThis, {
      localStorage: { getItem: () => '1', setItem() {} },
      window: {
        location: { search },
        matchMedia: () => mediaQuery,
        addEventListener() {},
        removeEventListener() {},
        innerWidth: 1440,
      },
    });
  });
  afterAll(() => {
    Object.assign(globalThis, { window: originalWindow, localStorage: originalLocalStorage });
  });
}
