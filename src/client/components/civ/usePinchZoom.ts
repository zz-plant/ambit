/**
 * Every way a zoom reaches the map, each anchored where it was asked for.
 *
 * Driven by D3 Zoom's unified affine transform model:
 *   Chrome / Firefox trackpad pinch (wheel with Ctrl), mouse wheel with Ctrl/Cmd,
 *   and multi-touch pinch gestures are normalized and anchored invariantly.
 *
 * The zoom level is committed synchronously with flushSync and scrollLeft/scrollTop
 * updated, preserving the exact anchor point under pointer or fingers without
 * edge drift.
 */
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { zoom as d3Zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom';
import { select } from 'd3-selection';
import { clampZoom, type Point, wheelFactor, ZOOM_MAX, ZOOM_MIN } from './viewport';

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
  const drawn = useRef(zoom);
  const handZoom = useRef<number | null>(null);

  useLayoutEffect(() => {
    drawn.current = zoom;
  }, [zoom]);

  /** Synchronize D3's internal transform with the scroller's DOM scroll state. */
  const syncTransform = useCallback(() => {
    const host = surface.current;
    const el = scroller.current;
    if (!host || !el) return;
    const current =
      (select(host).property('__zoom') as ReturnType<typeof zoomIdentity.scale>) || zoomIdentity;
    if (
      current.k !== drawn.current ||
      current.x !== -el.scrollLeft ||
      current.y !== -el.scrollTop
    ) {
      select(host).property(
        '__zoom',
        zoomIdentity.translate(-el.scrollLeft, -el.scrollTop).scale(drawn.current)
      );
    }
  }, [surface, scroller]);

  const zoomTo = useCallback(
    (to: number | ((zoom: number) => number), at?: Point) => {
      const host = surface.current;
      const el = scroller.current;
      if (!host || !el) return;
      syncTransform();

      const nextZoom = clampZoom(typeof to === 'function' ? to(drawn.current) : to);
      const anchor = at ?? middle(el);

      const currentZoom = drawn.current;
      const currentX = -el.scrollLeft;
      const currentY = -el.scrollTop;

      const factor = nextZoom / currentZoom;
      const newX = anchor.x - (anchor.x - currentX) * factor;
      const newY = anchor.y - (anchor.y - currentY) * factor;

      handZoom.current = nextZoom;
      flushSync(() => setZoom(nextZoom));
      drawn.current = nextZoom;

      el.scrollLeft = -newX;
      el.scrollTop = -newY;

      select(host).property('__zoom', zoomIdentity.translate(newX, newY).scale(nextZoom));
    },
    [surface, scroller, setZoom, syncTransform]
  );

  useEffect(() => {
    const host = surface.current;
    const el = scroller.current;
    if (!host || !el) return;

    select(host).property(
      '__zoom',
      zoomIdentity.translate(-el.scrollLeft, -el.scrollTop).scale(drawn.current)
    );

    const zoomBehavior = d3Zoom<HTMLElement, unknown>()
      .scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .filter((event: UIEvent) => {
        if (event.type === 'wheel') {
          const we = event as WheelEvent;
          return we.ctrlKey || we.metaKey;
        }
        if ((event.target as HTMLElement)?.closest?.('button, [role="button"], a, input, select')) {
          return false;
        }
        if ('touches' in event) {
          return (event as TouchEvent).touches.length >= 2;
        }
        return false;
      })
      .wheelDelta((event: WheelEvent) => {
        const factor = wheelFactor(event.deltaY, event.deltaMode, el.clientHeight);
        return Math.log2(factor);
      })
      .on('start', () => {
        syncTransform();
      })
      .on('zoom', (event: D3ZoomEvent<HTMLElement, unknown>) => {
        const { k, x, y } = event.transform;
        if (k !== drawn.current) {
          handZoom.current = k;
          flushSync(() => setZoom(k));
          drawn.current = k;
        }
        el.scrollLeft = -x;
        el.scrollTop = -y;
      });

    const sel = select(host);
    sel.call(zoomBehavior);

    return () => {
      sel.on('.zoom', null);
    };
  }, [surface, scroller, setZoom, syncTransform]);

  return { zoomTo, handZoom };
}
