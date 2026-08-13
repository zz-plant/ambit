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
const maturityOf = (item: Item): number => Number(item.meta?.maturity) || 0;

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
  }, [filtered]);

  const COLORS: Record<string, string> = { framework: '#b8860b', 'mcp-server': '#daa520', agent: '#cd853f', skill: '#6b8e23', provider: '#a0853c', combo: '#b87333', possibility: '#b87333', tool: '#a0522d' };
  const hoverTarget = hoverItem || hoveredId;
  const hoverDownstream = hoverTarget ? downstream.get(hoverTarget) || [] : [];

  const contentHeight = Math.max(...colOrder.map(d => (cols[d]?.length || 0) * ROW_H), 5) + START_Y + 40;
  const contentWidth = START_X + colOrder.length * COL_W + 60;

  return (
    <div style={{ position:'relative', width:'100%', height:'100%', overflow:'auto', paddingLeft: leftInset }}>

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
          const op = chainIds.size > 0 ? (inChain ? 0.65 : 0.06) : 0.35;
          return <line key={`c-${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={isHard ? '#8b6914' : isSoft ? '#b8a060' : '#d4a017'}
            strokeWidth={isHard ? 2 : 1.2}
            strokeDasharray={isHard ? 'none' : isSoft ? '6,3' : '2,4'}
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
                const color = COLORS[item.type] || '#8b7355';
                const inChain = chainIds.has(item.id);
                const selected = item.id === selectedId;
                const dimmed = chainIds.size > 0 && !inChain;
                // Civ's three states. Previously "not built" was one flat 0.35
                // fade, which collapsed "you could take this next" into the
                // same look as "this is far away".
                const next = isNext(item);
                const reached = item.status === 'built';
                const baseOpacity = dimmed ? 0.15 : reached ? 1 : next ? 0.92 : 0.3;
                const mat = maturityOf(item);
                const ringCirc = 2 * Math.PI * (NODE_R + 5);
                const sc = inChain && !selected ? '#d4a017' : selected ? '#d4a017' : color;
                const sw = inChain ? 3 : selected ? 3 : 1.5;
                const sym = item.type === 'framework' ? '★' : item.type === 'mcp-server' ? '◈' : item.type === 'agent' ? '◆' : item.type === 'skill' ? '◇' : '●';
                const label = item.name.length > 20 ? item.name.slice(0, 18) + '…' : item.name;
                
                return (
                  <g key={item.id} transform={`translate(${cx}, ${cy})`} opacity={baseOpacity}
                    // Nodes were reachable by mouse only: no capability could be
                    // focused, and status is carried by fill and outline, which
                    // says nothing to a screen reader. The label states what the
                    // colour encodes.
                    tabIndex={0}
                    role="button"
                    aria-pressed={selected}
                    aria-label={`${item.name}, ${item.type}, ${item.status === 'built' ? 'reached' : 'not reached'}${item.description ? `. ${item.description}` : ''}`}
                    onClick={() => onSelect(selected ? null : item.id)}
                    onKeyDown={e => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();          // Space scrolls the container otherwise
                      onSelect(selected ? null : item.id);
                    }}
                    onFocus={() => { onHover?.(item.id); setHoverItem(item.id); }}
                    onBlur={() => { onHover?.(null); setHoverItem(null); }}
                    onMouseEnter={() => { onHover?.(item.id); setHoverItem(item.id); }}
                    onMouseLeave={() => { onHover?.(null); setHoverItem(null); }}
                    style={{ cursor:'pointer', transition:'opacity .2s' }}>
                    
                    {/* Outer glow when selected */}
                    {selected && <circle r={NODE_R + 10} fill="none" stroke="#d4a017" strokeWidth={4} opacity={0.3}/>}
                    
                    {/* Maturity ring */}
                    {mat > 0 && (
                      <circle r={NODE_R + 5} fill="none" stroke={selected ? '#d4a017' : '#b8860b'}
                        strokeWidth={3} strokeLinecap="round" transform="rotate(-90)"
                        strokeDasharray={`${ringCirc * mat} ${ringCirc * (1 - mat)}`} opacity={0.5}/>
                    )}
                    
                    {/* Researchable now: dashed halo plus what it costs to take */}
                    {next && !dimmed && (
                      <>
                        <circle r={NODE_R + 9} fill="none" stroke="#1f7a8c" strokeWidth={2}
                          strokeDasharray="5,4" opacity={0.9}/>
                        {costOf(item) && (
                          // Offset to the upper right: centred above, this collided
                          // with the era subtitle on row one and with the name of
                          // the node above it everywhere else.
                          <text x={NODE_R + 4} y={-NODE_R - 1} textAnchor="start" fill="#1f7a8c"
                            fontSize={12} fontWeight={700}>{costOf(item)}</text>
                        )}
                      </>
                    )}

                    {/* Main node. Unreached capabilities are hollow so a filled
                        circle always means "you have this". */}
                    <circle r={NODE_R} fill={reached ? color : '#f5e6c8'} stroke={next ? '#1f7a8c' : sc}
                      strokeWidth={next ? 2.5 : sw} opacity={0.9}/>
                    <text y={3} textAnchor="middle" fill={dimmed ? '#8b7355' : '#faebd7'} fontSize={15} fontWeight={700}>{sym}</text>
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
