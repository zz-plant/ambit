import React, { useMemo, useState } from 'react';
import type { Item, Connection } from '../utils/configImporter';
import { useAmbitStore } from '../store/ambitStore';
import { isRuntimeNode } from '../utils/labels';
import { typeColor, typeSymbol } from '../utils/typeColors';
import {
  buildAdjacency,
  buildColumns,
  COL_W,
  columnLabel,
  columnOf,
  costOf,
  edgePath,
  eraOf,
  isNext,
  layoutNodes,
  mapFindings,
  NODE_R,
  readableSeconds,
  ROW_H,
  sceneSize,
  START_X,
  START_Y,
  visibleItems,
  wrapLabel,
} from './civ/layout.ts';
import { MapFinding } from './civ/MapFinding.tsx';
import { SimulationBanner } from './civ/SimulationBanner.tsx';
import { ZoomHud } from './civ/ZoomHud.tsx';
import { termTitle } from './Term.tsx';

interface CivTreeProps {
  /** Pixels of the scene covered by the docked panel, so column one is visible. */
  leftInset?: number;
  /** Pixels covered by the detail panel, so the lens switcher stays clear of it. */
  rightInset?: number;
  items: Item[];
  connections: Connection[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}

/**
 * The attention lens is a magnitude, so it gets one hue in four steps rather
 * than two colours either side of a number nobody wrote down.
 *
 * The bins come from the data — a quarter of the observed maximum each — so
 * the ramp always spans the range actually present, and the legend can print
 * the boundaries instead of asking the reader to guess what "warm" means.
 */
function heatBins(max: number): { from: number; to: number; label: string }[] {
  const top = Math.max(max, 4);
  const width = Math.ceil(top / 4);
  return [0, 1, 2, 3].map(i => {
    const from = i * width + 1;
    const to = i === 3 ? top : (i + 1) * width;
    return { from, to, label: i === 3 ? `${from}+` : `${from}–${to}` };
  });
}

/** Which of the four steps a count falls in, 1-based; 0 means no interventions. */
function heatStep(count: number, max: number): number {
  if (count <= 0) return 0;
  const bins = heatBins(max);
  const hit = bins.findIndex(b => count <= b.to);
  return hit === -1 ? bins.length : hit + 1;
}

/** One entry of the legend under the map: a swatch, a stroke, or a heading for the ramp. */
type LegendKey =
  | { kind: 'label'; label: string }
  | { kind: 'node'; label: string; color: string; sym?: string }
  | { kind: 'ring' | 'faded' | 'square'; label: string }
  | { kind: 'line'; label: string; color?: string; dashed?: boolean };

/**
 * The count under a column's name, drawn as well as written. A column is a
 * set with a size and a filled fraction; saying "Era 5" where "1 of 5" could
 * stand was a label where a measurement belonged. One scale across all seven
 * columns: the bar's full width is the largest era, so a short bar is a small
 * era and not a poorly-filled one. Beside the count, what finishing the
 * column would cost in setup time.
 */
function ColumnCount({
  column,
  list,
  largest,
  x,
}: {
  column: string;
  list: Item[];
  largest: number;
  x: number;
}) {
  const reached = list.filter(i => i.status === 'built').length;
  const next = list.filter(i => i.status !== 'built' && isNext(i)).length;
  const left = readableSeconds(
    list
      .filter(i => i.status !== 'built')
      .reduce((t, i) => t + (Number(i.meta?.setupSeconds) || 0), 0)
  );
  const barW = ((COL_W - 64) * list.length) / largest;
  const unit = list.length ? barW / list.length : 0;
  const bx = x + COL_W / 2 - 16 - barW / 2;
  const by = START_Y - 11;
  return (
    <g>
      <text
        x={x + COL_W / 2 - 16}
        y={START_Y - 16}
        textAnchor="middle"
        fill="var(--text-muted)"
        fontSize={9.5}
        fontWeight={500}
        style={{ fontFamily: 'var(--font-sans)', fontVariantNumeric: 'tabular-nums' }}
      >
        {column.startsWith('era:') ? `Era ${column.slice(4)} · ` : ''}
        {reached} of {list.length}
        {left ? ` · ${left} left` : ''}
      </text>
      <rect className="fig-eras-track" x={bx} y={by} width={barW} height={3} rx={1} />
      {reached > 0 && (
        <rect className="fig-eras-reached" x={bx} y={by} width={unit * reached} height={3} rx={1} />
      )}
      {next > 0 && (
        <rect
          className="fig-eras-next"
          x={bx + unit * reached}
          y={by}
          width={unit * next}
          height={3}
          rx={1}
        />
      )}
    </g>
  );
}

export default function CivTree({
  items,
  connections,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  leftInset = 0,
  rightInset = 0,
}: CivTreeProps) {
  const requestedLens = useAmbitStore(s => s.activeLens);
  const setActiveLens = useAmbitStore(s => s.setActiveLens);
  // Owned by the store so the header's segments light the same keys the
  // legend does; see AppDeck.tsx.
  const spotlight = useAmbitStore(s => s.spotlight);
  const setSpotlight = useAmbitStore(s => s.setSpotlight);
  const simulationMode = useAmbitStore(s => s.simulationMode);
  const simulatedNodeId = useAmbitStore(s => s.simulatedNodeId);
  const simulatedCascadeIds = useAmbitStore(s => s.simulatedCascadeIds);
  const simulatedWeakenedIds = useAmbitStore(s => s.simulatedWeakenedIds);
  const clearSimulation = useAmbitStore(s => s.clearSimulation);
  const startAcquisition = useAmbitStore(s => s.startAcquisitionSimulation);
  // Everything a simulation touches, so an edge is lit when both ends are.
  const simSet = useMemo(
    () =>
      new Set([
        ...(simulatedNodeId ? [simulatedNodeId] : []),
        ...simulatedCascadeIds,
        ...simulatedWeakenedIds,
      ]),
    [simulatedNodeId, simulatedCascadeIds, simulatedWeakenedIds]
  );
  const attentionInterventions = useAmbitStore(s => s.attentionInterventions);
  // The top of the scale the lens is drawn against, and the number its legend
  // prints. Taken from the data so the ramp spans what is actually there.
  const attentionMax = React.useMemo(
    () => Math.max(0, ...Object.values(attentionInterventions ?? {}).map(Number)),
    [attentionInterventions]
  );
  // A lens with no data to colour falls back to the standard map, and the
  // HUD offers it disabled with the reason. The map used to go grey with a
  // note over it.
  const attentionAvailable = attentionMax > 0;
  const activeLens =
    requestedLens === 'attention' && !attentionAvailable ? 'default' : requestedLens;

  const simulatedItem = items.find(i => i.id === simulatedNodeId);

  const { downstream, upstream } = useMemo(() => buildAdjacency(connections, null), [connections]);

  const filtered = useMemo(() => visibleItems(items), [items]);

  const [hoverItem, setHoverItem] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = React.useRef<{
    scrollLeft: number;
    scrollTop: number;
    mouseX: number;
    mouseY: number;
  } | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);

