import React, { useEffect, useState, lazy, Suspense } from 'react';
// Three.js is ~1MB and only the 3D layouts need it. ERAS is the default mode,
// so keeping this lazy means most sessions never download the 3D renderer.
const Constellation = lazy(() => import('./components/Constellation'));
import StarPanel from './components/StarPanel';
import ConsultantPanel from './components/ConsultantPanel';
import CivTree from './components/CivTree';
import ToolchainPanel from './components/ToolchainPanel';
import DocsModal from './components/DocsModal';
import { useToolchainStore } from './store/toolchainStore';
import type { LayoutMode } from './utils/configImporter';

// All four modes the layout engine supports. ORBITAL and FLAT existed in the
// engine and store but were never reachable from the HUD.
const LAYOUT_MODES: { id: LayoutMode; label: string; title: string }[] = [
  { id: 'civ', label: 'ERAS', title: 'Era columns' },
  { id: 'constellation', label: 'CONSTELLATION', title: '3D hex map' },
  { id: 'orbital', label: 'ORBITAL', title: '3D concentric shells by type' },
  { id: 'flat', label: 'FLAT', title: '2D force-directed' },
];

type Tab = 'contacts' | 'diagnostics';

function UplinkModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const addMcpServer = useToolchainStore(s => s.addMcpServer);
  const loading = useToolchainStore(s => s.loading);

  const [name, setName] = useState('');
  const [type, setType] = useState<'local' | 'remote'>('local');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [envStr, setEnvStr] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    const config: any = { type, enabled: true };

    if (type === 'remote') {
      if (!url.trim()) {
        setError('URL is required for remote server');
        return;
      }
      config.url = url.trim();
    } else {
      if (!command.trim()) {
        setError('Command is required for local server');
        return;
      }
      config.command = command.trim().split(/\s+/);
    }

    if (envStr.trim()) {
      const env: Record<string, string> = {};
      const lines = envStr.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split('=');
        if (parts.length < 2) {
          setError(`Invalid environment variable line: "${line}". Must be KEY=VALUE`);
          return;
        }
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        env[key] = value;
      }
      config.env = env;
    }

    const ok = await addMcpServer(name.trim(), config);
    if (ok) {
      setName('');
      setType('local');
      setUrl('');
      setCommand('');
      setEnvStr('');
      onClose();
    } else {
      setError('Uplink failed. Check console or server logs.');
    }
  };

  return (
    <div className="uplink-modal-overlay">
      <div className="uplink-modal">
        <div className="sp-hdr">
          <span className="sp-sig" style={{ color: 'var(--accent)' }}>🔌</span>
          <div className="sp-title-group">
            <div className="sp-designation">ESTABLISH UPLINK</div>
            <div className="sp-class">REGISTER NEW MCP SERVER</div>
          </div>
          <button className="sp-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
          {error && <div style={{ color: 'var(--error)', fontSize: '11px', border: '1px solid var(--error)', padding: '6px', background: 'rgba(255, 51, 68, 0.1)', borderRadius: 'var(--radius)' }}>{error}</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>SERVER IDENTIFIER</label>
            <input
              type="text"
              placeholder="e.g. github-mcp"
              value={name}
              onChange={e => setName(e.target.value)}
              className="tp-search"
              required
            />
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              className="tp-btn-sm"
              style={{ flex: 1, borderColor: type === 'local' ? 'var(--accent)' : 'var(--border)', color: type === 'local' ? 'var(--accent)' : 'var(--text-muted)' }}
              onClick={() => setType('local')}
            >
              LOCAL
            </button>
            <button
              type="button"
              className="tp-btn-sm"
              style={{ flex: 1, borderColor: type === 'remote' ? 'var(--accent)' : 'var(--border)', color: type === 'remote' ? 'var(--accent)' : 'var(--text-muted)' }}
              onClick={() => setType('remote')}
            >
              REMOTE (SSE)
            </button>
          </div>

          {type === 'remote' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <label style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>ENDPOINT URL</label>
              <input
                type="url"
                placeholder="http://localhost:3000/sse"
                value={url}
                onChange={e => setUrl(e.target.value)}
                className="tp-search"
                required
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <label style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>COMMAND / ARGUMENTS</label>
              <input
                type="text"
                placeholder="e.g. npx -y @modelcontextprotocol/server-github"
                value={command}
                onChange={e => setCommand(e.target.value)}
                className="tp-search"
                required
              />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>ENVIRONMENT VARIABLES (KEY=VALUE, one per line)</label>
            <textarea
              placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=your_token_here"
              value={envStr}
              onChange={e => setEnvStr(e.target.value)}
              className="tp-search"
              style={{ minHeight: '60px', fontFamily: 'var(--font)', resize: 'vertical' }}
            />
          </div>

          <button type="submit" className="tp-btn" style={{ width: '100%', marginTop: '10px' }} disabled={loading}>
            {loading ? 'UPLINKING...' : 'ESTABLISH CONNECTION'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const items = useToolchainStore(s => s.items);
  const connections = useToolchainStore(s => s.connections);
  const showStarPanel = useToolchainStore(s => s.showStarPanel);
  const selectedId = useToolchainStore(s => s.selectedItem);
  const selectItem = useToolchainStore(s => s.selectItem);
  const loading = useToolchainStore(s => s.loading);
  const error = useToolchainStore(s => s.error);
  const loadConfig = useToolchainStore(s => s.loadConfig);
  const layoutMode = useToolchainStore(s => s.layoutMode);
  const setLayoutMode = useToolchainStore(s => s.setLayoutMode);
  const seedDemo = useToolchainStore(s => s.seedDemo);
  const loadFromJSON = useToolchainStore(s => s.loadFromJSON);
  const hoveredId = useToolchainStore(s => s.hoveredItem);
  const hoverItem = useToolchainStore(s => s.hoverItem);

  const showUplinkModal = useToolchainStore(s => s.showUplinkModal);
  const setShowUplinkModal = useToolchainStore(s => s.setShowUplinkModal);

  const [leftTab, setLeftTab] = useState<Tab>('diagnostics');
  const [showDocs, setShowDocs] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);

  const captureGraph = () => {
    const svg = document.querySelector<SVGSVGElement>('.app-scene svg');
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const data = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([data], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      const h = svg.viewBox.baseVal?.height || 600;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#f5e6c8';
      ctx.fillRect(0, 0, 1200, h);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(b => {
        if (!b) return;
        const pngUrl = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = 'capability-graph.png';
        a.click();
        URL.revokeObjectURL(pngUrl);
      });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };
  const [leftOpen, setLeftOpen] = useState(true);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  return (
    <div className="app">
      <div className="app-scene">
        {loading && !items.length && (
          <div className="app-loading">
            <div className="app-loading-ring" />
            <p>Loading capability graph…</p>
          </div>
        )}
        {error && (
          <div className="app-error">
            <p>{error}</p>
            <button className="tp-btn" onClick={() => loadConfig()}>RECONNECT</button>
          </div>
        )}
        {showGuide && items.length > 0 && (
          <div style={{ position:'absolute', bottom:80, left:'50%', transform:'translateX(-50%)', zIndex:5, background:'#faf3e0cc', backdropFilter:'blur(4px)', border:'1px solid #b8860b', borderRadius:8, padding:'12px 20px', maxWidth:500, textAlign:'center' }}>
            <p style={{ margin:0, fontSize:11, color:'#4a3728', lineHeight:1.5 }}>
              <strong>Click any circle</strong> to see what it enables and highlight its dependencies. <strong>Hover</strong> for connection details. <strong>Toggle ERAS</strong> for era-column view.
            </p>
          </div>
        )}
        {!items.length && !loading && (
          <div className="app-welcome">
            <div className="app-welcome-hero">
              <div className="app-welcome-title">CAPABILITY GRAPH</div>
              <div className="app-welcome-tagline">Your OpenCode toolchain, mapped as a capability graph:<br/>what you have built, what connects, and what is possible.</div>
              <div className="app-welcome-diagram">
                <svg width="300" height="100" viewBox="0 0 300 100"><rect x={0} y={0} width={300} height={100} rx={6} fill="#e8d5a8" opacity={0.5}/><line x1={52} y1={50} x2={128} y2={30} stroke="#8b6914" strokeWidth={1.5}/><line x1={152} y1={50} x2={128} y2={30} stroke="#b8a060" strokeWidth={1} strokeDasharray="5,3"/><line x1={52} y1={50} x2={128} y2={70} stroke="#8b6914" strokeWidth={1.5}/><line x1={252} y1={50} x2={128} y2={70} stroke="#b8a060" strokeWidth={1} strokeDasharray="5,3"/><circle cx={52} cy={50} r={16} fill="#b8860b"/><text x={52} y={55} textAnchor="middle" fill="#faebd7" fontSize={11} fontWeight={700}>◈</text><circle cx={252} cy={50} r={16} fill="#cd853f"/><text x={252} y={55} textAnchor="middle" fill="#faebd7" fontSize={11} fontWeight={700}>◆</text><circle cx={128} cy={30} r={14} fill="#b87333"/><text x={128} y={34} textAnchor="middle" fill="#faebd7" fontSize={11} fontWeight={700}>●</text><circle cx={128} cy={70} r={14} fill="#6b8e23"/><text x={128} y={74} textAnchor="middle" fill="#faebd7" fontSize={11} fontWeight={700}>◇</text><circle cx={128} cy={30} r={18} fill="none" stroke="#b8860b" strokeWidth={2} strokeDasharray="84 29" strokeLinecap="round" transform="rotate(-90 128 30)"/><circle cx={128} cy={70} r={18} fill="none" stroke="#b8860b" strokeWidth={1.5} strokeDasharray="40 73" strokeLinecap="round" transform="rotate(-90 128 70)"/></svg>
              </div>
              <div className="app-welcome-actions">
                <button className="app-welcome-btn" onClick={() => { seedDemo(); setTimeout(() => setShowGuide(true), 600); }}>▶  LOAD DEMO</button>
                <button className="app-welcome-btn app-welcome-btn-outline" onClick={() => setShowImport(true)}>📋  PASTE</button>
                <a href="https://github.com/zz-plant/capability-graph" target="_blank" rel="noopener" className="app-welcome-btn app-welcome-btn-outline">⭐  GITHUB</a>
              </div>
              <div className="app-welcome-code"><code>git clone https://github.com/zz-plant/capability-graph.git &amp;&amp; cd capability-graph &amp;&amp; ./bootstrap.sh</code></div>
              <div className="app-welcome-modes"><span>Click <em>LOAD DEMO</em> to see a sample capability graph</span><span>Select any node and check <em>DIAGNOSTICS</em> in the sidebar</span><span>Toggle <em>ERAS</em> layout mode for an era-column tech tree view</span></div>
            </div>
          </div>
        )}
        {items.length > 0 && layoutMode === 'civ' ? (
          <CivTree items={items} connections={connections} selectedId={selectedId} hoveredId={hoveredId} onSelect={selectItem} onHover={hoverItem} />
        ) : items.length > 0 ? (
          <Suspense fallback={<div className="app-loading">LOADING 3D VIEW…</div>}>
            <Constellation />
          </Suspense>
        ) : null}
      </div>

      {showStarPanel && selectedId && (
        <div className="app-panel-overlay">
          <StarPanel />
        </div>
      )}

      <aside className={`app-console ${leftOpen ? 'app-console--open' : ''}`}>
        <div className="app-console-tabs">
          <button className={`app-console-tab ${leftTab === 'contacts' ? 'active' : ''}`} onClick={() => setLeftTab('contacts')}>TOOLS</button>
          <button className={`app-console-tab ${leftTab === 'diagnostics' ? 'active' : ''}`} onClick={() => setLeftTab('diagnostics')}>DIAGNOSTICS</button>
        </div>
        {leftTab === 'contacts' ? <ToolchainPanel /> : <ConsultantPanel />}
      </aside>

      <div className="app-hud">
        <button className="app-hud-btn" onClick={() => setLeftOpen(o => !o)} title="Toggle panel"> {leftOpen ? '◀' : '▶'} </button>
        <button className="app-hud-btn" onClick={() => { setShowDocs(true); setShowGuide(false); }} style={{fontWeight:600,fontSize:9,letterSpacing:1}}>DOCS</button>
        <button className="app-hud-btn" onClick={captureGraph}>📷</button>
        {selectedId && (<button className="app-hud-btn" onClick={() => selectItem(null)} title="Deselect"> ✕ </button>)}
        <div style={{ display: 'flex', gap: '1px', border: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '1px', marginLeft: '8px' }}>
          {LAYOUT_MODES.map(({ id: m, label, title }) => (
            <button key={m} className="app-hud-btn" style={{ width:'auto', padding:'0 8px', border:'none', background: layoutMode === m ? 'var(--accent)' : 'transparent', color: layoutMode === m ? 'var(--bg-deep)' : 'var(--text-muted)', fontWeight: layoutMode === m ? 700 : 'normal', fontSize:'9px', height:'22px' }} onClick={() => { setLayoutMode(m); setShowGuide(false); }} title={`${title} layout`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <UplinkModal isOpen={showUplinkModal} onClose={() => setShowUplinkModal(false)} />

      <DocsModal isOpen={showDocs} onClose={() => setShowDocs(false)} />

      {showImport && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={() => setShowImport(false)}>
          <div style={{ background:'#faf3e0', borderRadius:8, maxWidth:500, width:'90%', padding:28, border:'1px solid #c4a96a' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin:'0 0 4px 0', fontSize:14, fontWeight:700, letterSpacing:1.5, color:'#6b5b3a' }}>IMPORT CAPABILITY GRAPH</h3>
            <p style={{ margin:'0 0 12px 0', fontSize:10, color:'#8b7355' }}>Run <code style={{background:'#f0dbb8', padding:'1px 4px', borderRadius:3}}>tt export</code> locally, copy the output, and paste below.</p>
            <textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="Paste JSON from tt export here..." style={{ width:'100%', height:200, fontFamily:'monospace', fontSize:11, padding:10, border:'1px solid #c4a96a', borderRadius:4, background:'#f0dbb8', resize:'vertical', color:'#4a3728' }} />
            <div style={{ display:'flex', gap:8, marginTop:12, justifyContent:'flex-end' }}>
              <button onClick={() => setShowImport(false)} style={{ padding:'6px 14px', fontSize:10, fontWeight:600, letterSpacing:1, border:'1px solid #c4a96a', background:'transparent', color:'#8b7355', borderRadius:3, cursor:'pointer' }}>CANCEL</button>
              <button onClick={() => { if (loadFromJSON(importText)) { setShowImport(false); setImportText(''); } }} style={{ padding:'6px 14px', fontSize:10, fontWeight:600, letterSpacing:1, border:'1px solid #b8860b', background:'#b8860b', color:'#faf3e0', borderRadius:3, cursor:'pointer' }}>LOAD GRAPH</button>
            </div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <span className="app-footer-title">◈ CAPABILITY GRAPH</span>
        <span className="app-footer-info">
          {items.length} capabilities · {items.filter(i => i.status === 'built').length} built
        </span>
        <span className="app-footer-hint">ERAS · CONSTELLATION</span>
      </footer>
    </div>
  );
}
