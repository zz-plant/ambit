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
  eraOf,
  isNext,
  layoutNodes,
  NODE_R,
  ROW_H,
  sceneSize,
  START_X,
  START_Y,
  type TypeFilter,
  visibleItems,
} from './civ/layout.ts';
import { SimulationBanner } from './civ/SimulationBanner.tsx';
import { ZoomHud } from './civ/ZoomHud.tsx';

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
  // Owned by the store so the HUD can render the control; see App.tsx.
  const filter = useAmbitStore(s => s.treeFilter) as TypeFilter;
  const activeLens = useAmbitStore(s => s.activeLens);
  const setActiveLens = useAmbitStore(s => s.setActiveLens);
  const simulationMode = useAmbitStore(s => s.simulationMode);
  const simulatedNodeId = useAmbitStore(s => s.simulatedNodeId);
  const simulatedCascadeIds = useAmbitStore(s => s.simulatedCascadeIds);
  const clearSimulation = useAmbitStore(s => s.clearSimulation);
  const attentionInterventions = useAmbitStore(s => s.attentionInterventions);
  // The top of the scale the lens is drawn against, and the number its legend
  // prints. Taken from the data so the ramp spans what is actually there.
  const attentionMax = React.useMemo(
    () => Math.max(0, ...Object.values(attentionInterventions ?? {}).map(Number)),
    [attentionInterventions]
  );

  const simulatedItem = items.find(i => i.id === simulatedNodeId);

  const { downstream, upstream, chainIds } = useMemo(
    () => buildAdjacency(connections, selectedId),
    [connections, selectedId]
  );

  const filtered = useMemo(() => visibleItems(items, filter), [items, filter]);

  const [hoverItem, setHoverItem] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = React.useRef<{
    scrollLeft: number;
    scrollTop: number;
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const [spotlightGroup, setSpotlightGroup] = useState<string | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);

  const { cols, colOrder } = useMemo(() => buildColumns(filtered), [filtered]);

  const nodePositionMap = useMemo(() => layoutNodes({ cols, colOrder }), [cols, colOrder]);

  // The tree view is one kind of node in era columns; the setup view is many
  // kinds in domain columns. The legend and the spotlights follow.
  const isTreeView = filtered.some(i => eraOf(i) !== undefined);
  const lifecycleOf = (item: Item) => (item.meta?.lifecycle as string | undefined) ?? '';
  const keystone = (item: Item) =>
    (downstream.get(item.id) || []).length >= 3 || isRuntimeNode(item);
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
  const hoverTarget = hoverItem || hoveredId;
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
        setActiveLens('attention');
      } else if (e.key === '3') {
        setActiveLens('credentials');
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
        const idx = items.findIndex(i => i.id === selectedId);
        const nextIdx = idx < 0 ? 0 : (idx + 1) % items.length;
        onSelect(items[nextIdx].id);
      } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = items.findIndex(i => i.id === selectedId);
        const prevIdx = idx <= 0 ? items.length - 1 : idx - 1;
        onSelect(items[prevIdx].id);
      } else if (e.key === 'Escape') {
        if (spotlightGroup) setSpotlightGroup(null);
        else if (simulationMode !== 'none') clearSimulation();
        else if (selectedId) onSelect(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveLens, clearSimulation, simulationMode, selectedId, onSelect, items, spotlightGroup]);

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

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Dragging to pan is a pointer affordance layered over the canvas. Content inside is keyboard operable.
    <div
      ref={containerRef}
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
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'auto',
        paddingLeft: leftInset,
        cursor: isDragging ? 'grabbing' : 'default',
        userSelect: isDragging ? 'none' : 'auto',
      }}
    >
      <ZoomHud
        zoom={zoom}
        setZoom={setZoom}
        containerRef={containerRef}
        contentWidth={contentWidth}
        contentHeight={contentHeight}
        activeLens={activeLens}
        onSetLens={setActiveLens}
        rightInset={rightInset}
      />

      <SimulationBanner
        simulationMode={simulationMode}
        simulatedNodeId={simulatedNodeId}
        simulatedItem={simulatedItem}
        simulatedCascadeIds={simulatedCascadeIds}
        clearSimulation={clearSimulation}
        rightInset={rightInset}
      />
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
                height={32}
                fill="rgba(255, 255, 255, 0.02)"
                rx={10}
              />
              <text
                x={x + COL_W / 2 - 16}
                y={START_Y - 24}
                textAnchor="middle"
                fill="var(--text-primary)"
                fontSize={12}
                fontWeight={600}
                letterSpacing={0.5}
                style={{ fontFamily: 'var(--font-sans)' }}
              >
                {columnLabel(d, cols[d] || [])}
              </text>
              <text
                x={x + COL_W / 2 - 16}
                y={START_Y - 10}
                textAnchor="middle"
                fill="var(--text-muted)"
                fontSize={10}
                fontWeight={500}
                letterSpacing={0.5}
                style={{ fontFamily: 'var(--font-sans)' }}
              >
                {d.startsWith('era:') ? `Era ${d.slice(4)}` : (d || '').toLowerCase()}
              </text>
            </g>
          );
        })}

        {/* Connection lines — rendered behind nodes */}
        {connections.map((conn, i) => {
          const fromPos = nodePositionMap.get(conn.from);
          const toPos = nodePositionMap.get(conn.to);
          if (!fromPos || !toPos) return null;
          const x1 = fromPos.x;
          const y1 = fromPos.y;
          const x2 = toPos.x;
          const y2 = toPos.y;
          const isHard = conn.type === 'hard-dep';
          const isSoft = conn.type === 'soft-dep';
          const inChain = chainIds.size > 0 && chainIds.has(conn.from) && chainIds.has(conn.to);
          const isSimLine =
            simulationMode !== 'none' &&
            ((simulatedNodeId === conn.from && simulatedCascadeIds.has(conn.to)) ||
              (simulatedCascadeIds.has(conn.from) && simulatedCascadeIds.has(conn.to)));
          const op = isSimLine
            ? 1
            : simulationMode !== 'none'
              ? 0.08
              : chainIds.size > 0
                ? inChain
                  ? 0.95
                  : 0.08
                : 0.35;
          const strokeColor = isSimLine
            ? simulationMode === 'outage'
              ? 'var(--error)'
              : 'var(--ok)'
            : inChain
              ? 'var(--accent)'
              : isHard
                ? 'rgba(99, 102, 241, 0.6)'
                : isSoft
                  ? 'rgba(148, 163, 184, 0.4)'
                  : 'var(--warn)';

          return (
            <line
              key={`c-${i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={strokeColor}
              strokeWidth={isSimLine ? 2.5 : inChain ? 2 : isHard ? 1.5 : 1}
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
                const inChain = chainIds.has(item.id);
                const selected = item.id === selectedId;

                const isSimRoot = simulationMode !== 'none' && simulatedNodeId === item.id;
                const isSimAffected = simulationMode !== 'none' && simulatedCascadeIds.has(item.id);
                const isSimDimmed = simulationMode !== 'none' && !isSimRoot && !isSimAffected;

                const interventionCount = attentionInterventions[item.id] || 0;
                const isAttentionHot = activeLens === 'attention' && interventionCount > 0;
                const heat = heatStep(interventionCount, attentionMax);
                const isSpofHot =
                  activeLens === 'credentials' &&
                  (item.id.includes('github') ||
                    item.id.includes('docker') ||
                    item.id.includes('1password') ||
                    item.id.includes('credential'));

                const isKeystone = keystone(item);

                const next = isNext(item);
                const reached = item.status === 'built';
                const upList = upstream.get(item.id) || [];
                const builtPrereqs = upList.filter(
                  id => items.find(i => i.id === id)?.status === 'built'
                ).length;
                const totalPrereqs = upList.length;
                const readinessPct = totalPrereqs > 0 ? builtPrereqs / totalPrereqs : 1;
                const hasEureka = next && builtPrereqs > 0 && totalPrereqs > 1;

                const isSpotlit = !spotlightGroup || (SPOTLIGHTS[spotlightGroup]?.(item) ?? true);

                const dimmed = (chainIds.size > 0 && !inChain) || isSimDimmed || !isSpotlit;
                const baseOpacity =
                  isSimRoot || isSimAffected
                    ? 1
                    : !isSpotlit
                      ? 0.15
                      : dimmed
                        ? 0.2
                        : reached
                          ? 1
                          : next
                            ? 0.95
                            : 0.4;

                let nodeFill = reached ? defaultColor : 'var(--bg-elevated)';
                let sc =
                  inChain && !selected
                    ? 'var(--accent)'
                    : selected
                      ? 'var(--on-accent)'
                      : reached
                        ? defaultColor
                        : 'var(--border-subtle)';
                let sw = inChain ? 2.5 : selected ? 2.5 : reached ? 1.5 : 1;

                if (simulationMode === 'outage') {
                  if (isSimRoot) {
                    nodeFill = 'var(--error)';
                    sc = 'var(--on-accent)';
                    sw = 2.5;
                  } else if (isSimAffected) {
                    nodeFill = 'var(--error-deep)';
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
                } else if (isSpofHot) {
                  nodeFill = 'var(--plasma)';
                  sc = 'var(--warn)';
                  sw = 2;
                }

                const sym = typeSymbol(item.type);
                const label = item.name.length > 20 ? item.name.slice(0, 18) + '…' : item.name;
                const dialRadius = NODE_R + 6;
                const dialCircumference = 2 * Math.PI * dialRadius;

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
                        stroke="rgba(245, 158, 11, 0.4)"
                        strokeWidth={1.5}
                        strokeDasharray="4,3"
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

                    {next && !dimmed && !isSimAffected && (
                      <>
                        <circle
                          r={dialRadius}
                          fill="none"
                          stroke="rgba(255, 255, 255, 0.1)"
                          strokeWidth={2.5}
                        />
                        <circle
                          r={dialRadius}
                          fill="none"
                          stroke={readinessPct >= 1 ? 'var(--ok)' : 'var(--accent)'}
                          strokeWidth={2.5}
                          strokeDasharray={`${dialCircumference * readinessPct} ${dialCircumference}`}
                          strokeDashoffset={0}
                          transform="rotate(-90)"
                          strokeLinecap="round"
                        />
                        {costOf(item) && (
                          <text
                            x={NODE_R + 6}
                            y={-NODE_R + 4}
                            textAnchor="start"
                            fill="var(--text-muted)"
                            fontSize={10}
                            fontWeight={600}
                            fontFamily="var(--font-sans)"
                          >
                            {costOf(item)}
                          </text>
                        )}
                        {hasEureka && (
                          <g transform={`translate(0, ${-NODE_R - 12})`}>
                            <rect
                              x={-20}
                              y={-7}
                              width={40}
                              height={14}
                              rx={4}
                              fill="rgba(245, 158, 11, 0.15)"
                              stroke="var(--warn)"
                              strokeWidth={1}
                            />
                            <text
                              y={3}
                              textAnchor="middle"
                              fill="var(--warn)"
                              fontSize={8.5}
                              fontWeight={700}
                              fontFamily="var(--font-sans)"
                            >
                              Boost
                            </text>
                          </g>
                        )}
                      </>
                    )}

                    <circle
                      r={NODE_R}
                      fill={nodeFill}
                      stroke={next ? 'var(--accent)' : sc}
                      strokeWidth={next ? 2 : sw}
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
                    <text
                      y={NODE_R + 16}
                      textAnchor="middle"
                      fill={dimmed ? 'var(--text-muted)' : 'var(--text-primary)'}
                      fontSize={11.5}
                      fontWeight={500}
                      fontFamily="var(--font-sans)"
                    >
                      {label}
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
            const boxH = headH + keyH + descH + enablesH + 12;

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
                    y={boxH - 6}
                    fill="var(--text-muted)"
                    fontSize={10}
                    fontFamily="var(--font-sans)"
                  >
                    +{hoverDownstream.length - 4} more
                  </text>
                )}
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
          {(activeLens === 'attention'
            ? [
                // A scale with no unit is a row of coloured dots. Say what is
                // being counted, once, at the head of the ramp.
                { kind: 'label' as const, label: 'Interventions a month' },
                ...heatBins(attentionMax).map((b, i) => ({
                  kind: 'node' as const,
                  color: `var(--heat-${i + 1})`,
                  label: b.label,
                })),
              ]
            : activeLens === 'credentials'
              ? [
                  {
                    kind: 'node' as const,
                    color: 'var(--plasma)',
                    label: 'Shares a credential',
                  },
                  { kind: 'faded' as const, label: 'Fails alone' },
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
                  ]
                : [
                    { kind: 'node', color: typeColor('mcp-server'), sym: '◈', label: 'Server' },
                    { kind: 'node', color: typeColor('agent'), sym: '◆', label: 'Agent' },
                    { kind: 'node', color: typeColor('skill'), sym: '◇', label: 'Skill' },
                    { kind: 'node', color: typeColor('possibility'), sym: '●', label: 'Combo' },
                    { kind: 'square', label: 'Keystone' },
                    { kind: 'node', color: 'var(--ok)', sym: '✓', label: 'Passing' },
                    { kind: 'node', color: 'var(--error)', sym: '!', label: 'Failing' },
                    { kind: 'line', label: 'Required' },
                    { kind: 'line', dashed: true, label: 'Optional' },
                  ]
          ).map((l: any, i: number) => {
            // The heat scale is a ramp, so its swatches sit close together and
            // read as one object rather than as five separate keys.
            const lx =
              activeLens === 'attention' ? (i === 0 ? 10 : 150 + (i - 1) * 62) : 10 + i * 112;
            const clickable = Boolean(SPOTLIGHTS[l.label]);
            const isLegendActive = spotlightGroup === l.label;
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: Legend items trigger interactive filtering
              <g
                key={l.label}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                aria-label={clickable ? `Highlight ${l.label}` : undefined}
                onKeyDown={e => {
                  if (clickable && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    setSpotlightGroup(curr => (curr === l.label ? null : l.label));
                  }
                }}
                transform={`translate(${lx}, 8)`}
                style={{
                  cursor: clickable ? 'pointer' : 'default',
                  opacity: spotlightGroup && !isLegendActive ? 0.45 : 1,
                }}
                onClick={() => {
                  if (clickable) setSpotlightGroup(curr => (curr === l.label ? null : l.label));
                }}
              >
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
                  <circle r={7} fill="var(--bg-elevated)" stroke="var(--accent)" strokeWidth={2} />
                )}
                {l.kind === 'faded' && (
                  <circle
                    r={7}
                    fill="var(--bg-elevated)"
                    stroke="var(--border-bright)"
                    strokeWidth={1}
                    opacity={0.7}
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
                    stroke={l.dashed ? 'var(--text-muted)' : 'var(--accent)'}
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
                >
                  {l.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