  const { cols, colOrder } = useMemo(
    () => buildColumns(filtered, connections),
    [filtered, connections]
  );

  const nodePositionMap = useMemo(() => layoutNodes({ cols, colOrder }), [cols, colOrder]);
  const findings = useMemo(() => mapFindings(items, connections), [items, connections]);
  const largestColumn = Math.max(...colOrder.map(c => (cols[c] || []).length), 1);

  // One hop, both ways, from the node in focus: the selection, or failing
  // that whatever the pointer is over. Selecting used to light the whole
  // connected component in both directions, transitively, so a keystone lit
  // most of the map and the two directions read the same. What a node needs
  // and what it enables are drawn apart now, and the transitive answer is
  // the simulation, one click away in the panel.
  const hovered = hoverItem || hoveredId;
  const focusId =
    selectedId && nodePositionMap.has(selectedId)
      ? selectedId
      : hovered && nodePositionMap.has(hovered)
        ? hovered
        : null;
  const needs = useMemo(
    () => new Set(focusId ? upstream.get(focusId) || [] : []),
    [focusId, upstream]
  );
  const enables = useMemo(
    () => new Set(focusId ? downstream.get(focusId) || [] : []),
    [focusId, downstream]
  );

  // The tree view is one kind of node in era columns; the setup view is many
  // kinds in domain columns. The legend and the spotlights follow.
  const isTreeView = filtered.some(i => eraOf(i) !== undefined);
  const lifecycleOf = (item: Item) => (item.meta?.lifecycle as string | undefined) ?? '';
  const keystone = (item: Item) =>
    (downstream.get(item.id) || []).length >= 3 || isRuntimeNode(item);
  /** The glossary entry each legend key is a picture of. */
  const LEGEND_CONCEPTS: Record<string, string> = {
    Reached: 'state',
    'Next step': 'state',
    Blocked: 'state',
    Keystone: 'keystone',
    Combo: 'combo',
    'Tool server': 'tool-server',
    Agent: 'capability',
    Skill: 'capability',
    Passing: 'evidence',
    Failing: 'evidence',
    Required: 'prerequisite',
    Optional: 'prerequisite',
    'Interventions a month': 'attention',
  };
  const SPOTLIGHTS: Record<string, (item: Item) => boolean> = {
    Reached: i => i.status === 'built',
    'Next step': i => i.status !== 'built' && isNext(i),
    Blocked: i => i.status !== 'built' && !isNext(i),
    Server: i => i.type === 'mcp-server',
    Agent: i => i.type === 'agent',
    Skill: i => i.type === 'skill',
    Combo: i => i.type === 'possibility',
    Keystone: keystone,
    Passing: i => ['verified', 'reliable'].includes(lifecycleOf(i)),
    Failing: i => ['degraded', 'broken'].includes(lifecycleOf(i)),
  };

