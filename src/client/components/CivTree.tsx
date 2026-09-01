import React, { useMemo, useState } from 'react';
import type { Item, Connection } from '../utils/configImporter';
import { useToolchainStore } from '../store/toolchainStore';
import { isRuntimeNode } from '../utils/labels';

const TYPE_FILTERS = ['all', 'server', 'agent', 'skill', 'combo'] as const;
type Filter = (typeof TYPE_FILTERS)[number];

const DOMAIN_ORDER = [
  'physical',
  'infra',
  'devops',
  'backend',
  'frontend',
  'ai-ml',
  'quality',
  'meta',
  'security',
];
const ERA_LABELS: Record<string, string> = {
  physical: 'Physical',
  infra: 'Foundation',
  devops: 'Pipeline',
  backend: 'Services',
  frontend: 'Interface',
  'ai-ml': 'Intelligence',
  quality: 'Guard',
  meta: 'Orchestration',
  security: 'Fortress',
};
/** meta is an untyped bag; these narrow the two fields the tree reads. */
const domainOf = (item: Item): string => (item.meta?.domain as string) || 'meta';
/** Tech-tree items carry an era; config items fall back to their domain. */
const eraOf = (item: Item): number | undefined =>
  typeof item.meta?.era === 'number' ? (item.meta.era as number) : undefined;
