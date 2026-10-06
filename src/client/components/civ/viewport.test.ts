/**
 * Where the visible part of the map is, in the map's own units.
 *
 * The minimap draws a rectangle that has to land on the part of the scene the
 * scroller shows, at every zoom and every scroll position, and it moves the
 * scroller when that rectangle is dragged or the keyboard moves it. Each of
 * those is arithmetic on a handful of numbers, and each can be wrong by a
 * factor of the zoom in a way a screenshot at 100% would never show.
 */
import { expect, test } from 'vitest';
import { columnCentre, NODE_R, START_Y } from './layout.ts';
import {
  clampToScene,
  clampZoom,
  fitsScene,
  type Geometry,
  grabOffset,
  minimapModel,
  nearestNode,
  offscreen,
  offscreenLabel,
  type Size,
  scrollForCentre,
  scrollForKey,
  thumbnail,
  viewportRect,
  wheelFactor,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomAbout,
} from './viewport.ts';

/** A fixed scene, the demo's size when it had seven eras: six rows at most. */
const SCENE = { width: 1340, height: 760 };
const BOX = { width: 176, height: 124 };

/**
 * A scroller of a given size over the scene at a zoom, the way the DOM would
 * report it: the scene's own size grows with the zoom, and sits behind 8px of
 * left padding and 84px of top (40 of padding, 44 of the canvas's margin).
 */
function scroller(zoom: number, client: Size, scroll = { left: 0, top: 0 }): Geometry {
  const offsetX = 8;
  const offsetY = 84;
  return {
    scrollLeft: scroll.left,
    scrollTop: scroll.top,
    clientWidth: client.width,
    clientHeight: client.height,
    scrollWidth: Math.max(client.width, offsetX + SCENE.width * zoom),
    scrollHeight: Math.max(client.height, offsetY + SCENE.height * zoom),
    offsetX,
    offsetY,
    zoom,
  };
}

const SCREEN = { width: 1000, height: 600 };

test('the viewport is the scroller in scene units: pixels over the zoom, less the offsets', () => {
  // At the origin the scene starts 8px in and 84px down, so the viewport
  // starts before it, at negative units.
  expect(viewportRect(scroller(1, SCREEN))).toEqual({ x: -8, y: -84, width: 1000, height: 600 });

  // Doubling the zoom halves what fits on screen, and halves what a scrolled
  // pixel is worth.
  expect(viewportRect(scroller(2, SCREEN, { left: 408, top: 384 }))).toEqual({
    x: 200,
    y: 150,
    width: 500,
    height: 300,
  });
  expect(viewportRect(scroller(0.5, SCREEN, { left: 108, top: 134 }))).toEqual({
    x: 200,
    y: 100,
    width: 2000,
    height: 1200,
  });
});

test('the outline is the part of the viewport that lies on the scene', () => {
  expect(clampToScene({ x: -8, y: -84, width: 1000, height: 600 }, SCENE)).toEqual({
    x: 0,
    y: 0,
    width: 992,
    height: 516,
  });
  expect(clampToScene({ x: 800, y: 400, width: 1000, height: 600 }, SCENE)).toEqual({
    x: 800,
    y: 400,
    width: 540,
    height: 360,
  });
  // A viewport past the scene has nothing on it, and never a negative size.
  expect(clampToScene({ x: 2000, y: 2000, width: 100, height: 100 }, SCENE)).toMatchObject({
    width: 0,
    height: 0,
  });
});

test('the whole map fits when the viewport holds the whole scene, and not before', () => {
  expect(fitsScene(viewportRect(scroller(1, { width: 1500, height: 900 })), SCENE)).toBe(true);
  // One edge short is not a fit: 40 units of the bottom of the scene are cut off.
  expect(fitsScene(viewportRect(scroller(1, { width: 1500, height: 720 })), SCENE)).toBe(false);
  expect(fitsScene(viewportRect(scroller(1, { width: 1300, height: 900 })), SCENE)).toBe(false);
  // Rounding in the scroll extent is not a reason to draw a map of itself.
  expect(fitsScene({ x: 0, y: 0, width: SCENE.width - 0.5, height: SCENE.height }, SCENE)).toBe(
    true
  );
  expect(fitsScene({ x: 0, y: 0, width: SCENE.width - 5, height: SCENE.height }, SCENE)).toBe(
    false
  );
});

test('the thumbnail keeps the map in proportion inside its box', () => {
  const wide = thumbnail(SCENE, BOX);
  expect(wide.width).toBeCloseTo(176, 5);
  expect(wide.height).toBeCloseTo(SCENE.height * wide.scale, 5);
  expect(wide.height).toBeLessThan(BOX.height);

  // A tall map is limited by its height, and narrows.
  const tall = thumbnail({ width: 400, height: 2000 }, BOX);
  expect(tall.height).toBeCloseTo(124, 5);
  expect(tall.width).toBeCloseTo(24.8, 5);
});

