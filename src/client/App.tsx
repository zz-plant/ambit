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
  const buildMcpSnippet = useToolchainStore(s => s.buildMcpSnippet);
  const loading = useToolchainStore(s => s.loading);

  const [name, setName] = useState('');
  const [type, setType] = useState<'local' | 'remote'>('local');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [envStr, setEnvStr] = useState('');
  const [error, setError] = useState('');
  const [snippet, setSnippet] = useState<{ snippet: string; configPath: string } | null>(null);

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

    const result = await buildMcpSnippet(name.trim(), config);
    if (result) {
      setSnippet(result);
      setError('');
    } else {
      setError('Could not build snippet. Check console or server logs.');
    }
  };

  return (
    <div className="uplink-modal-overlay">
      <div className="uplink-modal">
        <div className="sp-hdr">
          <span className="sp-sig" style={{ color: 'var(--accent)' }}>🔌</span>
          <div className="sp-title-group">
            <div className="sp-designation">ADD MCP SERVER</div>
            <div className="sp-class">GENERATE MCP CONFIG SNIPPET</div>
          </div>
          <button className="sp-close" onClick={onClose}>✕</button>
        </div>

        {snippet ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              An MCP entry carries a command OpenCode runs, so this tool will not write it for you.
              Merge this into <code>{snippet.configPath}</code>, then reload.
            </div>
            <pre style={{ fontSize: '10px', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px', overflow: 'auto', maxHeight: '220px', margin: 0 }}>{snippet.snippet}</pre>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="sp-action-btn" onClick={() => navigator.clipboard?.writeText(snippet.snippet)}>COPY</button>
              <button type="button" className="sp-action-btn" onClick={() => { setSnippet(null); setName(''); setUrl(''); setCommand(''); setEnvStr(''); onClose(); }}>DONE</button>
            </div>
          </div>
        ) : (
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
            {loading ? 'BUILDING...' : 'GENERATE CONFIG SNIPPET'}
          </button>
        </form>
        )}
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
  const [showDocs, setShowDocs] = useState(() => new URLSearchParams(window.location.search).get('docs') === 'open');
  // Shown once on first run, for real configs as well as the demo — it used to
  // fire only after LOAD DEMO, so the normal path taught nothing.
  const [showGuide, setShowGuide] = useState(() => {
    try { return localStorage.getItem('cg.seenGuide') !== '1'; } catch { return true; }
  });
  const dismissGuide = () => {
    setShowGuide(false);
    try { localStorage.setItem('cg.seenGuide', '1'); } catch { /* private mode */ }
  };
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);

  const loadTechTree = useToolchainStore(s => s.loadTechTree);
  const loadConfigSource = useToolchainStore(s => s.loadConfig);
  // ?view=tree and ?layout=eras|constellation|orbital|flat make a particular
  // view linkable — useful for sharing a specific angle, and for capturing
  // documentation screenshots reproducibly.
  const params = new URLSearchParams(window.location.search);
  const [source, setSource] = useState<'config' | 'tree'>(
    params.get('view') === 'tree' ? 'tree' : 'config'
  );
  const treeFilter = useToolchainStore(s => s.treeFilter);
  const setTreeFilter = useToolchainStore(s => s.setTreeFilter);

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
        a.download = 'ambit.png';
        a.click();
        URL.revokeObjectURL(pngUrl);
      });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };
  const [leftOpen, setLeftOpen] = useState(true);

  useEffect(() => {
    const wanted = params.get('layout');
    const alias: Record<string, LayoutMode> = { eras: 'civ', civ: 'civ',
      constellation: 'constellation', orbital: 'orbital', flat: 'flat' };
    if (wanted && alias[wanted]) setLayoutMode(alias[wanted]);
    if (params.get('guide') === 'off') dismissGuide();
    if (source === 'tree') loadTechTree(); else loadConfig();
    // Intentionally once on mount; the toggles drive later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <div
            className="app-guide"
            // Centred on the scene, the side panels covered half of it. Inset by
            // whichever panels are actually open so it centres on free space.
            style={{ left: leftOpen ? 340 : 0, right: showStarPanel && selectedId ? 340 : 0 }}
          >
            <div className="app-guide-head">
              <strong>Start here</strong>
              <button className="app-guide-close" onClick={dismissGuide} aria-label="Dismiss">✕</button>
            </div>
            <ol className="app-guide-steps">
              <li><strong>Click any circle</strong> to see what depends on it.</li>
              <li><strong>Outlined circles</strong> are capabilities you have not reached — their description says what is missing.</li>
              <li><strong>TECH TREE</strong> shows where you are on the capability tree; <strong>CONFIG</strong> shows your config as a graph.</li>
            </ol>
            <button className="app-guide-more" onClick={() => { setShowDocs(true); dismissGuide(); }}>
              What do these terms mean? →
            </button>
          </div>
        )}
        {!items.length && !loading && (
          <div className="app-welcome">
            <div className="app-welcome-hero">
              <div className="app-welcome-title">AMBIT</div>
              <div className="app-welcome-tagline">What you, your agents and your machines can jointly do —<br/>what you have reached, and what is one step away.</div>
              <div className="app-welcome-diagram">
                <svg width="300" height="100" viewBox="0 0 300 100"><rect x={0} y={0} width={300} height={100} rx={6} fill="#e8d5a8" opacity={0.5}/><line x1={52} y1={50} x2={128} y2={30} stroke="#8b6914" strokeWidth={1.5}/><line x1={152} y1={50} x2={128} y2={30} stroke="#b8a060" strokeWidth={1} strokeDasharray="5,3"/><line x1={52} y1={50} x2={128} y2={70} stroke="#8b6914" strokeWidth={1.5}/><line x1={252} y1={50} x2={128} y2={70} stroke="#b8a060" strokeWidth={1} strokeDasharray="5,3"/><circle cx={52} cy={50} r={16} fill="#b8860b"/><text x={52} y={55} textAnchor="middle" fill="#faebd7" fontSize={13} fontWeight={700}>◈</text><circle cx={252} cy={50} r={16} fill="#cd853f"/><text x={252} y={55} textAnchor="middle" fill="#faebd7" fontSize={13} fontWeight={700}>◆</text><circle cx={128} cy={30} r={14} fill="#b87333"/><text x={128} y={34} textAnchor="middle" fill="#faebd7" fontSize={13} fontWeight={700}>●</text><circle cx={128} cy={70} r={14} fill="#6b8e23"/><text x={128} y={74} textAnchor="middle" fill="#faebd7" fontSize={13} fontWeight={700}>◇</text><circle cx={128} cy={30} r={18} fill="none" stroke="#b8860b" strokeWidth={2} strokeDasharray="84 29" strokeLinecap="round" transform="rotate(-90 128 30)"/><circle cx={128} cy={70} r={18} fill="none" stroke="#b8860b" strokeWidth={1.5} strokeDasharray="40 73" strokeLinecap="round" transform="rotate(-90 128 70)"/></svg>
              </div>
              <div className="app-welcome-actions">
                <button className="app-welcome-btn" onClick={() => { seedDemo(); }}>▶  LOAD DEMO</button>
                <button className="app-welcome-btn app-welcome-btn-outline" onClick={() => setShowImport(true)}>📋  PASTE</button>
                <a href="https://github.com/zz-plant/ambit" target="_blank" rel="noopener" className="app-welcome-btn app-welcome-btn-outline">⭐  GITHUB</a>
              </div>
              <div className="app-welcome-code"><code>git clone https://github.com/zz-plant/ambit.git &amp;&amp; cd ambit &amp;&amp; ./bootstrap.sh</code></div>
              <div className="app-welcome-modes"><span>Click <em>LOAD DEMO</em> to see a sample capability graph</span><span>Select any node and check <em>DIAGNOSTICS</em> in the sidebar</span><span>Toggle <em>ERAS</em> layout mode for an era-column tech tree view</span></div>
            </div>
          </div>
        )}
        {items.length > 0 && layoutMode === 'civ' ? (
          <CivTree items={items} connections={connections} selectedId={selectedId} hoveredId={hoveredId} onSelect={selectItem} onHover={hoverItem} leftInset={leftOpen ? 348 : 8} />
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
        <button className="app-hud-btn" onClick={() => { setShowDocs(true); dismissGuide(); }} style={{fontWeight:600,fontSize:12,letterSpacing:1}}>DOCS</button>
        <button className="app-hud-btn" onClick={captureGraph} title="Save the current view as a PNG">📷 PNG</button>
        <div style={{ display: 'flex', gap: '1px', border: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '1px', marginLeft: '8px' }}>
          {([['config', 'CONFIG'], ['tree', 'TECH TREE']] as const).map(([id, label]) => (
            <button key={id} className="app-hud-btn"
              style={{ width:'auto', padding:'0 8px', border:'none', background: source === id ? 'var(--accent)' : 'transparent', color: source === id ? 'var(--bg-deep)' : 'var(--text-muted)', fontWeight: source === id ? 700 : 'normal', fontSize:'9px', height:'22px' }}
              onClick={() => { setSource(id); selectItem(null); id === 'tree' ? loadTechTree() : loadConfigSource(); }}
              title={id === 'tree' ? 'Curated capability tree — what you have reached and what is next' : 'Your config as a graph'}>
              {label}
            </button>
          ))}
        </div>
        {/* Four buttons for a single choice. One control says the same thing
            and names the mode you are in. */}
        <select
          className="app-hud-select"
          value={layoutMode}
          onChange={e => { setLayoutMode(e.target.value as LayoutMode); dismissGuide(); }}
          title="How to draw the graph"
        >
          {LAYOUT_MODES.map(({ id: m, label, title }) => (
            <option key={m} value={m}>{label} — {title}</option>
          ))}
        </select>
        {/* Only ERAS filters by type; the 3D layouts render every item, so
            showing this there would be an inert control. */}
        {layoutMode === 'civ' && source === 'config' && (
        <div style={{ display: 'flex', gap: '1px', border: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '1px' }}>
          {(['all', 'server', 'agent', 'skill', 'combo'] as const).map(f => (
            <button key={f} className="app-hud-btn"
              style={{ width:'auto', padding:'0 8px', border:'none', background: treeFilter === f ? 'var(--accent)' : 'transparent', color: treeFilter === f ? 'var(--bg-deep)' : 'var(--text-muted)', fontWeight: treeFilter === f ? 700 : 'normal', fontSize:'12px', height:'22px' }}
              onClick={() => setTreeFilter(f)}
              title={f === 'all' ? 'Show every capability' : `Show only ${f}s and frameworks`}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        )}
      </div>

      <UplinkModal isOpen={showUplinkModal} onClose={() => setShowUplinkModal(false)} />

      <DocsModal isOpen={showDocs} onClose={() => setShowDocs(false)} />

      {showImport && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={() => setShowImport(false)}>
          <div style={{ background:'#faf3e0', borderRadius:8, maxWidth:500, width:'90%', padding:28, border:'1px solid #c4a96a' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin:'0 0 4px 0', fontSize:14, fontWeight:700, letterSpacing:1.5, color:'#6b5b3a' }}>IMPORT A GRAPH</h3>
            <p style={{ margin:'0 0 12px 0', fontSize:12, color:'#8b7355' }}>Run <code style={{background:'#f0dbb8', padding:'1px 4px', borderRadius:3}}>tt export</code> locally, copy the output, and paste below.</p>
            <textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="Paste JSON from tt export here..." style={{ width:'100%', height:200, fontFamily:'monospace', fontSize:13, padding:10, border:'1px solid #c4a96a', borderRadius:4, background:'#f0dbb8', resize:'vertical', color:'#4a3728' }} />
            <div style={{ display:'flex', gap:8, marginTop:12, justifyContent:'flex-end' }}>
              <button onClick={() => setShowImport(false)} style={{ padding:'6px 14px', fontSize:12, fontWeight:600, letterSpacing:1, border:'1px solid #c4a96a', background:'transparent', color:'#8b7355', borderRadius:3, cursor:'pointer' }}>CANCEL</button>
              <button onClick={() => { if (loadFromJSON(importText)) { setShowImport(false); setImportText(''); } }} style={{ padding:'6px 14px', fontSize:12, fontWeight:600, letterSpacing:1, border:'1px solid #b8860b', background:'#b8860b', color:'#faf3e0', borderRadius:3, cursor:'pointer' }}>LOAD GRAPH</button>
            </div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <span className="app-footer-title">◈ AMBIT</span>
        <span className="app-footer-info">
          {items.length} capabilities · {items.filter(i => i.status === 'built').length} built
        </span>
      </footer>
    </div>
  );
}
