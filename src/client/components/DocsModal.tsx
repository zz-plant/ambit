import React from 'react';

export default function DocsModal({ isOpen, onClose }) {
  if (!isOpen) return null;
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={onClose}>
      <div style={{ background:'#faf3e0', borderRadius:8, maxWidth:560, maxHeight:'80vh', overflow:'auto', padding:28, border:'1px solid #c4a96a' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <h2 style={{ margin:0, fontSize:16, fontWeight:700, letterSpacing:2, color:'#6b5b3a' }}>HOW TO READ THIS</h2>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:18, cursor:'pointer', color:'#8b7355' }}>✕</button>
        </div>

        <DocSection title="Node types" items={[
          { color:'#b8860b', sym:'★', label:'Framework', desc:'Core tool or platform (OpenCode, Shell, LSP)' },
          { color:'#daa520', sym:'◈', label:'MCP Server', desc:'External service integration (Cloudflare, GitHub, Playwright)' },
          { color:'#cd853f', sym:'◆', label:'Agent', desc:'Subagent with specific domain expertise' },
          { color:'#6b8e23', sym:'◇', label:'Skill', desc:'Loadable prompt instruction set' },
          { color:'#b87333', sym:'●', label:'Combo / Possibility', desc:'Capability unlocked by combining prerequisites' },
        ]}/>

        <DocSection title="Maturity rings" desc="The ring around each node shows how established the capability is. A full ring means it's well-maintained. A thin sliver means it's new or rarely touched. The percentage below the node shows the exact score." />

        <DocSection title="Connection lines" iconItems={[
          { style:{width:40, height:2, background:'#8b6914', display:'inline-block', marginRight:8}, label:'Hard dependency', desc:'Required to unlock a combo' },
          { style:{width:40, height:1.2, background:'transparent', borderTop:'2px dashed #b8a060', display:'inline-block', marginRight:8}, label:'Soft dependency', desc:'Helpful but not required' },
          { style:{width:40, height:1, background:'transparent', borderTop:'2px dotted #d4a017', display:'inline-block', marginRight:8}, label:'Connection', desc:'General relationship between capabilities' },
        ]}/>

        <DocSection title="Selecting a node" desc="Click any node to highlight its entire dependency chain. Connected capabilities glow gold. Unrelated ones dim to 15% opacity. The Diagnostics panel in the sidebar shows automated findings about the selected capability." />

        <DocSection title="Tree filter" desc="Use the filter buttons above the tree to show only specific capability types. ALL shows everything. SERVER shows only MCP server integrations. AGENT shows subagents. SKILL shows loadable skills. COMBO shows combined capabilities." />

        <DocSection title="Layout modes" desc="Toggle between four views in the toolbar: CIV (era-column tech tree), CONSTELLATION (3D hex map), ORBITAL (circular), and FLAT (2D force-directed)." />

        <DocSection title="This is a demo" desc="The graph shows seeded example data. To see your own toolchain, clone the repo and run the bootstrap script." code="git clone https://github.com/zz-plant/capability-graph.git && cd capability-graph && ./bootstrap.sh" />
      </div>
    </div>
  );
}

function DocSection({ title, items, iconItems, desc, code }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={{ margin:'0 0 8px 0', fontSize:12, fontWeight:700, letterSpacing:1.5, color:'#8b6914', textTransform:'uppercase' }}>{title}</h3>
      {items && items.map((it, i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
          <div style={{ width:28, height:28, borderRadius:'50%', background:it.color, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <span style={{ color:'#faebd7', fontSize:12, fontWeight:700 }}>{it.sym}</span>
          </div>
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:'#4a3728' }}>{it.label}</div>
            <div style={{ fontSize:10, color:'#8b7355' }}>{it.desc}</div>
          </div>
        </div>
      ))}
      {iconItems && iconItems.map((it, i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
          <span style={it.style} />
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:'#4a3728' }}>{it.label}</div>
            <div style={{ fontSize:10, color:'#8b7355' }}>{it.desc}</div>
          </div>
        </div>
      ))}
      {desc && <p style={{ fontSize:10, color:'#8b7355', lineHeight:1.5, margin:0 }}>{desc}</p>}
      {code && <code style={{ display:'block', fontSize:10, background:'#f0dbb8', padding:'6px 10px', borderRadius:4, marginTop:6, color:'#4a3728' }}>{code}</code>}
    </div>
  );
}