test('the outline sits where the viewport is, at several zooms and scroll offsets', () => {
  const { scale } = thumbnail(SCENE, BOX);

  // Zoom 1, at the origin: the top left of the scene, clipped by its own padding.
  const origin = minimapModel(scroller(1, SCREEN), SCENE, BOX)!;
  expect(origin.view.left).toBeCloseTo(0, 5);
  expect(origin.view.top).toBeCloseTo(0, 5);
  expect(origin.view.width).toBeCloseTo(992 * scale, 5);
  expect(origin.view.height).toBeCloseTo(516 * scale, 5);

  // Zoom 2, scrolled: a quarter of the area, at (200, 150) in the scene.
  const zoomed = minimapModel(scroller(2, SCREEN, { left: 408, top: 384 }), SCENE, BOX)!;
  expect(zoomed.view.left).toBeCloseTo(200 * scale, 5);
  expect(zoomed.view.top).toBeCloseTo(150 * scale, 5);
  expect(zoomed.view.width).toBeCloseTo(500 * scale, 5);
  expect(zoomed.view.height).toBeCloseTo(300 * scale, 5);

  // Zoom 1 at the far corner: the outline ends at the thumbnail's own corner.
  const corner = minimapModel(scroller(1, SCREEN, { left: 348, top: 244 }), SCENE, BOX)!;
  expect(corner.view.left + corner.view.width).toBeCloseTo(corner.width, 5);
  expect(corner.view.top + corner.view.height).toBeCloseTo(corner.height, 5);

  // Zoom 0.5, where the screen holds more than the scene's width: full width, and a partial height.
  const far = minimapModel(scroller(0.5, { width: 1000, height: 300 }), SCENE, BOX)!;
  expect(far.view.width).toBeCloseTo(SCENE.width * scale, 5);
  expect(far.view.height).toBeLessThan(far.height);
});

test('nothing is drawn when the whole map fits', () => {
  expect(minimapModel(scroller(1, { width: 1500, height: 900 }), SCENE, BOX)).toBeNull();
  // And a zoom that is not a number draws nothing, not a rectangle of NaN.
  expect(minimapModel({ ...scroller(1, SCREEN), zoom: Number.NaN }, SCENE, BOX)).toBeNull();
});

test('whether the map fits does not depend on where it is scrolled to', () => {
  // 780 tall: the scene and its 84px of offsets need 844, so it scrolls by 64,
  // less than the offsets. At the bottom of that scroll the whole scene is in
  // view, and the minimap used to vanish there, in the middle of a drag.
  const short = { width: 1500, height: 780 };
  const bottom = 844 - short.height;
  for (const top of [0, bottom / 2, bottom]) {
    const model = minimapModel(scroller(1, short, { left: 0, top }), SCENE, BOX);
    expect(model, `scrolled ${top} down`).not.toBeNull();
  }
  // Scrolled to the bottom, the outline is the whole scene.
  const atBottom = minimapModel(scroller(1, short, { left: 0, top: bottom }), SCENE, BOX)!;
  expect(atBottom.view.height).toBeCloseTo(atBottom.height, 5);

  // The same across: a scene 30 units wider than the room it has.
  const narrow = { width: 1318, height: 900 };
  for (const left of [0, 30]) {
    expect(minimapModel(scroller(1, narrow, { left, top: 0 }), SCENE, BOX)).not.toBeNull();
  }
  // And a map that fits, fits wherever the scroller says it is.
  for (const top of [0, 40]) {
    expect(
      minimapModel(scroller(1, { width: 1500, height: 900 }, { left: 0, top }), SCENE, BOX)
    ).toBeNull();
  }
});

test('moving the viewport to a point puts that point in the middle of the screen', () => {
  const g = scroller(1, SCREEN);
  const to = scrollForCentre({ x: 670, y: 380 }, g);
  expect(to).toEqual({ left: 178, top: 164 });

  // The round trip: scroll there, and the viewport is centred on the point.
  const seen = viewportRect({ ...g, scrollLeft: to.left, scrollTop: to.top });
  expect(seen.x + seen.width / 2).toBeCloseTo(670, 5);
  expect(seen.y + seen.height / 2).toBeCloseTo(380, 5);

  // The same at zoom 2, where a scene unit is two pixels.
  const zoomed = scroller(2, SCREEN);
  const at = scrollForCentre({ x: 670, y: 380 }, zoomed);
  const view = viewportRect({ ...zoomed, scrollLeft: at.left, scrollTop: at.top });
  expect(view.x + view.width / 2).toBeCloseTo(670, 5);
  expect(view.y + view.height / 2).toBeCloseTo(380, 5);
});

