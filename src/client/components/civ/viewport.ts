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
 * Whether the whole scene is on screen. The minimap says where you are on a
 * map too big to see at once, so when this holds there is nothing to say and
 * it is not drawn. A unit of slack absorbs the rounding of the scroll extent.
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
  const view = viewportRect(g);
  if (!(g.zoom > 0) || fitsScene(view, scene)) return null;
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
