/**
 * Where you are on a map too big to see at once, and whether anything is wrong
 * out of sight.
 *
 * A thumbnail of the whole map: the seven era bars, a dot for every node, the
 * failing ones red, and the part of the map on screen outlined. The outline is
 * a control. It drags, a press anywhere on the thumbnail jumps there, and with
 * focus the arrow keys move it, which is the keyboard's half of a drag.
 *
 * It draws only when the whole map does not fit. When it does, there is
 * nowhere to be lost in, and the thumbnail would be a second copy of the map.
 *
 * The scroll and resize subscription lives here and nowhere else. The tree
 * hands over its scroller, its zoom and where its nodes are, and this reads the
 * rest off the scroller, so a scroll event re-renders this component and never
 * the map. What the map needs back is small and changes rarely: which way the
 * first failing node lies, when it is out of sight.
 */
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { bandOf, NODE_R, type RungState } from './layout';
import {
  clampToScene,
  type Geometry,
  grabOffset,
  type MinimapModel,
  minimapModel,
  offscreenLabel,
  type Point,
  scrollForCentre,
  scrollForKey,
  viewportRect,
} from './viewport';

/** The largest the thumbnail gets, in pixels. It keeps the map's proportions inside this. */
const BOX = { width: 176, height: 124 };

/** A node as the thumbnail draws it: where it is on the map, and where it stands. */
export interface MinimapNode {
  id: string;
  x: number;
  y: number;
  state: RungState;
}

/**
 * The scroller's measurements, read off the DOM. The offsets are the ones "fit"
 * subtracts: the scroller's left padding, and its top padding plus the canvas's
 * own top margin.
 */
export function readGeometry(el: HTMLElement, zoom: number): Geometry {
  const box = getComputedStyle(el);
  const svg = el.querySelector('svg');
  const px = (v: string | undefined) => Number.parseFloat(v ?? '') || 0;
  return {
    scrollLeft: el.scrollLeft,
    scrollTop: el.scrollTop,
    clientWidth: el.clientWidth,
    clientHeight: el.clientHeight,
    scrollWidth: el.scrollWidth,
    scrollHeight: el.scrollHeight,
    offsetX: px(box.paddingLeft),
    offsetY: px(box.paddingTop) + px(svg ? getComputedStyle(svg).marginTop : undefined),
    zoom,
  };
}

const NUMBERS = [
  'scrollLeft',
  'scrollTop',
  'clientWidth',
  'clientHeight',
  'scrollWidth',
  'scrollHeight',
  'offsetX',
  'offsetY',
] as const;

/** Whether two readings are the same to the pixel, so a scroll that moved nothing renders nothing. */
const sameGeometry = (a: Geometry, b: Geometry) =>
  a.zoom === b.zoom && NUMBERS.every(k => Math.abs(a[k] - b[k]) < 0.5);

interface MinimapViewProps {
  model: MinimapModel;
  /** The scene's size in map units, which the thumbnail's coordinates are in. */
  scene: { width: number; height: number };
  columns: number;
  nodes: MinimapNode[];
  rightInset?: number;
  bodyRef?: React.Ref<HTMLDivElement>;
  viewRef?: React.Ref<HTMLButtonElement>;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerRelease?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
}