test('the viewport cannot be moved past the ends of the scroll', () => {
  const g = scroller(1, SCREEN);
  expect(scrollForCentre({ x: 0, y: 0 }, g)).toEqual({ left: 0, top: 0 });
  // The most it can scroll is the content less the screen: 348 across and 244 down.
  expect(scrollForCentre({ x: 5000, y: 5000 }, g)).toEqual({ left: 348, top: 244 });
  // A scroller bigger than its content has nowhere to go.
  expect(scrollForCentre({ x: 700, y: 400 }, scroller(1, { width: 1500, height: 900 }))).toEqual({
    left: 0,
    top: 0,
  });
});

/** The point of the scene under a point of the scroller. */
function under(g: Geometry, at: { x: number; y: number }) {
  return {
    x: (g.scrollLeft + at.x - g.offsetX) / g.zoom,
    y: (g.scrollTop + at.y - g.offsetY) / g.zoom,
  };
}

test('a zoom about a point keeps the part of the map under it where it was', () => {
  const g = scroller(1, SCREEN, { left: 200, top: 100 });
  const pointer = { x: 600, y: 350 };
  const before = under(g, pointer);
  for (const zoom of [0.8, 1.3, 2.5]) {
    const next = zoomAbout(g, zoom, pointer);
    expect(next.zoom).toBe(zoom);
    const after = under({ ...g, zoom, scrollLeft: next.left, scrollTop: next.top }, pointer);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  }
});

test('two fingers that drift as they spread pan the map with them', () => {
  const g = scroller(1, SCREEN, { left: 200, top: 100 });
  const from = { x: 500, y: 300 };
  const to = { x: 540, y: 280 };
  const next = zoomAbout(g, 1.5, from, to);
  // What was between the fingers is between them again, where they now are.
  const after = under({ ...g, zoom: 1.5, scrollLeft: next.left, scrollTop: next.top }, to);
  expect(after.x).toBeCloseTo(under(g, from).x, 5);
  expect(after.y).toBeCloseTo(under(g, from).y, 5);
  // And with no zoom at all, it is a pan by the distance the finger moved.
  expect(zoomAbout(g, 1, from, to)).toEqual({ zoom: 1, left: 160, top: 120 });
});

test('a zoom stays inside the range, and its scroll is left for the browser to hold', () => {
  const g = scroller(1, SCREEN);
  expect(zoomAbout(g, 9, { x: 0, y: 0 }).zoom).toBe(ZOOM_MAX);
  expect(zoomAbout(g, 0.01, { x: 0, y: 0 }).zoom).toBe(ZOOM_MIN);
  // A zoom that is not a number keeps the one the map has.
  expect(zoomAbout(g, Number.NaN, { x: 0, y: 0 }).zoom).toBe(1);
  expect(clampZoom(1.7)).toBe(1.7);

  // Zooming out about the middle of a map scrolled to its start asks for a
  // scroll before the start. The browser holds the scroller at 0; the pinch
  // keeps what it asked for, and zooming back in lands where it began.
  const out = zoomAbout(g, 0.5, { x: 600, y: 350 });
  expect(out.left).toBeLessThan(0);
  expect(out.top).toBeLessThan(0);
  const back = zoomAbout({ ...g, zoom: out.zoom, scrollLeft: out.left, scrollTop: out.top }, 1, {
    x: 600,
    y: 350,
  });
  expect(back.left).toBeCloseTo(0, 5);
  expect(back.top).toBeCloseTo(0, 5);
});

test('a pinch tracks the fingers, and a mouse notch is a step and not the whole range', () => {
  // A trackpad pinch: the deltas of one gesture compose to the scale Chrome
  // sized them for, however it splits them across events.
  const deltas = [3, 5, 8, 4, 2];
  const total = deltas.reduce((sum, d) => sum + d, 0);
  const composed = deltas.reduce((zoom, d) => zoom * wheelFactor(d, 0, 800), 1);
  expect(composed).toBeCloseTo(Math.exp(-total / 100), 10);
  // Spreading the fingers is a negative delta, and zooms in.
  expect(wheelFactor(-5, 0, 800)).toBeGreaterThan(1);

  // A notch of a mouse wheel, in pixels or in lines, zooms by about a fifth.
  const notch = wheelFactor(100, 0, 800);
  expect(notch).toBeCloseTo(wheelFactor(3, 1, 800), 10);
  expect(1 / notch).toBeGreaterThan(1.15);
  expect(1 / notch).toBeLessThan(1.3);
  // Ten notches do not reach the end of the range from the middle of it.
  expect(1.2 * wheelFactor(100, 0, 800) ** 10).toBeGreaterThan(0.1);
  // A delta that is not a number scales by nothing.
  expect(wheelFactor(Number.NaN, 0, 800)).toBe(1);
});

