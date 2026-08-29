import React, { useMemo, useState } from 'react';
import type { Item, Connection } from '../utils/configImporter';
import { useToolchainStore } from '../store/toolchainStore';

const TYPE_FILTERS = ['all', 'server', 'agent', 'skill', 'combo'] as const;
type Filter = typeof TYPE_FILTERS[number];

const DOMAIN_ORDER = ['physical', 'infra', 'devops', 'backend', 'frontend', 'ai-ml', 'quality', 'meta', 'security'];
const ERA_LABELS: Record<string, string> = { physical:'Physical', infra:'Foundation', devops:'Pipeline', backend:'Services', frontend:'Interface', 'ai-ml':'Intelligence', quality:'Guard', meta:'Orchestration', security:'Fortress' };
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

const NODE_R = 28, COL_W = 170, ROW_H = 105, START_X = 90, START_Y = 70;

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

export default function CivTree({ items, connections, selectedId, hoveredId, onSelect, onHover, leftInset = 0 }: CivTreeProps) {
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

  const { downstream, chainIds } = useMemo(() => {
    const down = new Map<string, string[]>(), up = new Map<string, string[]>();
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
        for (const n of (down.get(id) || [])) q.push(n);
        for (const n of (up.get(id) || [])) q.push(n);
      }
    }
    return { downstream: down, chainIds: chain };
  }, [connections, selectedId]);

  const filtered = useMemo(() => {
    // If any item carries an era we are looking at the tech tree; show that
    // alone, so the columns mean one thing and prerequisites read left to right.
    const eraItems = items.filter(i => eraOf(i) !== undefined);
    if (eraItems.length > 0) return eraItems;
    if (filter === 'all') return items;
    const tm: Record<string, string> = { server: 'mcp-server', agent: 'agent', skill: 'skill', combo: 'possibility' };
    return items.filter(i => i.type === tm[filter] || i.type === 'framework');
  }, [items, filter]);

  const [hoverItem, setHoverItem] = useState<string | null>(null);

  const { cols, colOrder } = useMemo(() => {
    const c: Record<string, Item[]> = {};
    if (activeLens === 'topology') {
      // Group by host / topology
      for (const item of filtered) {
        const hostKey = item.type === 'device' ? 'device:local' : (item.meta?.domain === 'physical' ? 'Physical Nodes' : (item.meta?.domain === 'infra' ? 'Local Host' : 'Cloud / Edge'));
        if (!c[hostKey]) c[hostKey] = [];
        c[hostKey].push(item);
      }
      return { cols: c, colOrder: Object.keys(c) };
    }

    for (const item of filtered) {
      const d = columnOf(item);
      if (!c[d]) c[d] = [];
      c[d].push(item);
    }
    // Eras run in numeric order so the tree reads left to right, oldest first.
    const eras = Object.keys(c).filter(k => k.startsWith('era:'))
      .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
    const order = [...eras, ...DOMAIN_ORDER.filter(d => c[d]?.length)];
    for (const d of Object.keys(c)) if (!order.includes(d)) order.push(d);
    return { cols: c, colOrder: order };
  }, [filtered, activeLens]);

  const COLORS: Record<string, string> = { framework: '#b8860b', 'mcp-server': '#daa520', agent: '#cd853f', skill: '#6b8e23', provider: '#a0853c', combo: '#b87333', possibility: '#b87333', tool: '#a0522d' };
  const hoverTarget = hoverItem || hoveredId;
  const hoverDownstream = hoverTarget ? downstream.get(hoverTarget) || [] : [];

  const contentHeight = Math.max(...colOrder.map(d => (cols[d]?.length || 0) * ROW_H), 5) + START_Y + 40;
  const contentWidth = START_X + colOrder.length * COL_W + 60;

  return (
    <div style={{ position:'relative', width:'100%', height:'100%', overflow:'auto', paddingLeft: leftInset }}>

      {/* Interactive Lens Switcher Toolbar */}
      <div style={{
        position: 'sticky',
        top: 12,
        left: 16,
        zIndex: 20,
        display: 'inline-flex',
        gap: '6px',
        background: 'rgba(245, 230, 200, 0.95)',
        padding: '6px 10px',
        borderRadius: '8px',
        border: '1px solid #c4a96a',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      }}>
        <button
          type="button"
          style={{
            background: activeLens === 'default' ? '#6b5b3a' : '#fff',
            color: activeLens === 'default' ? '#fff' : '#6b5b3a',
            border: '1px solid #c4a96a',
            borderRadius: '4px',
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
          onClick={() => setActiveLens('default')}
        >
          🗺️ Standard Tree
        </button>
        <button
          type="button"
          style={{
            background: activeLens === 'attention' ? '#e76f51' : '#fff',
            color: activeLens === 'attention' ? '#fff' : '#e76f51',
            border: '1px solid #e76f51',
            borderRadius: '4px',
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
          onClick={() => setActiveLens('attention')}
        >
          🔥 Attention Heatmap
        </button>
        <button
          type="button"
          style={{
            background: activeLens === 'credentials' ? '#7209b7' : '#fff',
            color: activeLens === 'credentials' ? '#fff' : '#7209b7',
            border: '1px solid #7209b7',
            borderRadius: '4px',
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
          onClick={() => setActiveLens('credentials')}
        >
          🛡️ Credential SPOFs
        </button>
        <button
          type="button"
          style={{
            background: activeLens === 'topology' ? '#2a9d8f' : '#fff',
            color: activeLens === 'topology' ? '#fff' : '#2a9d8f',
            border: '1px solid #2a9d8f',
            borderRadius: '4px',
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
          onClick={() => setActiveLens('topology')}
        >
          💻 Physical Hosts
        </button>
      </div>

      {/* Floating Simulation Banner */}
      {simulationMode !== 'none' && (
        <div style={{
          position: 'sticky',
          top: 56,
          left: 16,
          zIndex: 20,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '12px',
          background: simulationMode === 'outage' ? '#e63946' : '#2a9d8f',
          color: '#fff',
          padding: '8px 14px',
          borderRadius: '8px',
          boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
          fontWeight: 600,
          fontSize: '12px',
          marginTop: '6px',
        }}>
          <span>
            {simulationMode === 'outage'
              ? `⚡ BLAST RADIUS SIMULATION: Outage of "${simulatedItem?.name || simulatedNodeId}" disables ${simulatedCascadeIds.size} downstream capabilities.`
              : `✨ FRONTIER SIMULATION: Unlocking "${simulatedItem?.name || simulatedNodeId}" makes +${simulatedCascadeIds.size} compound capabilities reachable.`}
          </span>
          <button
            type="button"
            style={{
              background: '#fff',
              color: simulationMode === 'outage' ? '#e63946' : '#2a9d8f',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 10px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '11px',
            }}
            onClick={clearSimulation}
          >
            ✕ Exit Simulation
          </button>
        </div>
      )}

      {/* xMinYMin: the default centres the viewBox, and once the tallest column
          makes the graph taller than it is wide, that centring pushes every node
          below the fold — the canvas looks empty until you scroll past the gap. */}
      {/* height came from the viewBox rather than from how wide the svg
          actually rendered, so whenever width was the binding constraint —
          any phone — the tree scaled down to a strip at the top and left the
          rest of a full-height canvas empty. An aspect ratio ties the two
          together at every width. */}
      <svg width="100%" height="auto" preserveAspectRatio="xMinYMin meet"
        viewBox={`0 0 ${contentWidth} ${contentHeight}`}
        className="civ-tree-svg"
        style={{ background: '#f5e6c8', aspectRatio: `${contentWidth} / ${contentHeight}` }}>
        
        {/* Era column bands */}
        {colOrder.map((d, i) => {
          const x = START_X + i * COL_W;
          return (
            <g key={`band-${d}`}>
              <rect x={x - 5} y={START_Y - 45} width={COL_W - 20} height={contentHeight - START_Y + 20}
                fill={i % 2 === 0 ? '#f0dbb8' : '#f8ecd0'} rx={6} opacity={0.5}/>
              <text x={x + COL_W/2 - 40} y={START_Y - 22} textAnchor="middle" fill="#6b5b3a" fontSize={13} fontWeight={700}
                letterSpacing={2} style={{ textTransform: 'uppercase' }}>{columnLabel(d, cols[d] || [])}</text>
              <text x={x + COL_W/2 - 40} y={START_Y - 8} textAnchor="middle" fill="#9b8b6a" fontSize={12}>{d.startsWith('era:') ? `ERA ${d.slice(4)}` : (d || '').toUpperCase()}</text>
              <line x1={x + 10} y1={START_Y - 2} x2={x + COL_W - 50} y2={START_Y - 2} stroke="#c4a96a" strokeWidth={0.8}/>
            </g>
          );
        })}

        {/* Connection lines — rendered behind nodes */}
        {connections.map((conn, i) => {
          const from = items.find(it => it.id === conn.from);
          const to = items.find(it => it.id === conn.to);
          if (!from || !to) return null;
          const fd = columnOf(from);
          const td = columnOf(to);
          const fi = colOrder.indexOf(fd);
          const ti = colOrder.indexOf(td);
          const fa = (cols[fd] || []).findIndex((it: Item) => it.id === from.id);
          const ta = (cols[td] || []).findIndex((it: Item) => it.id === to.id);
          if (fi < 0 || ti < 0 || fa < 0 || ta < 0) return null;
          const x1 = START_X + fi * COL_W + COL_W/2 - 40;
          const y1 = START_Y + fa * ROW_H + NODE_R;
          const x2 = START_X + ti * COL_W + COL_W/2 - 40;
          const y2 = START_Y + ta * ROW_H + NODE_R;
          const isHard = conn.type === 'hard-dep';
          const isSoft = conn.type === 'soft-dep';
          const inChain = chainIds.size > 0 && chainIds.has(conn.from) && chainIds.has(conn.to);
          const isSimLine = simulationMode !== 'none' && (
            (simulatedNodeId === conn.from && simulatedCascadeIds.has(conn.to)) ||
            (simulatedCascadeIds.has(conn.from) && simulatedCascadeIds.has(conn.to))
          );
          const op = isSimLine ? 0.95 : simulationMode !== 'none' ? 0.05 : (chainIds.size > 0 ? (inChain ? 0.65 : 0.06) : 0.35);
          const strokeColor = isSimLine ? (simulationMode === 'outage' ? '#e63946' : '#2a9d8f') : (isHard ? '#8b6914' : isSoft ? '#b8a060' : '#d4a017');
          return <line key={`c-${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={strokeColor}
            strokeWidth={isSimLine ? 3 : (isHard ? 2 : 1.2)}
            strokeDasharray={isSimLine ? 'none' : (isHard ? 'none' : isSoft ? '6,3' : '2,4')}
            opacity={op}/>;
        })}

        {/* Nodes */}
        {colOrder.map((domain, ci) => {
          const caps = cols[domain] || [];
          const cx = START_X + ci * COL_W + COL_W/2 - 40;
          return (
            <g key={domain}>
              {caps.map((item, ri) => {
                const cy = START_Y + ri * ROW_H + NODE_R;
                const defaultColor = COLORS[item.type] || '#8b7355';
                const inChain = chainIds.has(item.id);
                const selected = item.id === selectedId;
                
                const isSimRoot = simulationMode !== 'none' && simulatedNodeId === item.id;
                const isSimAffected = simulationMode !== 'none' && simulatedCascadeIds.has(item.id);
                const isSimDimmed = simulationMode !== 'none' && !isSimRoot && !isSimAffected;
                
                const interventionCount = attentionInterventions[item.id] || 0;
                const isAttentionHot = activeLens === 'attention' && interventionCount > 0;
                const isSpofHot = activeLens === 'credentials' && (item.id.includes('github') || item.id.includes('docker') || item.id.includes('1password') || item.id.includes('credential'));

                const dimmed = (chainIds.size > 0 && !inChain) || isSimDimmed;
                const next = isNext(item);
                const reached = item.status === 'built';
                const baseOpacity = isSimRoot || isSimAffected ? 1 : dimmed ? 0.15 : reached ? 1 : next ? 0.92 : 0.3;
                
                let nodeFill = reached ? defaultColor : '#f5e6c8';
                let sc = inChain && !selected ? '#d4a017' : selected ? '#d4a017' : defaultColor;
                let sw = inChain ? 3 : selected ? 3 : 1.5;

                if (simulationMode === 'outage') {
                  if (isSimRoot) {
                    nodeFill = '#e63946';
                    sc = '#ffffff';
                    sw = 3.5;
                  } else if (isSimAffected) {
                    nodeFill = '#d90429';
                    sc = '#ffffff';
                    sw = 2.5;
                  }
                } else if (simulationMode === 'acquisition') {
                  if (isSimRoot) {
                    nodeFill = '#48cae4';
                    sc = '#ffffff';
                    sw = 3.5;
                  } else if (isSimAffected) {
                    nodeFill = '#2a9d8f';
                    sc = '#ffffff';
                    sw = 2.5;
                  }
                } else if (isAttentionHot) {
                  nodeFill = interventionCount > 20 ? '#e76f51' : '#f4a261';
                  sc = '#ffffff';
                  sw = 2;
                } else if (isSpofHot) {
                  nodeFill = '#7209b7';
                  sc = '#ffd166';
                  sw = 3;
                }

                const sym = item.type === 'framework' ? '★' : item.type === 'mcp-server' ? '◈' : item.type === 'agent' ? '◆' : item.type === 'skill' ? '◇' : '●';
                const label = item.name.length > 20 ? item.name.slice(0, 18) + '…' : item.name;
                
                return (
                  <g key={item.id} transform={`translate(${cx}, ${cy})`} opacity={baseOpacity}
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
                    onFocus={() => { onHover?.(item.id); setHoverItem(item.id); }}
                    onBlur={() => { onHover?.(null); setHoverItem(null); }}
                    onMouseEnter={() => { onHover?.(item.id); setHoverItem(item.id); }}
                    onMouseLeave={() => { onHover?.(null); setHoverItem(null); }}
                    style={{ cursor:'pointer', transition:'opacity .2s' }}>
                    
                    {/* Outer glow when selected or simulation target */}
                    {selected && <circle r={NODE_R + 10} fill="none" stroke="#d4a017" strokeWidth={4} opacity={0.3}/>}
                    {isSimRoot && <circle r={NODE_R + 8} fill="none" stroke={simulationMode === 'outage' ? '#e63946' : '#48cae4'} strokeWidth={3} strokeDasharray="4,4"/>}
                    {isSimAffected && <circle r={NODE_R + 6} fill="none" stroke={simulationMode === 'outage' ? '#d90429' : '#2a9d8f'} strokeWidth={2} opacity={0.8}/>}

                    {/* Researchable now: dashed halo plus what it costs to take */}
                    {next && !dimmed && !isSimAffected && (
                      <>
                        <circle r={NODE_R + 9} fill="none" stroke="#1f7a8c" strokeWidth={2}
                          strokeDasharray="5,4" opacity={0.9}/>
                        {costOf(item) && (
                          <text x={NODE_R + 4} y={-NODE_R - 1} textAnchor="start" fill="#1f7a8c"
                            fontSize={12} fontWeight={700}>{costOf(item)}</text>
                        )}
                      </>
                    )}

                    {/* Main node */}
                    <circle r={NODE_R} fill={nodeFill} stroke={next ? '#1f7a8c' : sc}
                      strokeWidth={next ? 2.5 : sw} opacity={0.9}/>
                    <text y={3} textAnchor="middle" fill={dimmed ? '#8b7355' : '#faebd7'} fontSize={15} fontWeight={700}>{sym}</text>

                    {/* Simulation status pills */}
                    {isSimAffected && (
                      <text y={-NODE_R - 4} textAnchor="middle" fill={simulationMode === 'outage' ? '#e63946' : '#2a9d8f'} fontSize={10} fontWeight={800}>
                        {simulationMode === 'outage' ? 'BLOCKED' : 'UNLOCKED'}
                      </text>
                    )}

                    {/* Attention Heatmap Badge */}
                    {isAttentionHot && !dimmed && (
                      <text y={-NODE_R - 4} textAnchor="middle" fill="#e76f51" fontSize={10} fontWeight={700}>
                        {interventionCount}× ($/mo)
                      </text>
                    )}

                    {/* Evidence badge */}
                    {reached && !dimmed && ['verified','reliable'].includes(item.meta?.lifecycle as string) && (
                      <g transform={`translate(${NODE_R - 3}, ${-NODE_R + 3})`}>
                        <circle r={7} fill="#2e7d32" stroke="#faebd7" strokeWidth={1.5}/>
                        <text y={3.5} textAnchor="middle" fill="#faebd7" fontSize={10} fontWeight={700}>✓</text>
                      </g>
                    )}
                    {reached && !dimmed && ['degraded','broken'].includes(item.meta?.lifecycle as string) && (
                      <g transform={`translate(${NODE_R - 3}, ${-NODE_R + 3})`}>
                        <circle r={7} fill="#c62828" stroke="#faebd7" strokeWidth={1.5}/>
                        <text y={3.5} textAnchor="middle" fill="#faebd7" fontSize={10} fontWeight={700}>!</text>
                      </g>
                    )}
                    <text y={NODE_R + 18} textAnchor="middle" fill={dimmed ? '#6b5b3a' : '#4a3728'} fontSize={12} fontWeight={500}>{label}</text>
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Hover tooltip */}
        {/* Hover detail. This used to require hoverDownstream.length > 0, so a
            capability you have not reached — whose description carries the whole
            point, "configured, but Vector Store is not in place yet" — showed
            nothing at all on hover. */}
        {hoverTarget && (() => {
          const ni = items.find(i => i.id === hoverTarget);
          if (!ni) return null;
          const di = colOrder.indexOf(columnOf(ni));
          const ai = (cols[columnOf(ni)] || []).findIndex((i: Item) => i.id === hoverTarget);
          if (di < 0 || ai < 0) return null;

          // SVG text does not wrap, so break the description by hand.
          const wrap = (text: string, perLine = 30, max = 4) => {
            const out: string[] = [];
            let line = '';
            for (const word of text.split(' ')) {
              if ((line + word).length > perLine) { out.push(line.trim()); line = ''; }
              if (out.length === max) return [...out.slice(0, max - 1), out[max - 1] + '…'];
              line += word + ' ';
            }
            if (line.trim()) out.push(line.trim());
            return out;
          };

          const unreached = ni.status !== 'built';
          const lines = unreached && ni.description ? wrap(ni.description) : [];
          const enables = hoverDownstream.slice(0, 4);
          const W = 190;
          const headH = 20;
          const descH = lines.length * 14;
          const enablesH = enables.length ? 18 + enables.length * 15 : 0;
          const boxH = headH + descH + enablesH + 10;

          const tx = START_X + di * COL_W + COL_W / 2 - 40 + NODE_R + 10;
          const ty = START_Y + ai * ROW_H + NODE_R - 10;

          return (
            <g transform={`translate(${tx}, ${ty})`} pointerEvents="none">
              <rect x={0} y={0} width={W} height={boxH} rx={5} fill="#faf3e0" stroke="#b8860b" strokeWidth={1}/>
              <text x={10} y={15} fill="#6b5b3a" fontSize={12} fontWeight={700}>
                {unreached ? 'NOT REACHED YET' : ni.name}
              </text>
              {lines.map((line, i) => (
                <text key={i} x={10} y={headH + 12 + i * 14} fill="#4a3728" fontSize={12}>{line}</text>
              ))}
              {enables.length > 0 && (
                <text x={10} y={headH + descH + 14} fill="#6b5b3a" fontSize={12} fontWeight={700}>ENABLES</text>
              )}
              {enables.map((did, i) => {
                const dep = items.find(it => it.id === did);
                const label = dep ? (dep.name.length > 22 ? dep.name.slice(0, 20) + '…' : dep.name) : did;
                return (
                  <text key={did} x={12} y={headH + descH + 29 + i * 15} fill="#4a3728" fontSize={12}>{label}</text>
                );
              })}
              {hoverDownstream.length > 4 && (
                <text x={12} y={boxH - 6} fill="#8b7355" fontSize={12}>+{hoverDownstream.length - 4} more</text>
              )}
            </g>
          );
        })()}

        {/* Inline legend */}
        <g transform={`translate(${START_X}, ${contentHeight - 40})`}>
          <line x1={0} y1={-4} x2={colOrder.length * COL_W - 60} y2={-4} stroke="#c4a96a" strokeWidth={0.5}/>
          {[
            {color:'#b8860b',sym:'★',label:'Framework'},
            {color:'#daa520',sym:'◈',label:'Server'},
            {color:'#cd853f',sym:'◆',label:'Agent'},
            {color:'#6b8e23',sym:'◇',label:'Skill'},
            {color:'#b87333',sym:'●',label:'Combo'},
            {color:'#2e7d32',sym:'✓',label:'Check passing'},
            {color:'#c62828',sym:'!',label:'Check failing'},
            {stroke:'#8b6914',style:'solid',label:'Required'},
            {stroke:'#b8a060',style:'dashed',label:'Optional'},
          ].map((l,i)=>{
            const lx = 30 + i * 140;
            return (
              <g key={i} transform={`translate(${lx}, 12)`}>
                {l.color ? (
                  <>
                    <circle r={8} fill={l.color} opacity={0.85}/>
                    <text y={3} textAnchor="middle" fill="#faebd7" fontSize={12} fontWeight={700}>{l.sym}</text>
                  </>
                ) : (
                  <line x1={-12} y1={0} x2={12} y2={0} stroke={l.stroke} strokeWidth={1.5} strokeDasharray={l.style === 'dashed' ? '5,3' : 'none'}/>
                )}
                <text x={16} y={3} fill="#6b5b3a" fontSize={12}>{l.label}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