/** The thumbnail itself. No hooks: it draws what the model says. */
export function MinimapView({
  model,
  scene,
  columns,
  nodes,
  rightInset = 0,
  bodyRef,
  viewRef,
  onPointerDown,
  onPointerMove,
  onPointerRelease,
  onKeyDown,
}: MinimapViewProps) {
  // A dot is never smaller than two pixels across, however big the map is.
  const radius = Math.max(NODE_R * 0.7, 1.7 / model.scale);
  // A failing node is drawn last, so it is never under one that is fine.
  const ordered = [
    ...nodes.filter(n => n.state !== 'failing'),
    ...nodes.filter(n => n.state === 'failing'),
  ];
  return (
    <section className="civ-minimap" aria-label="Minimap" style={{ right: 12 + rightInset }}>
      <div
        className="civ-minimap-body"
        ref={bodyRef}
        style={{ width: model.width, height: model.height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerRelease}
        onPointerCancel={onPointerRelease}
      >
        <svg
          className="civ-minimap-svg"
          width={model.width}
          height={model.height}
          viewBox={`0 0 ${scene.width} ${scene.height}`}
          aria-hidden="true"
        >
          {Array.from({ length: columns }, (_, i) => (
            <rect key={i} className="civ-minimap-band" {...bandOf(i, scene.height)} rx={12} />
          ))}
          {ordered.map(n => (
            <circle
              key={n.id}
              className={`civ-minimap-dot civ-minimap-dot--${n.state}`}
              cx={n.x}
              cy={n.y}
              r={n.state === 'failing' ? radius * 1.5 : radius}
            />
          ))}
        </svg>
        <button
          type="button"
          className="civ-minimap-view"
          ref={viewRef}
          aria-label="Viewport on the map. Drag it, or use the arrow keys to move the view; Shift moves a screen at a time, Home and End go to the corners."
          onKeyDown={onKeyDown}
          style={{
            left: model.view.left,
            top: model.view.top,
            width: model.view.width,
            height: model.view.height,
          }}
        />
      </div>
    </section>
  );
}

interface MinimapProps {
  /** The map's scroller: what scrolls, and what is measured. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  /** The scene's size in map units. */
  width: number;
  height: number;
  columns: number;
  /** The nodes to draw, at their places on the map. */
  nodes: MinimapNode[];
  /** The node whose direction the map wants: the one its finding points at. */
  watch?: string;
  /** Told which way `watch` lies when it is out of sight, and null when it is in view or the map fits. */
  onWhere?: (where: string | null) => void;
  /** Anything else that moves the scene inside the scroller, so the offsets are read again. */
  layoutKey?: string;
  leftInset?: number;
  rightInset?: number;
}

export function Minimap({
  containerRef,
  zoom,
  width,
  height,
  columns,
  nodes,
  watch,
  onWhere,
  layoutKey,
  leftInset = 0,
  rightInset = 0,
}: MinimapProps) {
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLButtonElement>(null);
  const grab = useRef<Point | null>(null);
  const scene = { width, height };

  // The one place the scroller is listened to. Nothing here runs on the
  // server: an effect never does, and the browser globals are named inside it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scene size, the inset and the layout key are not read in the body; a change in any of them moves the scene inside the scroller, which is the reason to measure again
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const next = readGeometry(el, zoom);
      setGeometry(prev => (prev && sameGeometry(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    el.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(el);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [containerRef, zoom, width, height, leftInset, layoutKey]);

  const model = geometry ? minimapModel(geometry, scene, BOX) : null;
  const target = watch ? nodes.find(n => n.id === watch) : undefined;
  const where =
    geometry && model && target ? offscreenLabel(viewportRect(geometry), target, NODE_R) : null;
  useEffect(() => {
    onWhere?.(where);
  }, [where, onWhere]);

  if (!model) return null;

  /** Where a pointer is on the map, from where it is on the thumbnail. */
  const sceneAt = (e: React.PointerEvent<HTMLDivElement>): Point => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - box.left) / model.scale, y: (e.clientY - box.top) / model.scale };
  };
  /** Scroll so the pointer's place, less what was grabbed, is the middle of the screen. */
  const follow = (at: Point) => {
    const el = containerRef.current;
    if (!el) return;
    const offset = grab.current ?? { x: 0, y: 0 };
    const to = scrollForCentre({ x: at.x - offset.x, y: at.y - offset.y }, readGeometry(el, zoom));
    el.scrollLeft = to.left;
    el.scrollTop = to.top;
  };

  return (
    <MinimapView
      model={model}
      scene={scene}
      columns={columns}
      nodes={nodes}
      rightInset={rightInset}
      bodyRef={bodyRef}
      viewRef={viewRef}
      onPointerDown={e => {
        const el = containerRef.current;
        if (e.button !== 0 || !el) return;
        e.preventDefault();
        const at = sceneAt(e);
        grab.current = grabOffset(clampToScene(viewportRect(readGeometry(el, zoom)), scene), at);
        e.currentTarget.setPointerCapture(e.pointerId);
        viewRef.current?.focus({ preventScroll: true });
        follow(at);
      }}
      onPointerMove={e => {
        if (grab.current) follow(sceneAt(e));
      }}
      onPointerRelease={e => {
        grab.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }}
      onKeyDown={e => {
        const el = containerRef.current;
        if (!el) return;
        const to = scrollForKey(e.key, e.shiftKey, readGeometry(el, zoom));
        if (!to) return;
        // The map takes the arrow keys to step between nodes; here they move the view.
        e.preventDefault();
        e.stopPropagation();
        el.scrollLeft = to.left;
        el.scrollTop = to.top;
      }}
    />
  );
}