test('a press inside the outline keeps its place under the pointer, and one outside jumps to it', () => {
  const view = { x: 100, y: 50, width: 200, height: 100 };
  // Grabbed 50 left of the middle and 30 above it: the outline follows with that gap.
  expect(grabOffset(view, { x: 150, y: 70 })).toEqual({ x: -50, y: -30 });
  expect(grabOffset(view, { x: 200, y: 100 })).toEqual({ x: 0, y: 0 });
  // The edge counts as inside.
  expect(grabOffset(view, { x: 300, y: 150 })).toEqual({ x: 100, y: 50 });
  // Outside, the middle of the outline goes to the pointer.
  expect(grabOffset(view, { x: 500, y: 500 })).toEqual({ x: 0, y: 0 });
});

test('the arrow keys move the view a tenth of a screen, Shift nearly a whole one', () => {
  const g = scroller(1, SCREEN, { left: 100, top: 100 });
  expect(scrollForKey('ArrowRight', false, g)).toEqual({ left: 200, top: 100 });
  expect(scrollForKey('ArrowLeft', false, g)).toEqual({ left: 0, top: 100 });
  expect(scrollForKey('ArrowDown', false, g)).toEqual({ left: 100, top: 160 });
  expect(scrollForKey('ArrowUp', false, g)).toEqual({ left: 100, top: 40 });

  // Shift is 900 of 1000 across, and it stops at the end of the scroll.
  expect(scrollForKey('ArrowRight', true, g)).toEqual({ left: 348, top: 100 });
  expect(scrollForKey('ArrowLeft', true, g)).toEqual({ left: 0, top: 100 });
  expect(scrollForKey('ArrowDown', true, g)).toEqual({ left: 100, top: 244 });
});

test('Home and End go to the corners, and no other key is taken', () => {
  const g = scroller(1, SCREEN, { left: 100, top: 100 });
  expect(scrollForKey('Home', false, g)).toEqual({ left: 0, top: 0 });
  expect(scrollForKey('End', false, g)).toEqual({ left: 348, top: 244 });
  // Tab has to leave, Escape belongs to the page, and j and k step between nodes.
  for (const key of ['Tab', 'Escape', 'Enter', ' ', 'j', 'k', 'a']) {
    expect(scrollForKey(key, false, g)).toBeNull();
  }
});

test('a node is off-screen only when the whole of its circle is out of sight', () => {
  const view = { x: 100, y: 100, width: 400, height: 300 };
  const label = (x: number, y: number) => offscreenLabel(view, { x, y }, NODE_R);

  expect(label(300, 200)).toBeNull();
  expect(label(50, 200)).toBe('left');
  expect(label(600, 200)).toBe('right');
  expect(label(300, 20)).toBe('above');
  expect(label(300, 500)).toBe('below');
  // Out of sight both ways it is a corner, named the way a person would say it.
  expect(label(50, 20)).toBe('top left');
  expect(label(600, 20)).toBe('top right');
  expect(label(50, 500)).toBe('bottom left');
  expect(label(600, 500)).toBe('bottom right');

  // A node half in view is in view, and one whose edge only touches the viewport is too.
  expect(label(90, 200)).toBeNull();
  expect(label(100 - NODE_R, 200)).toBeNull();
  expect(label(100 - NODE_R - 1, 200)).toBe('left');
  expect(offscreen(view, { x: 50, y: 500 }, NODE_R)).toEqual({
    horizontal: 'left',
    vertical: 'below',
  });
});

test('the failing node of the demo is off-screen left once the map is scrolled past its column', () => {
  // Browser Automation is the first row of the third era.
  const node = { x: columnCentre(2), y: START_Y + NODE_R };
  const at = (left: number, top: number) =>
    offscreenLabel(viewportRect(scroller(2, SCREEN, { left, top })), node, NODE_R);

  expect(at(0, 0)).toBeNull();
  expect(at(1200, 0)).toBe('left');
  expect(at(0, 600)).toBe('above');
  expect(at(1200, 600)).toBe('top left');
});

test('Enter on the outline goes to the node nearest its middle', () => {
  const nodes = [
    { id: 'a', x: 100, y: 100 },
    { id: 'b', x: 600, y: 400 },
    { id: 'c', x: 1200, y: 700 },
  ];
  expect(nearestNode({ x: 400, y: 200, width: 400, height: 400 }, nodes)).toBe('b');
  expect(nearestNode({ x: 0, y: 0, width: 200, height: 200 }, nodes)).toBe('a');
  expect(nearestNode({ x: 0, y: 0, width: 200, height: 200 }, [])).toBeNull();
});
