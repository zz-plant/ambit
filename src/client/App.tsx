import React, { useEffect, useState, Suspense } from 'react';
const CivTree = React.lazy(() => import('./components/CivTree'));
import NodeDetailPanel from './components/NodeDetailPanel';

import CapabilityListPanel from './components/CapabilityListPanel';
import DocsModal from './components/DocsModal';
import { useToolchainStore, backendAvailable } from './store/toolchainStore';
import DemoDashboard from './components/DemoDashboard';
import { demoGraphExport } from './utils/demoSnapshot';

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
  const showDetailPanel = useToolchainStore(s => s.showDetailPanel);
  const selectedId = useToolchainStore(s => s.selectedItem);
  const selectItem = useToolchainStore(s => s.selectItem);
  const loading = useToolchainStore(s => s.loading);
  const error = useToolchainStore(s => s.error);
  const loadConfig = useToolchainStore(s => s.loadConfig);
  const seedDemo = useToolchainStore(s => s.seedDemo);
  const loadFromJSON = useToolchainStore(s => s.loadFromJSON);
  const hoveredId = useToolchainStore(s => s.hoveredItem);
  const hoverItem = useToolchainStore(s => s.hoverItem);

  const showUplinkModal = useToolchainStore(s => s.showUplinkModal);
  const setShowUplinkModal = useToolchainStore(s => s.setShowUplinkModal);

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
  // A transient notice from the AG-UI stream — an approval minted in the
  // browser broker, a proposal drafted — so the negotiation surface speaks
  // even while the graph view is the focus.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const loadTechTree = useToolchainStore(s => s.loadTechTree);
  const loadConfigSource = useToolchainStore(s => s.loadConfig);
  // ?view=tree and ?docs=open make a particular view linkable — useful for
  // sharing a specific angle, and for capturing documentation screenshots
  // reproducibly.
  const params = new URLSearchParams(window.location.search);
  const [source, setSource] = useState<'config' | 'tree'>(
    params.get('view') === 'tree' ? 'tree' : 'config'
  );
  const treeFilter = useToolchainStore(s => s.treeFilter);
  const setTreeFilter = useToolchainStore(s => s.setTreeFilter);
  // ?view=tree and ?docs=open make a particular view linkable — useful for
  // sharing a specific angle, and for capturing documentation screenshots
  // reproducibly.
  // ?treeFilter=compact remembers which domain filter you chose across sessions.
  // makes it linkable, like ?view=tree.
  const demo = useToolchainStore(s => s.demo);
  const [view, setView] = useState<'graph' | 'loop'>(params.get('view') === 'loop' ? 'loop' : 'graph');
  const [focusId, setFocusId] = useState<string | null>(params.get('focus') || null);
  const [treeFilterFromURL, setTreeFilterFromURL] = useState<'all' | 'server' | 'agent' | 'skill' | 'combo' | 'compact'>(
    params.get('treeFilter') as 'all' | 'server' | 'agent' | 'skill' | 'combo' | 'compact' || 'all'
  );

  const captureGraph = () => {
    const svg = document.querySelector<SVGSVGElement>('.app-scene svg')!;
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
  // The panel is 340px of absolutely-positioned overlay. On a phone that is the
  // whole screen: it covered the landing page, including the button that loads
  // the demo, so the published demo was unusable on the device most people
  // follow a link from. Narrow screens start with it closed, and it opens as a
  // bottom sheet rather than a left rail — see the mobile block in App.css.
  const NARROW = '(max-width: 768px)';
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW).matches
  );
  const [leftOpen, setLeftOpen] = useState(() => !isNarrow);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(NARROW);
    const onChange = (e: MediaQueryListEvent) => {
      setIsNarrow(e.matches);
      setLeftOpen(!e.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // AG-UI state stream: the graph is rebuilt by an external process (a seed, an
  // adapter), so the view goes stale with no way to know. StateSnapshot and
  // StateDelta events say when to reload — a delta is RFC 6902 patches against
  // the last snapshot, and either one means the graph underneath changed. Only
  // the state subset of AG-UI is implemented; see the note on /api/events in
  // server.ts.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    // A static site (the published demo) has no /api/events; opening the
    // stream there is a 404 that reconnects forever. Only subscribe when a
    // live backend answered the health probe.
    let es: EventSource | null = null;
    let cancelled = false;
    backendAvailable().then(ok => {
      if (!ok || cancelled) return;
      es = new EventSource('/api/events');
      let last = '';
      es.onmessage = e => {
        try {
          const event = JSON.parse(e.data);
          // Proposal lifecycle events are the negotiation surface: a browser
          // approval or a drafted proposal becomes a notice to act on, with the
          // exact command the terminal would run.
          if (event.type === 'ProposalApproved') {
            setToast(`Approved: ${event.proposalId} — review with \`ambit proposal ${event.proposalId}\`, apply with \`ambit apply ${event.proposalId}\`.`);
            return;
          }
          if (event.type === 'WorkEvent') return; // telemetry, not a view change
          // StateSnapshot carries the whole state; StateDelta is a change to it.
          // Either one is a signal to refetch the graph — the visualiser renders
          // the graph, not the counts, so the patch itself is not applied here.
          if (event.type !== 'StateSnapshot' && event.type !== 'StateDelta') return;
          const fingerprint = event.type === 'StateDelta'
            ? 'delta:' + JSON.stringify(event.delta)
            : JSON.stringify(event.snapshot);
          if (last && fingerprint !== last) {
            source === 'tree' ? loadTechTree() : loadConfig();
          }
          last = fingerprint;
        } catch { /* a malformed frame should not take the view down */ }
      };
      // Deliberately no onerror handler that closes: EventSource reconnects on
      // its own, and closing on the first transient error disabled live updates
      // permanently for the rest of the session.
    });
    return () => { cancelled = true; es?.close(); };
  }, [source, loadTechTree, loadConfig]);

  useEffect(() => {
    if (params.get('guide') === 'off') dismissGuide();
    if (source === 'tree') loadTechTree(); else loadConfig();
    // Intentionally once on mount; the toggles drive later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (focusId && items.length > 0) {
      const item = items.find(i => i.id === focusId);
      if (item) selectItem(item.id);
    }
  }, [focusId, items.length, selectItem]);

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
            {typeof window !== 'undefined' &&
              !backendAvailable() && (
                <div style={{ marginTop: '8px', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                  <strong>Published demo note:</strong> Live updates require a running backend. 
                  <a href="https://zz-plant.github.io/ambit/" style={{ color: 'var(--text-muted)' }} target="_blank" rel="noopener">Open the demo</a> 
                  or <code>node src/engine/engine.ts seed</code> locally for full functionality.
                </div>
              )}
          </div>
        )}
        {showGuide && view === 'graph' && items.length > 0 && (
          <div
            className="app-guide"
            // Centred on the scene, the side panels covered half of it. Inset by
            // whichever panels are actually open so it centres on free space.
            // On a narrow screen the panels are sheets, not rails, so insetting
            // by their width would push this off the side entirely.
            style={isNarrow ? undefined : { left: leftOpen ? 340 : 0, right: showDetailPanel && selectedId ? 340 : 0 }}
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
              <div className="app-welcome-tagline">What your system can do —<br/>what it costs, and what is one step away.</div>
              <div className="app-welcome-diagram">
                <svg width="300" height="100" viewBox="0 0 300 100"><rect x={0} y={0} width={300} height={100} rx={6} fill="#e8d5a8" opacity={0.5}/><line x1={52} y1={50} x2={128} y2={30} stroke="#8b6914" strokeWidth={1.5}/><line x1={152} y1={50} x2={128} y2={30} stroke="#b8a060" strokeWidth={1} strokeDasharray="5,3"/><line x1={52} y1={50} x2={128} y2={70} stroke="#8b6914" strokeWidth={1.5}/><line x1={252} y1={50} x2={128} y2={70} stroke="#b8a060" strokeWidth={1} strokeDasharray="5,3"/><circle cx={52} cy={50} r={16} fill="#b8860b"/><text x={52} y={55} textAnchor="middle" fill="#faebd7" fontSize={13} fontWeight={700}>◈</text><circle cx={252} cy={50} r={16} fill="#cd853f"/><text x={252} y={55} textAnchor="middle" fill="#faebd7" fontSize={13} fontWeight={700}>◆</text><circle cx={128} cy={30} r={14} fill="#b87333"/><text x={128} y={34} textAnchor="middle" fill="#faebd7" fontSize={13} fontWeight={700}>●</text><circle cx={128} cy={70} r={14} fill="#6b8e23"/><text x={128} y={74} textAnchor="middle" fill="#faebd7" fontSize={13} fontWeight={700}>◇</text><circle cx={128} cy={30} r={18} fill="none" stroke="#b8860b" strokeWidth={2} strokeDasharray="84 29" strokeLinecap="round" transform="rotate(-90 128 30)"/><circle cx={128} cy={70} r={18} fill="none" stroke="#b8860b" strokeWidth={1.5} strokeDasharray="40 73" strokeLinecap="round" transform="rotate(-90 128 70)"/></svg>
              </div>
              <div className="app-welcome-actions">
                <button className="app-welcome-btn" onClick={() => { seedDemo(); }}>▶  LOAD DEMO</button>
                <button className="app-welcome-btn" onClick={() => { seedDemo(); setView('loop'); }}>◈  SEE THE LOOP</button>
                <button className="app-welcome-btn app-welcome-btn-outline" onClick={() => setShowImport(true)}>📋  PASTE</button>
                <a href="https://github.com/zz-plant/ambit" target="_blank" rel="noopener" className="app-welcome-btn app-welcome-btn-outline">⭐  GITHUB</a>
              </div>
              <div className="app-welcome-code"><code>node src/engine/engine.ts seed &amp;&amp; node src/engine/engine.ts status</code></div>
              <div className="app-welcome-modes"><span><em>LOAD DEMO</em> — a sample capability graph to click around</span><span><em>SEE THE LOOP</em> — where time goes, what to build next, what it paid back</span><span>The real thing: Node 22, no dependencies — one command</span></div>
            </div>
          </div>
        )}
        {view === 'loop' && demo ? (
          <DemoDashboard />
        ) : items.length > 0 ? (
          <Suspense fallback={<div className="app-loading"><div className="app-loading-ring" /><p>Loading capability graph…</p></div>}>
            <CivTree items={items} connections={connections} selectedId={selectedId} hoveredId={hoveredId} onSelect={selectItem} onHover={hoverItem} leftInset={leftOpen && !isNarrow ? 348 : 8} />
          </Suspense>
        ) : null}
      </div>

      {showDetailPanel && selectedId && (
        <aside className="app-detail-panel" aria-label="Capability details">
          <NodeDetailPanel />
        </aside>
      )}

      <aside className={`app-console ${leftOpen ? 'app-console--open' : ''}`}>
        <CapabilityListPanel />
      </aside>

      <div className="app-hud">
        <button className="app-hud-btn" onClick={() => setLeftOpen(o => !o)} title="Toggle panel"> {leftOpen ? '◀' : '▶'} </button>
        <button className="app-hud-btn" onClick={() => { setShowDocs(true); dismissGuide(); }} style={{fontWeight:600,fontSize:12,letterSpacing:1}}>DOCS</button>
        <button className="app-hud-btn" onClick={captureGraph} title="Save the current view as a PNG">📷 PNG</button>
        {demo && (
          <div style={{ display: 'flex', gap: '1px', border: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '1px', marginLeft: '8px' }}>
            {([['graph', 'GRAPH'], ['loop', 'THE LOOP']] as const).map(([id, label]) => (
              <button key={id} className="app-hud-btn"
                style={{ width:'auto', padding:'0 8px', border:'none', background: view === id ? 'var(--accent)' : 'transparent', color: view === id ? 'var(--bg-deep)' : 'var(--text-muted)', fontWeight: view === id ? 700 : 'normal', fontSize:'9px', height:'22px' }}
                onClick={() => setView(id)}
                title={id === 'loop' ? 'The economic loop — where time goes, what to build next, what it paid back' : 'The capability graph'}>
                {label}
              </button>
            ))}
          </div>
        )}
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
        {source === 'config' && (
        <div style={{ display: 'flex', gap: '1px', border: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '1px' }}>
          {(['all', 'server', 'agent', 'skill', 'combo', 'compact'] as const).map(f => {
            const isFilter = treeFilter === f;
            // Check if URL has a treeFilter param that matches this button
            const urlMatch = treeFilterFromURL === f;
            // Initial: use URL param on first mount with tree view, then fall back to store state
            const initial = urlMatch ? treeFilterFromURL : (isFilter ? treeFilter : 'all');
            return (
              <button key={f} className="app-hud-btn"
                style={{ width:'auto', padding:'0 8px', border:'none', background: initial === f ? 'var(--accent)' : 'transparent', color: initial === f ? 'var(--bg-deep)' : 'var(--text-muted)', fontWeight: initial === f ? 700 : 'normal', fontSize:'12px', height:'22px' }}
                onClick={() => {
                  const newFilter = f === 'compact' ? 'compact' : f;
                  setTreeFilter(newFilter);
                  // Also update URL param for persistence (but don't cause a full reload)
                  if (typeof window !== 'undefined') {
                    const url = new URL(window.location.href);
                    url.searchParams.set('treeFilter', newFilter);
                    window.history.replaceState({}, document.title, url);
                  }
                }}
                title={f === 'compact' ? 'Show only essential domains (ai-ml, backend, infra, frontend, meta, quality)' : `Show only ${f}s and frameworks`}>
                {f.toUpperCase()}
              </button>
            );
          })}
        </div>
        )}
      </div>

      <UplinkModal isOpen={showUplinkModal} onClose={() => setShowUplinkModal(false)} />

      <DocsModal isOpen={showDocs} onClose={() => setShowDocs(false)} />

      {showImport && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={() => setShowImport(false)}>
          <div style={{ background:'#faf3e0', borderRadius:8, maxWidth:500, width:'90%', padding:28, border:'1px solid #c4a96a' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin:'0 0 4px 0', fontSize:14, fontWeight:700, letterSpacing:1.5, color:'#6b5b3a' }}>IMPORT A GRAPH</h3>
            <p style={{ margin:'0 0 12px 0', fontSize:12, color:'#8b7355' }}>Run <code style={{background:'#f0dbb8', padding:'1px 4px', borderRadius:3}}>ambit graph</code> locally and paste the output — or load a sample to see the shape.</p>
            <textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="Paste JSON from ambit graph here, or load a sample…" style={{ width:'100%', height:200, fontFamily:'monospace', fontSize:13, padding:10, border:'1px solid #c4a96a', borderRadius:4, background:'#f0dbb8', resize:'vertical', color:'#4a3728' }} />
            <div style={{ display:'flex', gap:8, marginTop:12, justifyContent:'flex-end' }}>
              <button onClick={() => setShowImport(false)} style={{ padding:'6px 14px', fontSize:12, fontWeight:600, letterSpacing:1, border:'1px solid #c4a96a', background:'transparent', color:'#8b7355', borderRadius:3, cursor:'pointer' }}>CANCEL</button>
              <button onClick={() => setImportText(demoGraphExport())} style={{ padding:'6px 14px', fontSize:12, fontWeight:600, letterSpacing:1, border:'1px solid #c4a96a', background:'transparent', color:'#8b7355', borderRadius:3, cursor:'pointer' }}>LOAD SAMPLE</button>
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

      {toast && (
        <div role="status" className="ambit-toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}

      {/* Selecting a node opens a panel elsewhere in the document, which is a
          silent change to anyone not watching it happen. */}
      <div className="visually-hidden" role="status" aria-live="polite">
        {selectedId
          ? (() => {
              const item = items.find(i => i.id === selectedId);
              return item ? `Selected ${item.name}. ${item.status === 'built' ? 'Reached' : 'Not reached'}.` : '';
            })()
          : ''}
      </div>
    </div>
  );
}