  /**
   * The legend for the lens in front of you. Hoisted out of the JSX because
   * the row below it reports how many keys there are and whether any of them
   * can be clicked.
   */
  // While a node is selected the legend also keys the two directions its
  // edges are drawn in.
  const directionKeys: LegendKey[] =
    selectedId && focusId === selectedId
      ? [
          { kind: 'line', color: 'var(--edge-needs)', label: 'Needs' },
          { kind: 'line', color: 'var(--accent)', label: 'Enables' },
        ]
      : [];
  const legend: LegendKey[] =
    activeLens === 'attention'
      ? [
          // A scale with no unit is a row of coloured dots. Say what is
          // being counted, once, at the head of the ramp.
          { kind: 'label', label: 'Interventions a month' },
          ...heatBins(attentionMax).map(
            (b, i): LegendKey => ({ kind: 'node', color: `var(--heat-${i + 1})`, label: b.label })
          ),
        ]
      : isTreeView
        ? [
            { kind: 'node', color: typeColor('possibility'), label: 'Reached' },
            { kind: 'ring', label: 'Next step' },
            { kind: 'faded', label: 'Blocked' },
            { kind: 'square', label: 'Keystone' },
            { kind: 'node', color: 'var(--ok)', sym: '✓', label: 'Passing' },
            { kind: 'node', color: 'var(--error)', sym: '!', label: 'Failing' },
            { kind: 'line', label: 'Required' },
            { kind: 'line', dashed: true, label: 'Optional' },
            ...directionKeys,
          ]
        : [
            { kind: 'node', color: typeColor('mcp-server'), sym: '◈', label: 'Tool server' },
            { kind: 'node', color: typeColor('agent'), sym: '◆', label: 'Agent' },
            { kind: 'node', color: typeColor('skill'), sym: '◇', label: 'Skill' },
            { kind: 'node', color: typeColor('possibility'), sym: '●', label: 'Combo' },
            { kind: 'square', label: 'Keystone' },
            { kind: 'node', color: 'var(--ok)', sym: '✓', label: 'Passing' },
            { kind: 'node', color: 'var(--error)', sym: '!', label: 'Failing' },
            { kind: 'line', label: 'Required' },
            { kind: 'line', dashed: true, label: 'Optional' },
            ...directionKeys,
          ];
  const legendCount = legend.length;
  const hasSpotlights = legend.some(l => Boolean(SPOTLIGHTS[l.label]));

