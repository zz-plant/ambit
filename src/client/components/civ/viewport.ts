/**
 * Where the visible part of the map is, in the map's own units.
 *
 * The map is an SVG scaled by `zoom` inside a scroller, so what is on screen
 * is a rectangle of the scene that depends on the scroll position, the size
 * of the scroller, the zoom, and the offsets that sit between the scroller's
 * edge and the scene: its left padding, and its top padding plus the canvas's
 * own top margin. Those are the same offsets "fit" subtracts (ZoomHud.tsx).
 * The minimap draws this rectangle, and moves it.
 *
 * All of it is a pure function of numbers the component reads off the DOM.
 * Nothing here touches `window`, which is why the tree can still be rendered
 * on the server.
 */

/** What the scroller measures, in pixels, and the zoom the scene is drawn at. */
export interface Geometry {
  scrollLeft: number;
  scrollTop: number;
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  /** Where the scene starts inside the scroller's content: left padding. */
  offsetX: number;
  /** Top padding plus the canvas's top margin. */
  offsetY: number;
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A rectangle in scene units. */
export interface Rect extends Point, Size {}

/**
 * The part of the scene the scroller shows, unclamped: it starts before the
 * scene when there is padding to scroll through, and runs past its end when
 * the scene is smaller than the scroller.
 */
export function viewportRect(g: Geometry): Rect {
  return {
    x: (g.scrollLeft - g.offsetX) / g.zoom,
    y: (g.scrollTop - g.offsetY) / g.zoom,
    width: g.clientWidth / g.zoom,
    height: g.clientHeight / g.zoom,
  };
}

/** The part of the viewport that lies on the scene, which is what the thumbnail outlines. */
export function clampToScene(view: Rect, scene: Size): Rect {
  const x = Math.max(0, view.x);
  const y = Math.max(0, view.y);
  const right = Math.min(scene.width, view.x + view.width);
  const bottom = Math.min(scene.height, view.y + view.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/**
 * Whether the whole scene is inside a viewport. The minimap says where you are
 * on a map too big to see at once, so when the scene fits the window there is
 * nothing to say and it is not drawn. A unit of slack absorbs the rounding of
 * the scroll extent.
 */
export function fitsScene(view: Rect, scene: Size, slack = 1): boolean {
  return (
    view.x <= slack &&
    view.y <= slack &&
    view.x + view.width >= scene.width - slack &&
    view.y + view.height >= scene.height - slack
  );
}

/** The thumbnail's scale and size: the scene, fitted inside a box, in its own proportions. */
export function thumbnail(
  scene: Size,
  box: Size
): { scale: number; width: number; height: number } {
  const scale = Math.min(box.width / scene.width, box.height / scene.height);
  return { scale, width: scene.width * scale, height: scene.height * scale };
}

/** The range the map zooms in, whichever way the zoom is asked for. */
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 2.5;

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/**
 * The zoom and scroll position that redraw the scene at another zoom about a
 * point of the scroller, in pixels from its top left corner. The part of the
 * scene that was under `from` lands under `to`: the same place for a wheel or
 * a button, and for two fingers their midpoint before and after a move, so a
 * pinch that drifts pans as it zooms. Zoomed at the old scroll position, the
 * scene grew from its top left corner and slid out from under the pointer.
 *
 * The scroll it returns can lie past either end, and the browser holds the
 * scroller at that end. The view a pinch is heading for is kept unclamped
 * (usePinchZoom.ts), so the point comes back under the fingers once the zoom
 * makes room for it, and clamping here would lose it at the start.
 */
export function zoomAbout(
  g: Geometry,
  zoom: number,
  from: Point,
  to: Point = from
): { zoom: number; left: number; top: number } {
  const next = Number.isFinite(zoom) ? clampZoom(zoom) : g.zoom;
  const x = (g.scrollLeft + from.x - g.offsetX) / g.zoom;
  const y = (g.scrollTop + from.y - g.offsetY) / g.zoom;
  return {
    zoom: next,
    left: g.offsetX + x * next - to.x,
    top: g.offsetY + y * next - to.y,
  };
}

/** The most one wheel event moves, in pixels: a mouse's notch zooms by about a fifth. */
const WHEEL_CAP = 20;

/**
 * What one wheel event with Ctrl held scales the zoom by. A trackpad pinch
 * arrives this way in Chrome and Firefox, as a stream of small deltas that
 * Chrome sizes so the exponential below tracks the fingers. A mouse wheel
 * arrives as a few large ones, a notch of 100 pixels or 3 lines, so a delta
 * is capped: uncapped, one notch took the zoom to a third of itself, and a fixed
 * step per event, the way this used to work, turned the dozens of events in
 * one pinch into a jump to the end of the range.
 */
export function wheelFactor(deltaY: number, deltaMode: number, pageHeight: number): number {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1);
  if (!Number.isFinite(pixels)) return 1;
  return Math.exp(-Math.max(-WHEEL_CAP, Math.min(WHEEL_CAP, pixels)) / 100);
}

/** The scroll position that puts a point of the scene at the middle of the scroller. */
export function scrollForCentre(point: Point, g: Geometry): { left: number; top: number } {
  const clamp = (v: number, room: number) => Math.min(Math.max(0, v), Math.max(0, room));
  return {
    left: clamp(g.offsetX + point.x * g.zoom - g.clientWidth / 2, g.scrollWidth - g.clientWidth),
    top: clamp(g.offsetY + point.y * g.zoom - g.clientHeight / 2, g.scrollHeight - g.clientHeight),
  };
}

/**
 * Where a press on the thumbnail holds the viewport. Pressed inside the
 * outline, the viewport keeps its place under the pointer and follows it;
 * pressed anywhere else, it jumps to be centred on the pointer, and then
 * follows.
 */
export function grabOffset(view: Rect, at: Point): Point {
  const inside =
    at.x >= view.x && at.x <= view.x + view.width && at.y >= view.y && at.y <= view.y + view.height;
  return inside
    ? { x: at.x - (view.x + view.width / 2), y: at.y - (view.y + view.height / 2) }
    : { x: 0, y: 0 };
}

/**
 * The keys that move the viewport when it has focus, the keyboard's half of
 * a drag. An arrow moves a tenth of the screen, with Shift nearly a whole
 * one; Home is the top left of the map and End the bottom right. Anything
 * else is not ours and returns nothing.
 */
export function scrollForKey(
  key: string,
  shift: boolean,
  g: Geometry
): { left: number; top: number } | null {
  const maxLeft = Math.max(0, g.scrollWidth - g.clientWidth);
  const maxTop = Math.max(0, g.scrollHeight - g.clientHeight);
  const clamp = (v: number, max: number) => Math.min(Math.max(0, v), max);
  const share = shift ? 0.9 : 0.1;
  const stepX = Math.round(g.clientWidth * share);
  const stepY = Math.round(g.clientHeight * share);
  switch (key) {
    case 'ArrowLeft':
      return { left: clamp(g.scrollLeft - stepX, maxLeft), top: g.scrollTop };
    case 'ArrowRight':
      return { left: clamp(g.scrollLeft + stepX, maxLeft), top: g.scrollTop };
    case 'ArrowUp':
      return { left: g.scrollLeft, top: clamp(g.scrollTop - stepY, maxTop) };
    case 'ArrowDown':
      return { left: g.scrollLeft, top: clamp(g.scrollTop + stepY, maxTop) };
    case 'Home':
      return { left: 0, top: 0 };
    case 'End':
      return { left: maxLeft, top: maxTop };
    default:
      return null;
  }
}

/**
 * The node nearest the middle of a rectangle of the scene: where Enter on the
 * minimap's outline puts the focus, so the part of the map it moved to is
 * the part the keyboard carries on from. Null when there is no node.
 */
export function nearestNode(view: Rect, nodes: readonly (Point & { id: string })[]): string | null {
  const cx = view.x + view.width / 2;
  const cy = view.y + view.height / 2;
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const n of nodes) {
    const d = (n.x - cx) ** 2 + (n.y - cy) ** 2;
    if (d < bestDistance) {
      best = n.id;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * Which way a node lies from the viewport, when the whole of its circle is
 * out of sight. A node half in view is in view.
 */
export function offscreen(
  view: Rect,
  point: Point,
  radius: number
): { horizontal: 'left' | 'right' | null; vertical: 'above' | 'below' | null } {
  return {
    horizontal:
      point.x + radius < view.x ? 'left' : point.x - radius > view.x + view.width ? 'right' : null,
    vertical:
      point.y + radius < view.y
        ? 'above'
        : point.y - radius > view.y + view.height
          ? 'below'
          : null,
  };
}

/**
 * Where a node is, in the words a sentence needs: "left", "above", or for a
 * corner "top right". Null when it is in view.
 */
export function offscreenLabel(view: Rect, point: Point, radius: number): string | null {
  const { horizontal, vertical } = offscreen(view, point, radius);
  if (horizontal && vertical) return `${vertical === 'above' ? 'top' : 'bottom'} ${horizontal}`;
  return horizontal ?? vertical;
}

/** What the thumbnail draws for a map: its size, the viewport outlined in it, and nothing when the map fits. */
export interface MinimapModel {
  scale: number;
  /** The thumbnail, in pixels. */
  width: number;
  height: number;
  /** The viewport's outline in the thumbnail's own pixels. */
  view: { left: number; top: number; width: number; height: number };
}

export function minimapModel(g: Geometry, scene: Size, box: Size): MinimapModel | null {
  // Whether the map fits is a question about the scene and the window, so it
  // is asked with the scroller at its origin. Asked where it was scrolled to,
  // a map that overflowed by less than the offsets above it (74px at 1440 by
  // 900) fitted at the bottom of its scroll, and the minimap vanished mid-drag
  // and dropped out of the Tab order.
  if (!(g.zoom > 0) || fitsScene(viewportRect({ ...g, scrollLeft: 0, scrollTop: 0 }), scene)) {
    return null;
  }
  const view = viewportRect(g);
  const { scale, width, height } = thumbnail(scene, box);
  const seen = clampToScene(view, scene);
  return {
    scale,
    width,
    height,
    view: {
      left: seen.x * scale,
      top: seen.y * scale,
      width: seen.width * scale,
      height: seen.height * scale,
    },
  };
}