const columnOf = (item: Item): string => {
  const era = eraOf(item);
  return era ? `era:${era}` : domainOf(item);
};
const columnLabel = (key: string, items: Item[]): string => {
  if (!key.startsWith('era:')) return ERA_LABELS[key] || key;
  const named = items.find(i => i.meta?.eraName);
  return (named?.meta?.eraName as string) || `Era ${key.slice(4)}`;
};
/** Prerequisites met, nothing detected — the frontier you can take next. */
const isNext = (item: Item): boolean => item.meta?.next === true;
const costOf = (item: Item): string => {
  const s = Number(item.meta?.setupSeconds) || 0;
  if (!s) return '';
  return s >= 3600 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 60)}m`;
};

const NODE_R = 28,
  COL_W = 170,
  ROW_H = 105,
  START_X = 90,
  START_Y = 70;

interface CivTreeProps {
  /** Pixels of the scene covered by the docked panel, so column one is visible. */
  leftInset?: number;
  items: Item[];
  connections: Connection[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}

export default function CivTree({
  items,
  connections,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  leftInset = 0,
}: CivTreeProps) {
  // Owned by the store so the HUD can render the control; see App.tsx.
  const filter = useToolchainStore(s => s.treeFilter) as Filter;
  const activeLens = useToolchainStore(s => s.activeLens);
  const setActiveLens = useToolchainStore(s => s.setActiveLens);
  const simulationMode = useToolchainStore(s => s.simulationMode);
  const simulatedNodeId = useToolchainStore(s => s.simulatedNodeId);
  const simulatedCascadeIds = useToolchainStore(s => s.simulatedCascadeIds);
  const clearSimulation = useToolchainStore(s => s.clearSimulation);
  const attentionInterventions = useToolchainStore(s => s.attentionInterventions);

  const simulatedItem = items.find(i => i.id === simulatedNodeId);

  const { downstream, upstream, chainIds } = useMemo(() => {
    const down = new Map<string, string[]>(),
      up = new Map<string, string[]>();
    for (const c of connections) {
      if (!down.has(c.from)) down.set(c.from, []);
      down.get(c.from)!.push(c.to);
      if (!up.has(c.to)) up.set(c.to, []);
      up.get(c.to)!.push(c.from);
    }
    const chain = new Set<string>();
    if (selectedId) {
      const q = [selectedId];
      while (q.length) {
        const id = q.shift();
        if (!id || chain.has(id)) continue;
        chain.add(id);
        for (const n of down.get(id) || []) q.push(n);
        for (const n of up.get(id) || []) q.push(n);
      }
    }
    return { downstream: down, upstream: up, chainIds: chain };
  }, [connections, selectedId]);

  const filtered = useMemo(() => {
    // If any item carries an era we are looking at the tech tree; show that
    // alone, so the columns mean one thing and prerequisites read left to right.
    const eraItems = items.filter(i => eraOf(i) !== undefined);
    if (eraItems.length > 0) return eraItems;
    if (filter === 'all') return items;
    const tm: Record<string, string> = {
      server: 'mcp-server',
      agent: 'agent',
      skill: 'skill',
      combo: 'possibility',
    };
    return items.filter(i => i.type === tm[filter] || i.type === 'framework');
  }, [items, filter]);

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

  const { cols, colOrder } = useMemo(() => {
    const c: Record<string, Item[]> = {};
    for (const item of filtered) {
      const d = columnOf(item);
      if (!c[d]) c[d] = [];
      c[d].push(item);
    }
    // Eras run in numeric order so the tree reads left to right, oldest first.
    const eras = Object.keys(c)
      .filter(k => k.startsWith('era:'))
      .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
    const order = [...eras, ...DOMAIN_ORDER.filter(d => c[d]?.length)];
    for (const d of Object.keys(c)) if (!order.includes(d)) order.push(d);
    return { cols: c, colOrder: order };
  }, [filtered]);

  const nodePositionMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number; item: Item }>();
    colOrder.forEach((domain, ci) => {
      const caps = cols[domain] || [];
      const cx = START_X + ci * COL_W + COL_W / 2 - 40;
      caps.forEach((it, ri) => {
        const cy = START_Y + ri * ROW_H + NODE_R;
        map.set(it.id, { x: cx, y: cy, item: it });
      });
    });
    return map;
  }, [cols, colOrder]);

  const COLORS: Record<string, string> = {
    framework: '#00f0ff',
    runtime: '#00f0ff',
    'mcp-server': '#ffaa00',
    agent: '#ff007f',
    skill: '#00ff88',
    provider: '#38bdf8',
    combo: '#b537f2',
    possibility: '#b537f2',
    tool: '#e08a00',
    device: '#00ffcc',
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

  const contentHeight =
    Math.max(...colOrder.map(d => (cols[d]?.length || 0) * ROW_H), 5) + START_Y + 60;
  const contentWidth = START_X + colOrder.length * COL_W + 60;

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
      {/* Floating Canvas Zoom & Pan HUD Controls */}
      <div className="civ-zoom-hud" role="toolbar" aria-label="Canvas zoom and pan controls">
        <button
          type="button"
          className="civ-zoom-btn"
          onClick={() => setZoom(z => Math.min(2.5, +(z + 0.2).toFixed(2)))}
          title="Zoom In (Hotkey: +)"
          aria-label="Zoom in"
        >
          +
        </button>
        <span className="civ-zoom-badge">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="civ-zoom-btn"
          onClick={() => setZoom(z => Math.max(0.4, +(z - 0.2).toFixed(2)))}
          title="Zoom Out (Hotkey: -)"
          aria-label="Zoom out"
        >
          −
        </button>
        <div className="civ-zoom-divider" />
        <button
          type="button"
          className="civ-zoom-btn"
          onClick={() => {
            setZoom(1);
            if (containerRef.current) {
              containerRef.current.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
            }
          }}
          title="Reset to 100% (Hotkey: 0)"
          aria-label="Reset zoom to 100%"
        >
          1:1
        </button>
        <button
          type="button"
          className="civ-zoom-btn"
          onClick={() => {
            if (containerRef.current) {
              const rect = containerRef.current.getBoundingClientRect();
              const fitRatio = Math.min(rect.width / contentWidth, rect.height / contentHeight);
              setZoom(Math.max(0.4, Math.min(1.5, +(fitRatio * 0.95).toFixed(2))));
              containerRef.current.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
            }
          }}
          title="Fit Graph to View"
          aria-label="Fit graph to view"
        >
          ⊡
        </button>
      </div>

      {/* Floating Simulation Banner */}
      {simulationMode !== 'none' && (
        <div
          style={{
            position: 'sticky',
            top: 56,
            left: 16,
            zIndex: 20,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '12px',
            background:
              simulationMode === 'outage'
                ? 'linear-gradient(90deg, #ff2a55, #880022)'
                : 'linear-gradient(90deg, #00f0ff, #0088cc)',
            color: '#ffffff',
            padding: '8px 16px',
            borderRadius: 'var(--radius)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
            border: '1px solid rgba(255,255,255,0.2)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <span
            style={{
              fontWeight: 700,
              fontSize: '12px',
              letterSpacing: '0.4px',
              fontFamily: 'var(--font)',
            }}
          >
            {simulationMode === 'outage'
              ? `⚡ BLAST RADIUS SIMULATION: Outage of "${simulatedItem?.name || simulatedNodeId}" disables ${simulatedCascadeIds.size} downstream capabilities.`
              : `✨ FRONTIER SIMULATION: Unlocking "${simulatedItem?.name || simulatedNodeId}" makes +${simulatedCascadeIds.size} compound capabilities reachable.`}
          </span>
          <button
            type="button"
            style={{
              background: '#ffffff',
              color: simulationMode === 'outage' ? '#ff2a55' : '#0088cc',
              border: 'none',
              borderRadius: 'var(--radius-xs)',
              padding: '4px 10px',
              cursor: 'pointer',
              fontWeight: 800,
              fontFamily: 'var(--font)',
              fontSize: '11px',
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
            }}
            onClick={clearSimulation}
          >
            ✕ Exit Simulation
          </button>
        </div>
      )}

      {/* Main SVG Vector Canvas */}
      <svg
        viewBox={`0 0 ${contentWidth} ${contentHeight}`}
        className="civ-tree-svg"
        style={{
          background: 'var(--bg-canvas)',
          width: `${contentWidth * zoom}px`,
          height: `${contentHeight * zoom}px`,
          minWidth: `${contentWidth * zoom}px`,
          transition: isDragging ? 'none' : 'width 0.12s ease-out, height 0.12s ease-out',
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
              ? '#f43f5e'
              : '#10b981'
            : inChain
              ? 'var(--accent)'
              : isHard
                ? 'rgba(99, 102, 241, 0.6)'
                : isSoft
                  ? 'rgba(148, 163, 184, 0.4)'
                  : '#f59e0b';

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
                const defaultColor = COLORS[item.type] || '#64748b';
                const inChain = chainIds.has(item.id);
                const selected = item.id === selectedId;

                const isSimRoot = simulationMode !== 'none' && simulatedNodeId === item.id;
                const isSimAffected = simulationMode !== 'none' && simulatedCascadeIds.has(item.id);
                const isSimDimmed = simulationMode !== 'none' && !isSimRoot && !isSimAffected;

                const interventionCount = attentionInterventions[item.id] || 0;
                const isAttentionHot = activeLens === 'attention' && interventionCount > 0;
                const isSpofHot =
                  activeLens === 'credentials' &&
                  (item.id.includes('github') ||
                    item.id.includes('docker') ||
                    item.id.includes('1password') ||
                    item.id.includes('credential'));

                const downList = downstream.get(item.id) || [];
                const isKeystone = downList.length >= 3 || isRuntimeNode(item);

                const next = isNext(item);
                const reached = item.status === 'built';
                const upList = upstream.get(item.id) || [];
                const builtPrereqs = upList.filter(
                  id => items.find(i => i.id === id)?.status === 'built'
                ).length;
                const totalPrereqs = upList.length;
                const readinessPct = totalPrereqs > 0 ? builtPrereqs / totalPrereqs : 1;
                const hasEureka = next && builtPrereqs > 0 && totalPrereqs > 1;

                const isSpotlit =
                  !spotlightGroup ||
                  (spotlightGroup === 'Framework'
                    ? item.type === 'framework'
                    : spotlightGroup === 'Server'
                      ? item.type === 'mcp-server'
                      : spotlightGroup === 'Agent'
                        ? item.type === 'agent'
                        : spotlightGroup === 'Skill'
                          ? item.type === 'skill'
                          : spotlightGroup === 'Combo'
                            ? item.type === 'possibility'
                            : spotlightGroup === 'Keystone'
                              ? isKeystone
                              : spotlightGroup === 'Passing'
                                ? ['verified', 'reliable'].includes(item.meta?.lifecycle as string)
                                : spotlightGroup === 'Failing'
                                  ? ['degraded', 'broken'].includes(item.meta?.lifecycle as string)
                                  : true);

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

                let nodeFill = reached ? defaultColor : '#1e293b';
                let sc =
                  inChain && !selected
                    ? 'var(--accent)'
                    : selected
                      ? '#ffffff'
                      : reached
                        ? defaultColor
                        : 'var(--border-subtle)';
                let sw = inChain ? 2.5 : selected ? 2.5 : reached ? 1.5 : 1;

                if (simulationMode === 'outage') {
                  if (isSimRoot) {
                    nodeFill = '#f43f5e';
                    sc = '#ffffff';
                    sw = 2.5;
                  } else if (isSimAffected) {
                    nodeFill = '#e11d48';
                    sc = '#ffffff';
                    sw = 2;
                  }
                } else if (simulationMode === 'acquisition') {
                  if (isSimRoot) {
                    nodeFill = '#6366f1';
                    sc = '#ffffff';
                    sw = 2.5;
                  } else if (isSimAffected) {
                    nodeFill = '#10b981';
                    sc = '#ffffff';
                    sw = 2;
                  }
                } else if (isAttentionHot) {
                  nodeFill = interventionCount > 20 ? '#ef4444' : '#f59e0b';
                  sc = '#ffffff';
                  sw = 2;
                } else if (isSpofHot) {
                  nodeFill = '#8b5cf6';
                  sc = '#f59e0b';
                  sw = 2;
                }

                const sym =
                  item.type === 'framework'
                    ? '★'
                    : item.type === 'mcp-server'
                      ? '◈'
                      : item.type === 'agent'
                        ? '◆'
                        : item.type === 'skill'
                          ? '◇'
                          : '●';
                const label = item.name.length > 20 ? item.name.slice(0, 18) + '…' : item.name;
                const dialRadius = NODE_R + 6;
                const dialCircumference = 2 * Math.PI * dialRadius;

                return (
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
                      fill={reached ? '#ffffff' : dimmed ? 'var(--text-muted)' : '#ffffff'}
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
                            fill="#10b981"
                            stroke="var(--bg-canvas)"
                            strokeWidth={1.5}
                          />
                          <text
                            y={3}
                            textAnchor="middle"
                            fill="#ffffff"
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
                            fill="#f43f5e"
                            stroke="var(--bg-canvas)"
                            strokeWidth={1.5}
                          />
                          <text
                            y={3}
                            textAnchor="middle"
                            fill="#ffffff"
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

        {/* Legend */}
        <g transform={`translate(${START_X}, ${contentHeight - 35})`}>
          <line
            x1={0}
            y1={-8}
            x2={colOrder.length * COL_W - 40}
            y2={-8}
            stroke="var(--border)"
            strokeWidth={1}
          />
          {[
            { color: 'var(--accent)', sym: '★', label: 'Framework' },
            { color: '#f59e0b', sym: '◈', label: 'Server' },
            { color: '#ec4899', sym: '◆', label: 'Agent' },
            { color: '#10b981', sym: '◇', label: 'Skill' },
            { color: '#8b5cf6', sym: '●', label: 'Combo' },
            { color: '#f59e0b', sym: '👑', label: 'Keystone' },
            { color: '#10b981', sym: '✓', label: 'Passing' },
            { color: '#f43f5e', sym: '!', label: 'Failing' },
            { stroke: 'var(--accent)', style: 'solid', label: 'Required' },
            { stroke: 'var(--text-muted)', style: 'dashed', label: 'Optional' },
          ].map((l, i) => {
            const lx = 10 + i * 115;
            const isLegendActive = spotlightGroup === l.label;
            return (
              <g
                key={i}
                transform={`translate(${lx}, 8)`}
                style={{
                  cursor: l.color ? 'pointer' : 'default',
                  opacity: spotlightGroup && !isLegendActive ? 0.45 : 1,
                }}
                onClick={() => {
                  if (l.color) setSpotlightGroup(curr => (curr === l.label ? null : l.label));
                }}
              >
                {l.color ? (
                  <>
                    <circle
                      r={7}
                      fill={l.color}
                      opacity={0.9}
                      stroke={isLegendActive ? '#ffffff' : 'none'}
                      strokeWidth={isLegendActive ? 2 : 0}
                    />
                    <text y={3} textAnchor="middle" fill="#ffffff" fontSize={9.5} fontWeight={700}>
                      {l.sym}
                    </text>
                  </>
                ) : (
                  <line
                    x1={-10}
                    y1={0}
                    x2={10}
                    y2={0}
                    stroke={l.stroke}
                    strokeWidth={1.5}
                    strokeDasharray={l.style === 'dashed' ? '4,3' : 'none'}
                  />
                )}
                <text
                  x={12}
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
