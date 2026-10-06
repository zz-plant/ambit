/**
 * Every way a zoom reaches the map, each anchored where it was asked for.
 *
 * A pinch arrives three ways, one per family of browser: Chrome and Firefox
 * send a trackpad pinch as wheel events with Ctrl held, Safari sends gesture
 * events, and a touch screen sends two fingers. A mouse wheel with Ctrl or
 * Cmd held arrives the first way too. The keys and the zoom buttons ask
 * through `zoomTo`, about the middle of the canvas a panel leaves showing.
 *
 * Each of them used to miss. React listens for wheel events passively, so
 * Ctrl and the wheel zoomed the map and the browser's page with it; Safari's
 * pinch and two fingers on a phone zoomed only the page; and every zoom grew
 * the scene from its top left corner, so what was under the pointer slid away.
 *
 * Several events can arrive between two frames. They compose on the view not
 * yet drawn, and the frame draws the last one: the zoom committed with
 * `flushSync` and the scroll set straight after, so no frame shows the new
 * zoom at the old scroll position.
 *
 * A pinch also composes across frames, on the view it is heading for and not
 * the one drawn. The two differ at an edge, where the browser holds the
 * scroll short of where the anchor needs it. Composed on the held scroll, a
 * pinch that passed an edge lost its anchor for good: on a phone the map
 * slid by a fifth of a column. Composed on the target, the point under the
 * fingers comes back under them once the zoom makes room for it. A scroll
 * from anywhere else, or a pause, ends that and the next event starts from
 * what is on screen.
 */
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { readGeometry } from './Minimap';
import { clampZoom, type Point, wheelFactor, zoomAbout } from './viewport';

interface View {
  zoom: number;
  left: number;
  top: number;
}

/** How long a pause ends a gesture, in milliseconds, for a wheel that sends no end. */
const GESTURE_GAP = 300;

/** Safari's pinch, which no other engine sends and the DOM's types leave out. */
interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

/** A point of the page, in pixels from the scroller's top left corner. */
function within(el: HTMLElement, x: number, y: number): Point {
  const box = el.getBoundingClientRect();
  return { x: x - box.left, y: y - box.top };
}

/** Two fingers: where between them the pinch is, and how far apart they are. */
function pair(el: HTMLElement, touches: TouchList): { mid: Point; spread: number } {
  const a = touches[0];
  const b = touches[1];
  return {
    mid: within(el, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2),
    spread: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
  };
}

/** The middle of the part of the scroller no panel covers. */
function middle(el: HTMLElement): Point {
  const box = getComputedStyle(el);
  const left = Number.parseFloat(box.paddingLeft) || 0;
  const right = Number.parseFloat(box.paddingRight) || 0;
  return { x: (left + el.clientWidth - right) / 2, y: el.clientHeight / 2 };
}