  // The selected node has the detail panel open beside it, which says
  // everything the tooltip would, so the tooltip is for the others.
  const hoverTarget =
    hovered && hovered !== selectedId && nodePositionMap.has(hovered) ? hovered : null;
  const hoverDownstream = hoverTarget ? downstream.get(hoverTarget) || [] : [];

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (e.key === '1') {
        setActiveLens('default');
      } else if (e.key === '2') {
        if (attentionAvailable) setActiveLens('attention');
      } else if (e.key === '0') {
        e.preventDefault();
        setZoom(1);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom(z => Math.min(2.5, +(z + 0.15).toFixed(2)));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoom(z => Math.max(0.4, +(z - 0.15).toFixed(2)));
      } else if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
        e.preventDefault();
        const idx = filtered.findIndex(i => i.id === selectedId);
        const nextIdx = idx < 0 ? 0 : (idx + 1) % filtered.length;
        onSelect(filtered[nextIdx].id);
      } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = filtered.findIndex(i => i.id === selectedId);
        const prevIdx = idx <= 0 ? filtered.length - 1 : idx - 1;
        onSelect(filtered[prevIdx].id);
      } else if (e.key === 'Escape') {
        if (spotlight) setSpotlight(null);
        else if (simulationMode !== 'none') clearSimulation();
        else if (selectedId) onSelect(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    setActiveLens,
    attentionAvailable,
    clearSimulation,
    simulationMode,
    selectedId,
    onSelect,
    filtered,
    spotlight,
    setSpotlight,
  ]);

  // Center node in view when selected
  React.useEffect(() => {
    if (selectedId && nodePositionMap.has(selectedId)) {
      const pos = nodePositionMap.get(selectedId)!;
      if (containerRef.current) {
        const container = containerRef.current;
        const targetScrollLeft = pos.x * zoom - container.clientWidth / 2;
        const targetScrollTop = pos.y * zoom - container.clientHeight / 2;
        container.scrollTo({
          left: Math.max(0, targetScrollLeft),
          top: Math.max(0, targetScrollTop),
          behavior: 'smooth',
        });
      }
    }
  }, [selectedId, zoom, nodePositionMap]);

  const { width: contentWidth, height: contentHeight } = sceneSize({ cols, colOrder });

  // Open with every column on screen. At 100% the seventh era sat past the
  // right edge with nothing to say it was there, and in the setup view every
  // edge to the runtime column ran off the canvas towards a node nobody could
  // see. Fits once per dataset; the zoom controls own it after that.
  const fittedFor = React.useRef<number | null>(null);
  React.useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || fittedFor.current === contentWidth) return;
    fittedFor.current = contentWidth;
    const available = el.clientWidth - leftInset - 16;
    if (available <= 0) return;
    setZoom(Math.max(0.4, Math.min(1, +(available / contentWidth).toFixed(2))));
  }, [contentWidth, leftInset]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (
      (e.target as HTMLElement).closest('[role="button"]') ||
      (e.target as HTMLElement).closest('button')
    )
      return;
    if (!containerRef.current) return;
    setIsDragging(true);
    dragStartRef.current = {
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop,
      mouseX: e.clientX,
      mouseY: e.clientY,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !dragStartRef.current || !containerRef.current) return;
    const dx = e.clientX - dragStartRef.current.mouseX;
    const dy = e.clientY - dragStartRef.current.mouseY;
    containerRef.current.scrollLeft = dragStartRef.current.scrollLeft - dx;
    containerRef.current.scrollTop = dragStartRef.current.scrollTop - dy;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    dragStartRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(z => Math.max(0.4, Math.min(2.5, +(z + delta).toFixed(2))));
    }
  };

  // The controls sit over the scroller, not inside it. Inside, they were
  // sticky, which holds vertically and, with a left inset, horizontally too;
  // but Chrome measures that inset from the scroller's padding edge and other
  // engines from its border edge, so centring a node pushed the zoom controls
  // 340px to the right in one and under the capability list in the other.
  return (
    <div className="civ-tree">
      <ZoomHud
        zoom={zoom}
        setZoom={setZoom}
        containerRef={containerRef}
        contentWidth={contentWidth}
        contentHeight={contentHeight}
        activeLens={activeLens}
        onSetLens={setActiveLens}
        attentionAvailable={attentionAvailable}
        leftInset={leftInset}
        rightInset={rightInset}
      />

      <SimulationBanner
        simulationMode={simulationMode}
        simulatedNodeId={simulatedNodeId}
        simulatedItem={simulatedItem}
        simulatedCascadeIds={simulatedCascadeIds}
        simulatedWeakenedIds={simulatedWeakenedIds}
        items={items}
        clearSimulation={clearSimulation}
        leftInset={leftInset}
        rightInset={rightInset}
      />

      {simulationMode === 'none' && !selectedId && (
        <MapFinding
          findings={findings}
          onShow={id => onSelect(id)}
          onPreview={id => {
            onSelect(id);
            startAcquisition(id);
          }}
          leftInset={leftInset}
          rightInset={rightInset}
        />
      )}

      {/* biome-ignore lint/a11y/noStaticElementInteractions: Dragging to pan is a pointer affordance layered over the canvas. Content inside is keyboard operable. */}
      <div
        ref={containerRef}
        className="civ-scroll"
        // Dragging to pan is a pointer affordance layered over the canvas. The
        // a11y warning on this element is expected and left visible: every node
        // inside carries role="button", tabIndex and a key handler, so the
        // content is reachable and operable without a pointer.
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{
          paddingLeft: leftInset,
          cursor: isDragging ? 'grabbing' : 'default',
          userSelect: isDragging ? 'none' : 'auto',
        }}
      >
        {/* Main SVG Vector Canvas */}
        <svg
          viewBox={`0 0 ${contentWidth} ${contentHeight}`}
          className="civ-tree-svg"
          style={{
            background: 'var(--bg-canvas)',
            width: `${contentWidth * zoom}px`,
            height: `${contentHeight * zoom}px`,
            minWidth: `${contentWidth * zoom}px`,
          }}
        >
          <title>Capability tree: what this setup can do, by era</title>
          <defs>
            <linearGradient id="columnGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(255, 255, 255, 0.03)" />
              <stop offset="100%" stopColor="rgba(255, 255, 255, 0.005)" />
            </linearGradient>
          </defs>

          {/* Era column bands with clean headers */}
          {colOrder.map((d, i) => {
            const x = START_X + i * COL_W;
            return (
              <g key={`band-${d}`}>
                <rect
                  x={x - 8}
                  y={START_Y - 45}
                  width={COL_W - 16}
                  height={contentHeight - START_Y + 20}
                  fill="url(#columnGrad)"
                  stroke="var(--border)"
                  strokeWidth={1}
                  rx={10}
                />
                <rect
                  x={x - 8}
                  y={START_Y - 45}
                  width={COL_W - 16}
                  height={40}
                  fill="rgba(255, 255, 255, 0.02)"
                  rx={10}
                />
                <text
                  x={x + COL_W / 2 - 16}
                  y={START_Y - 29}
                  textAnchor="middle"
                  fill="var(--text-primary)"
                  fontSize={12}
                  fontWeight={600}
                  letterSpacing={0.5}
                  style={{ fontFamily: 'var(--font-sans)' }}
                >
                  <title>{termTitle(isTreeView ? 'era' : 'domain')}</title>
                  {columnLabel(d, cols[d] || [])}
                </text>
                <ColumnCount column={d} list={cols[d] || []} largest={largestColumn} x={x} />
              </g>
            );
          })}

          {/* Edges, behind the nodes. Curved, so a bundle into one node fans
              instead of converging through everything between. Into the focus
              in one colour, out of it in another. */}
          {connections.map((conn, i) => {
            const fromPos = nodePositionMap.get(conn.from);
            const toPos = nodePositionMap.get(conn.to);
            if (!fromPos || !toPos) return null;
            const isHard = conn.type === 'hard-dep';
            const isSoft = conn.type === 'soft-dep';
            const isSimLine =
              simulationMode !== 'none' && simSet.has(conn.from) && simSet.has(conn.to);
            const intoFocus = focusId !== null && conn.to === focusId;
            const outOfFocus = focusId !== null && conn.from === focusId;
            const op = isSimLine
              ? 1
              : simulationMode !== 'none'
                ? 0.08
                : focusId
                  ? intoFocus || outOfFocus
                    ? 0.95
                    : 0.06
                  : 0.35;
            const strokeColor = isSimLine
              ? simulationMode === 'outage'
                ? 'var(--error)'
                : simulationMode === 'gap'
                  ? 'var(--warn)'
                  : 'var(--ok)'
              : intoFocus
                ? 'var(--edge-needs)'
                : outOfFocus
                  ? 'var(--accent)'
                  : isHard
                    ? 'rgba(99, 102, 241, 0.6)'
                    : isSoft
                      ? 'rgba(148, 163, 184, 0.4)'
                      : 'var(--warn)';

            return (
              <path
                key={`c-${i}`}
                d={edgePath(fromPos.x, fromPos.y, toPos.x, toPos.y)}
                fill="none"
                stroke={strokeColor}
                strokeWidth={isSimLine ? 2.5 : intoFocus || outOfFocus ? 2 : isHard ? 1.5 : 1}
                strokeDasharray={isHard ? 'none' : isSoft ? '4,4' : '3,3'}
                strokeLinecap="round"
                opacity={op}
              />
            );
          })}

          {/* Nodes */}
          {colOrder.map((domain, ci) => {
            const caps = cols[domain] || [];
            const cx = START_X + ci * COL_W + COL_W / 2 - 16;
            return (
              <g key={domain}>
                {caps.map((item, ri) => {
                  const cy = START_Y + ri * ROW_H + NODE_R;
                  const defaultColor = typeColor(item.type);
                  const selected = item.id === selectedId;
                  const isFocus = item.id === focusId;
                  const inNeeds = needs.has(item.id);
                  const inEnables = enables.has(item.id);
                  const nearFocus = isFocus || inNeeds || inEnables;

                  const isSimRoot = simulationMode !== 'none' && simulatedNodeId === item.id;
                  const isSimWeak = simulationMode !== 'none' && simulatedWeakenedIds.has(item.id);
                  const isSimAffected =
                    simulationMode !== 'none' && (simulatedCascadeIds.has(item.id) || isSimWeak);
                  const isSimDimmed = simulationMode !== 'none' && !isSimRoot && !isSimAffected;

                  const interventionCount = attentionInterventions[item.id] || 0;
                  const isAttentionHot = activeLens === 'attention' && interventionCount > 0;
                  const heat = heatStep(interventionCount, attentionMax);

                  const isKeystone = keystone(item);

                  const next = isNext(item);
                  const reached = item.status === 'built';

                  const isSpotlit = !spotlight || (SPOTLIGHTS[spotlight]?.(item) ?? true);

                  const dimmed = (focusId !== null && !nearFocus) || isSimDimmed || !isSpotlit;
                  const baseOpacity =
                    isSimRoot || isSimAffected
                      ? 1
                      : !isSpotlit
                        ? 0.15
                        : dimmed
                          ? 0.25
                          : reached || next
                            ? 1
                            : 0.75;
                  const failingNode = reached && ['degraded', 'broken'].includes(lifecycleOf(item));

                  // Reached is done, so it is the quietest filled state; a next
                  // step is the recommendation, so it is the loudest ring on the
                  // map; blocked is drawn as a gap, dashed and legible, and not
                  // faded to where it could not be read.
                  let nodeFill = reached
                    ? defaultColor
                    : next
                      ? 'var(--accent-soft)'
                      : 'var(--bg-canvas)';
                  let sc = selected
                    ? 'var(--on-accent)'
                    : inNeeds
                      ? 'var(--edge-needs)'
                      : inEnables
                        ? 'var(--accent)'
                        : failingNode
                          ? 'var(--error)'
                          : next
                            ? 'var(--accent)'
                            : reached
                              ? defaultColor
                              : 'var(--text-muted)';
                  let sw =
                    selected || inNeeds || inEnables || failingNode
                      ? 2.5
                      : next
                        ? 3
                        : reached
                          ? 1.5
                          : 1.25;

                  if (simulationMode === 'outage') {
                    if (isSimRoot) {
                      nodeFill = 'var(--error)';
                      sc = 'var(--on-accent)';
                      sw = 2.5;
                    } else if (isSimAffected) {
                      // Red for what stops; amber for what keeps another
                      // provider and only loses one. It was all red.
                      nodeFill = isSimWeak ? 'var(--warn)' : 'var(--error-deep)';
                      sc = 'var(--on-accent)';
                      sw = 2;
                    }
                  } else if (simulationMode === 'gap') {
                    if (isSimRoot) {
                      nodeFill = 'var(--accent)';
                      sc = 'var(--on-accent)';
                      sw = 2.5;
                    } else if (isSimAffected) {
                      nodeFill = 'var(--warn)';
                      sc = 'var(--on-accent)';
                      sw = 2;
                    }
                  } else if (simulationMode === 'acquisition') {
                    if (isSimRoot) {
                      nodeFill = 'var(--accent)';
                      sc = 'var(--on-accent)';
                      sw = 2.5;
                    } else if (isSimAffected) {
                      nodeFill = 'var(--ok)';
                      sc = 'var(--on-accent)';
                      sw = 2;
                    }
                  } else if (isAttentionHot) {
                    // One hue, four steps, brighter with more — a quantity read
                    // as a quantity. It used to be two colours split at twenty:
                    // red above, amber below, a threshold nothing stated and a
                    // second hue that made a magnitude look like a category.
                    nodeFill = `var(--heat-${heat})`;
                    sc = 'var(--on-accent)';
                    sw = 2;
                  }

                  const sym = typeSymbol(item.type);
                  const lines = wrapLabel(item.name);

                  return (
                    // biome-ignore lint/a11y/useSemanticElements: SVG element groups cannot be HTML buttons
                    <g
                      key={item.id}
                      transform={`translate(${cx}, ${cy})`}
                      opacity={baseOpacity}
                      tabIndex={0}
                      role="button"
                      aria-pressed={selected}
                      aria-label={`${item.name}, ${item.type}`}
                      onClick={() => onSelect(selected ? null : item.id)}
                      onKeyDown={e => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        onSelect(selected ? null : item.id);
                      }}
                      onFocus={() => {
                        onHover?.(item.id);
                        setHoverItem(item.id);
                      }}
                      onBlur={() => {
                        onHover?.(null);
                        setHoverItem(null);
                      }}
                      onMouseEnter={() => {
                        onHover?.(item.id);
                        setHoverItem(item.id);
                      }}
                      onMouseLeave={() => {
                        onHover?.(null);
                        setHoverItem(null);
                      }}
                      style={{ cursor: 'pointer', transition: 'opacity .15s' }}
                    >
                      {isKeystone && !dimmed && (
                        <rect
                          x={-NODE_R - 4}
                          y={-NODE_R - 4}
                          width={(NODE_R + 4) * 2}
                          height={(NODE_R + 4) * 2}
                          rx={8}
                          fill="none"
                          stroke="rgba(245, 158, 11, 0.85)"
                          strokeWidth={2}
                          strokeDasharray="5,3"
                        />
                      )}

                      {selected && (
                        <circle
                          r={NODE_R + 7}
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth={2}
                          opacity={0.8}
                        />
                      )}

                      {/* A next step is the outlined circle the legend draws, with
                        its setup cost beside it. It used to carry a second ring
                        outside that one and an amber "Boost" tag that no legend,
                        glossary or document explained. */}
                      {next && !dimmed && !isSimAffected && costOf(item) && (
                        <text
                          x={NODE_R + 6}
                          y={-NODE_R + 4}
                          textAnchor="start"
                          fill="#a5b4fc"
                          fontSize={11.5}
                          fontWeight={700}
                          fontFamily="var(--font-sans)"
                        >
                          {costOf(item)}
                        </text>
                      )}

                      <circle
                        r={NODE_R}
                        fill={nodeFill}
                        fillOpacity={
                          reached && simulationMode === 'none' && !isAttentionHot && !selected
                            ? 0.6
                            : 1
                        }
                        stroke={sc}
                        strokeWidth={sw}
                        strokeDasharray={
                          !reached && !next && simulationMode === 'none' && !isAttentionHot
                            ? '5,4'
                            : undefined
                        }
                        opacity={0.95}
                      />
                      <text
                        y={4}
                        textAnchor="middle"
                        fill={
                          reached
                            ? 'var(--on-accent)'
                            : dimmed
                              ? 'var(--text-muted)'
                              : 'var(--on-accent)'
                        }
                        fontSize={14}
                        fontWeight={700}
                      >
                        {sym}
                      </text>

                      {reached &&
                        !dimmed &&
                        ['verified', 'reliable'].includes(item.meta?.lifecycle as string) && (
                          <g transform={`translate(${NODE_R - 3}, ${-NODE_R + 3})`}>
                            <circle
                              r={6}
                              fill="var(--ok)"
                              stroke="var(--bg-canvas)"
                              strokeWidth={1.5}
                            />
                            <text
                              y={3}
                              textAnchor="middle"
                              fill="var(--on-accent)"
                              fontSize={9}
                              fontWeight={800}
                            >
                              ✓
                            </text>
                          </g>
                        )}
                      {reached &&
                        !dimmed &&
                        ['degraded', 'broken'].includes(item.meta?.lifecycle as string) && (
                          <g transform={`translate(${NODE_R - 3}, ${-NODE_R + 3})`}>
                            <circle
                              r={6}
                              fill="var(--error)"
                              stroke="var(--bg-canvas)"
                              strokeWidth={1.5}
                            />
                            <text
                              y={3}
                              textAnchor="middle"
                              fill="var(--on-accent)"
                              fontSize={9}
                              fontWeight={800}
                            >
                              !
                            </text>
                          </g>
                        )}
                      {/* Two lines where the name needs them. A trailing space
                          on the first keeps the element's text the whole name,
                          which the recorder matches against the aria-label. */}
                      <text
                        y={NODE_R + 16}
                        textAnchor="middle"
                        fill={dimmed ? 'var(--text-muted)' : 'var(--text-primary)'}
                        fontSize={11.5}
                        fontWeight={500}
                        fontFamily="var(--font-sans)"
                      >
                        {lines.map((line, li) => (
                          <tspan key={line} x={0} dy={li === 0 ? 0 : 12}>
                            {li < lines.length - 1 ? `${line} ` : line}
                          </tspan>
                        ))}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* Hover tooltip */}
          {hoverTarget &&
            (() => {
              const ni = items.find(i => i.id === hoverTarget);
              if (!ni) return null;
              const di = colOrder.indexOf(columnOf(ni));
              const ai = (cols[columnOf(ni)] || []).findIndex((i: Item) => i.id === hoverTarget);
              if (di < 0 || ai < 0) return null;

              const wrap = (text: string, perLine = 28, max = 4) => {
                const out: string[] = [];
                let line = '';
                for (const word of text.split(' ')) {
                  if ((line + word).length > perLine) {
                    out.push(line.trim());
                    line = '';
                  }
                  if (out.length === max) return [...out.slice(0, max - 1), out[max - 1] + '…'];
                  line += word + ' ';
                }
                if (line.trim()) out.push(line.trim());
                return out;
              };

              const unreached = ni.status !== 'built';
              const lines = unreached && ni.description ? wrap(ni.description) : [];
              const enables = hoverDownstream.slice(0, 4);
              const downCount = (downstream.get(ni.id) || []).length;
              const isKey = downCount >= 3 || isRuntimeNode(ni);

              const W = 220;
              const headH = 22;
              const keyH = isKey ? 18 : 0;
              const descH = lines.length * 15;
              const enablesH = enables.length ? 20 + enables.length * 15 : 0;
              // The simulations are the thing people do not find, and a faded
              // circle reads as scenery until something says otherwise. A click
              // opens the panel that offers the one this node can run: an outage
              // on a node you have, an unlock on one you do not.
              const hint = unreached
                ? 'Click: details, and simulate unlocking it'
                : 'Click: details, and simulate an outage';
              const hintH = 17;
              const boxH = headH + keyH + descH + enablesH + hintH + 12;

              const tx = START_X + di * COL_W + COL_W / 2 - 16 + NODE_R + 10;
              const ty = START_Y + ai * ROW_H + NODE_R - 10;

              return (
                <g transform={`translate(${tx}, ${ty})`} pointerEvents="none">
                  <rect
                    x={0}
                    y={0}
                    width={W}
                    height={boxH}
                    rx={8}
                    fill="var(--bg-surface)"
                    stroke="var(--border)"
                    strokeWidth={1}
                  />
                  <text
                    x={12}
                    y={16}
                    fill="var(--text-primary)"
                    fontSize={12}
                    fontWeight={600}
                    fontFamily="var(--font-sans)"
                  >
                    {unreached ? 'Not reached yet' : ni.name}
                  </text>
                  {isKey && (
                    <text
                      x={12}
                      y={headH + 12}
                      fill="var(--warn)"
                      fontSize={10}
                      fontWeight={600}
                      fontFamily="var(--font-sans)"
                    >
                      ★ Keystone ({downCount} enables)
                    </text>
                  )}
                  {lines.map((line, i) => (
                    <text
                      key={i}
                      x={12}
                      y={headH + keyH + 12 + i * 15}
                      fill="var(--text-secondary)"
                      fontSize={11}
                      fontFamily="var(--font-sans)"
                    >
                      {line}
                    </text>
                  ))}
                  {enables.length > 0 && (
                    <text
                      x={12}
                      y={headH + keyH + descH + 15}
                      fill="var(--text-muted)"
                      fontSize={10.5}
                      fontWeight={600}
                      fontFamily="var(--font-sans)"
                    >
                      Enables
                    </text>
                  )}
                  {enables.map((did, i) => {
                    const dep = items.find(it => it.id === did);
                    const label = dep
                      ? dep.name.length > 22
                        ? dep.name.slice(0, 20) + '…'
                        : dep.name
                      : did;
                    return (
                      <text
                        key={did}
                        x={14}
                        y={headH + keyH + descH + 30 + i * 15}
                        fill="var(--text-primary)"
                        fontSize={11}
                        fontFamily="var(--font-sans)"
                      >
                        {label}
                      </text>
                    );
                  })}
                  {hoverDownstream.length > 4 && (
                    <text
                      x={14}
                      y={boxH - hintH - 6}
                      fill="var(--text-muted)"
                      fontSize={10}
                      fontFamily="var(--font-sans)"
                    >
                      +{hoverDownstream.length - 4} more
                    </text>
                  )}
                  <text
                    x={12}
                    y={boxH - 7}
                    fill="var(--accent)"
                    fontSize={10}
                    fontFamily="var(--font-sans)"
                  >
                    {hint}
                  </text>
                </g>
              );
            })()}

          {/* Legend. Clicking an entry spotlights the nodes it describes. */}
          <g transform={`translate(${START_X}, ${contentHeight - 35})`}>
            <line
              x1={0}
              y1={-8}
              x2={colOrder.length * COL_W - 40}
              y2={-8}
              stroke="var(--border)"
              strokeWidth={1}
            />
            {legend.map((l, i) => {
              // The heat scale is a ramp, so its swatches sit close together and
              // read as one object rather than as five separate keys.
              const lx =
                activeLens === 'attention' ? (i === 0 ? 10 : 150 + (i - 1) * 62) : 10 + i * 112;
              const clickable = Boolean(SPOTLIGHTS[l.label]);
              const isLegendActive = spotlight === l.label;
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: Legend items trigger interactive filtering
                <g
                  key={l.label}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  aria-label={
                    clickable
                      ? isLegendActive
                        ? 'Show every node again'
                        : `Highlight ${l.label}`
                      : undefined
                  }
                  onKeyDown={e => {
                    if (clickable && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      setSpotlight(spotlight === l.label ? null : l.label);
                    }
                  }}
                  transform={`translate(${lx}, 8)`}
                  style={{
                    cursor: clickable ? 'pointer' : 'default',
                    opacity: spotlight && !isLegendActive ? 0.45 : 1,
                  }}
                  onClick={() => {
                    if (clickable) setSpotlight(spotlight === l.label ? null : l.label);
                  }}
                >
                  {(clickable || LEGEND_CONCEPTS[l.label]) && (
                    <title>
                      {termTitle(
                        LEGEND_CONCEPTS[l.label] ?? '',
                        clickable
                          ? isLegendActive
                            ? 'Click to show everything again'
                            : `Click to highlight ${l.label}`
                          : undefined
                      )}
                    </title>
                  )}
                  {l.kind === 'node' && (
                    <>
                      <circle
                        r={7}
                        fill={l.color}
                        opacity={0.9}
                        stroke={isLegendActive ? 'var(--on-accent)' : 'none'}
                        strokeWidth={isLegendActive ? 2 : 0}
                      />
                      {l.sym && (
                        <text
                          y={3}
                          textAnchor="middle"
                          fill="var(--on-accent)"
                          fontSize={9.5}
                          fontWeight={700}
                        >
                          {l.sym}
                        </text>
                      )}
                    </>
                  )}
                  {l.kind === 'ring' && (
                    <circle
                      r={7}
                      fill="var(--accent-soft)"
                      stroke="var(--accent)"
                      strokeWidth={2.5}
                    />
                  )}
                  {l.kind === 'faded' && (
                    <circle
                      r={7}
                      fill="var(--bg-canvas)"
                      stroke="var(--text-muted)"
                      strokeWidth={1.25}
                      strokeDasharray="3,2"
                    />
                  )}
                  {l.kind === 'square' && (
                    <rect
                      x={-8}
                      y={-8}
                      width={16}
                      height={16}
                      rx={3}
                      fill="none"
                      stroke="rgba(245, 158, 11, 0.7)"
                      strokeWidth={1.5}
                      strokeDasharray="3,2"
                    />
                  )}
                  {l.kind === 'label' && null}
                  {l.kind === 'line' && (
                    <line
                      x1={-10}
                      y1={0}
                      x2={10}
                      y2={0}
                      stroke={l.color ?? (l.dashed ? 'var(--text-muted)' : 'var(--accent)')}
                      strokeWidth={1.5}
                      strokeDasharray={l.dashed ? '4,3' : 'none'}
                    />
                  )}
                  <text
                    x={l.kind === 'label' ? 0 : 12}
                    y={3.5}
                    fill={isLegendActive ? 'var(--accent)' : 'var(--text-secondary)'}
                    fontSize={10.5}
                    fontWeight={isLegendActive ? 600 : 400}
                    fontFamily="var(--font-sans)"
                    // Dotted, not solid: it marks the key as operable without
                    // claiming to be a hyperlink to somewhere else.
                    textDecoration={clickable ? 'underline dotted' : undefined}
                  >
                    {l.label}
                  </text>
                </g>
              );
            })}
            {spotlight ? (
              // biome-ignore lint/a11y/useSemanticElements: an HTML button cannot live inside an SVG; role, tabIndex and a key handler are on the group
              <g
                role="button"
                tabIndex={0}
                transform={`translate(${10 + legendCount * 112}, 8)`}
                style={{ cursor: 'pointer' }}
                aria-label="Show every node again"
                onClick={() => setSpotlight(null)}
                onKeyDown={e => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  setSpotlight(null);
                }}
              >
                <text y={3.5} fill="var(--accent)" fontSize={10.5} fontFamily="var(--font-sans)">
                  {spotlight} only — show all (Esc)
                </text>
              </g>
            ) : (
              hasSpotlights && (
                <text
                  transform={`translate(${10 + legendCount * 112}, 8)`}
                  y={3.5}
                  fill="var(--text-muted)"
                  fontSize={10.5}
                  fontFamily="var(--font-sans)"
                >
                  click a key to highlight
                </text>
              )
            )}
          </g>
        </svg>
      </div>
    </div>
  );
}
