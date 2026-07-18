import React, { useMemo, useState } from 'react';

const TYPE_FILTERS = ['all', 'server', 'agent', 'skill', 'combo'] as const;
type Filter = typeof TYPE_FILTERS[number];

const DOMAIN_ORDER = ['infra', 'devops', 'backend', 'frontend', 'ai-ml', 'quality', 'meta', 'security'];
const ERA_LABELS = { infra:'Foundation', devops:'Pipeline', backend:'Services', frontend:'Interface', 'ai-ml':'Intelligence', quality:'Guard', meta:'Orchestration', security:'Fortress' };
const NODE_R = 28, COL_W = 170, ROW_H = 105, START_X = 90, START_Y = 70;

export default function CivTree({ items, connections, selectedId, hoveredId, onSelect, onHover }) {
  const [filter, setFilter] = useState<Filter>('all');

  const { downstream, chainIds } = useMemo(() => {
    const down = new Map(), up = new Map();
    for (const c of connections) {
      if (!down.has(c.from)) down.set(c.from, []);
      down.get(c.from).push(c.to);
      if (!up.has(c.to)) up.set(c.to, []);
      up.get(c.to).push(c.from);
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
    if (filter === 'all') return items;
    const tm = { server: 'mcp-server', agent: 'agent', skill: 'skill', combo: 'possibility' };
    return items.filter(i => i.type === tm[filter] || i.type === 'framework');
  }, [items, filter]);

  const [hoverItem, setHoverItem] = useState<string | null>(null);

  const { cols, colOrder } = useMemo(() => {
    const c = {};
    for (const item of filtered) {
      const d = item.meta?.domain || 'meta';
      if (!c[d]) c[d] = [];
      c[d].push(item);
    }
    const order = DOMAIN_ORDER.filter(d => c[d]?.length);
    for (const d of Object.keys(c)) if (!order.includes(d)) order.push(d);
    return { cols: c, colOrder: order };
  }, [filtered]);

  const COLORS = { framework: '#b8860b', 'mcp-server': '#daa520', agent: '#cd853f', skill: '#6b8e23', provider: '#a0853c', combo: '#b87333', possibility: '#b87333', tool: '#a0522d' };
  const hoverTarget = hoverItem || hoveredId;
  const hoverDownstream = hoverTarget ? downstream.get(hoverTarget) || [] : [];

  const contentHeight = Math.max(...colOrder.map(d => (cols[d]?.length || 0) * ROW_H), 5) + START_Y + 40;

  return (
    <div style={{ position:'relative', width:'100%', height:'100%', overflow:'auto' }}>
      <div style={{ position:'absolute', top:10, left:14, display:'flex', gap:5, zIndex:10 }}>
        {TYPE_FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding:'3px 10px', fontSize:10, fontWeight:600, letterSpacing:1.2,
              border: filter===f ? '1.5px solid #b8860b':'1px solid #c4a96a',
              background: filter===f ? '#b8860b':'#faf3e0', borderRadius:3, cursor:'pointer',
              color: filter===f ? '#fff':'#8b7355', textTransform:'uppercase', transition:'all .15s' }}>
            {f}
          </button>
        ))}
      </div>

      <svg width="100%" height={contentHeight} viewBox={`0 0 ${START_X + colOrder.length * COL_W + 60} ${contentHeight}`}
        style={{ background: '#f5e6c8', marginTop: 32 }}>
        
        {/* Era column bands */}
        {colOrder.map((d, i) => {
          const x = START_X + i * COL_W;
          return (
            <g key={`band-${d}`}>
              <rect x={x - 5} y={START_Y - 45} width={COL_W - 20} height={contentHeight - START_Y + 20}
                fill={i % 2 === 0 ? '#f0dbb8' : '#f8ecd0'} rx={6} opacity={0.5}/>
              <text x={x + COL_W/2 - 40} y={START_Y - 22} textAnchor="middle" fill="#6b5b3a" fontSize={12} fontWeight={700}
                letterSpacing={2} textTransform="uppercase">{ERA_LABELS[d] || d}</text>
              <text x={x + COL_W/2 - 40} y={START_Y - 8} textAnchor="middle" fill="#9b8b6a" fontSize={10}>{(d || '').toUpperCase()}</text>
              <line x1={x + 10} y1={START_Y - 2} x2={x + COL_W - 50} y2={START_Y - 2} stroke="#c4a96a" strokeWidth={0.8}/>
            </g>
          );
        })}

        {/* Connection lines — rendered behind nodes */}
        {connections.map((conn, i) => {
          const from = items.find(it => it.id === conn.from);
          const to = items.find(it => it.id === conn.to);
          if (!from || !to) return null;
          const fd = from.meta?.domain || 'meta';
          const td = to.meta?.domain || 'meta';
          const fi = colOrder.indexOf(fd);
          const ti = colOrder.indexOf(td);
          const fa = (cols[fd] || []).findIndex(it => it.id === from.id);
          const ta = (cols[td] || []).findIndex(it => it.id === to.id);
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
                const baseOpacity = dimmed ? 0.15 : item.status === 'built' ? 1 : 0.35;
                const mat = item.meta?.maturity || 0;
                const ringCirc = 2 * Math.PI * (NODE_R + 5);
                const sc = inChain && !selected ? '#d4a017' : selected ? '#d4a017' : color;
                const sw = inChain ? 3 : selected ? 3 : 1.5;
                const sym = item.type === 'framework' ? '★' : item.type === 'mcp-server' ? '◈' : item.type === 'agent' ? '◆' : item.type === 'skill' ? '◇' : '●';
                const label = item.name.length > 20 ? item.name.slice(0, 18) + '…' : item.name;
                
                return (
                  <g key={item.id} transform={`translate(${cx}, ${cy})`} opacity={baseOpacity}
                    onClick={() => onSelect(selected ? null : item.id)}
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
                    
                    {/* Main node */}
                    <circle r={NODE_R} fill={color} stroke={sc} strokeWidth={sw} opacity={0.9}/>
                    <text y={3} textAnchor="middle" fill={dimmed ? '#8b7355' : '#faebd7'} fontSize={14} fontWeight={700}>{sym}</text>
                    <text y={NODE_R + 18} textAnchor="middle" fill={dimmed ? '#6b5b3a' : '#4a3728'} fontSize={10} fontWeight={500}>{label}</text>
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Hover tooltip */}
        {hoverTarget && hoverDownstream.length > 0 && (() => {
          const ni = items.find(i => i.id === hoverTarget);
          if (!ni) return null;
          const di = colOrder.indexOf(ni.meta?.domain || 'meta');
          const ai = (cols[ni.meta?.domain || 'meta'] || []).findIndex(i => i.id === hoverTarget);
          if (di < 0 || ai < 0) return null;
          const tx = START_X + di * COL_W + COL_W/2 - 40 + NODE_R + 10;
          const ty = START_Y + ai * ROW_H + NODE_R - 10;
          const boxH = Math.min(hoverDownstream.length * 16 + 28, 90);
          return (
            <g transform={`translate(${tx}, ${ty})`}>
              <rect x={0} y={0} width={150} height={boxH} rx={5} fill="#faf3e0" stroke="#b8860b" strokeWidth={1}/>
              <text x={10} y={16} fill="#6b5b3a" fontSize={10} fontWeight={700} letterSpacing={1}>ENABLES</text>
              {hoverDownstream.slice(0, 4).map((did, i) => {
                const dep = items.find(it => it.id === did);
                return <text key={did} x={12} y={32 + i * 16} fill="#4a3728" fontSize={10}>{dep ? (dep.name.length > 20 ? dep.name.slice(0, 18) + '…' : dep.name) : did}</text>;
              })}
              {hoverDownstream.length > 4 && <text x={12} y={boxH - 8} fill="#8b7355" fontSize={9}>+{hoverDownstream.length - 4} more</text>}
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
                    <text y={3} textAnchor="middle" fill="#faebd7" fontSize={9} fontWeight={700}>{l.sym}</text>
                  </>
                ) : (
                  <line x1={-12} y1={0} x2={12} y2={0} stroke={l.stroke} strokeWidth={1.5} strokeDasharray={l.style === 'dashed' ? '5,3' : 'none'}/>
                )}
                <text x={16} y={3} fill="#6b5b3a" fontSize={9}>{l.label}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