export function usePinchZoom({
  surface,
  scroller,
  zoom,
  setZoom,
}: {
  /** Where a pinch is listened for: the canvas and the controls laid over it. */
  surface: RefObject<HTMLElement | null>;
  /** What scrolls, and what a point is measured from. */
  scroller: RefObject<HTMLElement | null>;
  zoom: number;
  setZoom: (zoom: number) => void;
}): {
  /** Zoom to a level, or by a step from the current one, about a point or the middle. */
  zoomTo: (to: number | ((zoom: number) => number), at?: Point) => void;
  /**
   * The zoom a person last set by hand. The map centres a selection again
   * when something else zooms; a zoom of theirs stays where they pointed.
   */
  handZoom: RefObject<number | null>;
} {
  // The zoom on screen, the view asked for and not yet drawn, and its frame.
  const drawn = useRef(zoom);
  const pending = useRef<View | null>(null);
  const frame = useRef(0);
  const handZoom = useRef<number | null>(null);
  // The view a gesture is heading for, which can lie past an end of the
  // scroll, and when it last moved; and the scroll the browser held after
  // the last draw, so a scroll since then is noticed.
  const intent = useRef<{ view: View; at: number } | null>(null);
  const held = useRef<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    drawn.current = zoom;
  }, [zoom]);

  const draw = useCallback(() => {
    frame.current = 0;
    const el = scroller.current;
    const view = pending.current;
    pending.current = null;
    if (!el || !view) return;
    if (view.zoom !== drawn.current) {
      handZoom.current = view.zoom;
      flushSync(() => setZoom(view.zoom));
      drawn.current = view.zoom;
    }
    el.scrollLeft = view.left;
    el.scrollTop = view.top;
    held.current = { left: el.scrollLeft, top: el.scrollTop };
  }, [scroller, setZoom]);

  /**
   * One event's zoom, from `from` to `at`. A pinch carries its target from
   * one event to the next; a pan and a button start from what is on screen,
   * as a native scroll stops dead at the edge.
   */
  const step = useCallback(
    (to: (zoom: number) => number, from: Point, at: Point = from, carry = true) => {
      const el = scroller.current;
      if (!el) return;
      const now = performance.now();
      const last = intent.current;
      const still =
        held.current !== null &&
        Math.abs(el.scrollLeft - held.current.left) < 1 &&
        Math.abs(el.scrollTop - held.current.top) < 1;
      const base =
        pending.current ??
        (carry && last && now - last.at < GESTURE_GAP && last.view.zoom === drawn.current && still
          ? last.view
          : { zoom: drawn.current, left: el.scrollLeft, top: el.scrollTop });
      const g = { ...readGeometry(el, base.zoom), scrollLeft: base.left, scrollTop: base.top };
      const next = zoomAbout(g, to(base.zoom), from, at);
      pending.current = next;
      intent.current = carry ? { view: next, at: now } : null;
      if (!frame.current) frame.current = requestAnimationFrame(draw);
    },
    [scroller, draw]
  );

  const zoomTo = useCallback(
    (to: number | ((zoom: number) => number), at?: Point) => {
      const el = scroller.current;
      if (!el) return;
      const target = (z: number) => clampZoom(typeof to === 'function' ? to(z) : to);
      step(target, at ?? middle(el), undefined, false);
    },
    [scroller, step]
  );

  useEffect(() => {
    const host = surface.current;
    const el = scroller.current;
    if (!host || !el) return;

    // Safari's pinch, between its start and end. A wheel event inside one is
    // the same pinch again.
    let gesture: number | null = null;
    // How many fingers are down. On a phone Safari sends a gesture alongside
    // the touches, and the touches are the ones to follow.
    let fingers = 0;
    // The two fingers of a pinch as last seen, and the one left on the glass
    // when the other lifts, which pans: the browser stopped scrolling for
    // this touch when the pinch took it, so without this that finger would
    // move nothing.
    let pinch: { mid: Point; spread: number } | null = null;
    let lone: Point | null = null;

    const onWheel = (e: WheelEvent) => {
      // A wheel with no key held scrolls, and the browser does that itself.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (gesture !== null) return;
      const factor = wheelFactor(e.deltaY, e.deltaMode, el.clientHeight);
      step(z => z * factor, within(el, e.clientX, e.clientY));
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      if (fingers > 0) return;
      gesture = (e as GestureEvent).scale;
      intent.current = null;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (gesture === null || fingers > 0) return;
      const g = e as GestureEvent;
      const factor = g.scale / gesture;
      gesture = g.scale;
      step(z => z * factor, within(el, g.clientX, g.clientY));
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gesture = null;
    };

    const onTouches = (e: TouchEvent) => {
      fingers = e.touches.length;
      if (fingers === 2) {
        // A new pair is a new pinch, anchored on what is under it now.
        if (!pinch) intent.current = null;
        pinch = pair(el, e.touches);
        lone = null;
      } else {
        lone =
          pinch && fingers === 1 ? within(el, e.touches[0].clientX, e.touches[0].clientY) : null;
        pinch = null;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      // Once the browser is scrolling, the move is its own and cannot be
      // taken back; zooming under it as well would fight it for the scroll.
      if (!e.cancelable) {
        pinch = null;
        lone = null;
        return;
      }
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        const now = pair(el, e.touches);
        const factor = pinch.spread > 0 ? now.spread / pinch.spread : 1;
        step(z => z * factor, pinch.mid, now.mid);
        pinch = now;
      } else if (lone && e.touches.length === 1) {
        e.preventDefault();
        const now = within(el, e.touches[0].clientX, e.touches[0].clientY);
        step(z => z, lone, now, false);
        lone = now;
      }
    };

    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('gesturestart', onGestureStart);
    host.addEventListener('gesturechange', onGestureChange);
    host.addEventListener('gestureend', onGestureEnd);
    host.addEventListener('touchstart', onTouches, { passive: true });
    host.addEventListener('touchmove', onTouchMove, { passive: false });
    host.addEventListener('touchend', onTouches, { passive: true });
    host.addEventListener('touchcancel', onTouches, { passive: true });
    return () => {
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('gesturestart', onGestureStart);
      host.removeEventListener('gesturechange', onGestureChange);
      host.removeEventListener('gestureend', onGestureEnd);
      host.removeEventListener('touchstart', onTouches);
      host.removeEventListener('touchmove', onTouchMove);
      host.removeEventListener('touchend', onTouches);
      host.removeEventListener('touchcancel', onTouches);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      pending.current = null;
    };
  }, [surface, scroller, step]);

  return { zoomTo, handZoom };
}
