import React, { useEffect, useState, Suspense } from 'react';
const CivTree = React.lazy(() => import('./components/CivTree'));
import NodeDetailPanel from './components/NodeDetailPanel';

import CapabilityListPanel from './components/CapabilityListPanel';
import DocsModal from './components/DocsModal';
import ApprovalModal from './components/ApprovalModal';
import { useToolchainStore, backendAvailable, TREE_FILTERS } from './store/toolchainStore';
import DemoDashboard from './components/DemoDashboard';
import { demoGraphExport } from './utils/demoSnapshot';

const MCP_PRESETS = [
  { name: 'github', label: '🐙 GitHub', command: 'npx -y @modelcontextprotocol/server-github', env: 'GITHUB_PERSONAL_ACCESS_TOKEN=your_token_here' },
  { name: 'postgres', label: '🐘 PostgreSQL', command: 'npx -y @modelcontextprotocol/server-postgres postgresql://localhost/mydb', env: '' },
  { name: 'cloudflare', label: '⚡ Cloudflare', command: 'npx -y @cloudflare/mcp-server-cloudflare', env: 'CLOUDFLARE_API_TOKEN=your_token_here' },
  { name: 'playwright', label: '🎭 Playwright', command: 'npx -y @executeautomation/playwright-mcp-server', env: '' },
  { name: 'filesystem', label: '📁 Filesystem', command: 'npx -y @modelcontextprotocol/server-filesystem /path/to/allowed/directory', env: '' },
  { name: 'brave-search', label: '🦁 Brave Search', command: 'npx -y @modelcontextprotocol/server-brave-search', env: 'BRAVE_API_KEY=your_key_here' },
] as const;

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
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleSelectPreset = (p: typeof MCP_PRESETS[number]) => {
    setName(p.name);
    setType('local');
    setCommand(p.command);
    setEnvStr(p.env);
    setError('');
  };

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
      setError('Something went wrong building the snippet. Try again, or check that the local server is running.');
    }
  };

  return (
    <div className="uplink-modal-overlay" onClick={onClose}>
      <div className="uplink-modal" onClick={e => e.stopPropagation()}>
        <div className="sp-hdr">
          <span className="sp-sig" style={{ color: 'var(--accent)' }}>🔌</span>
          <div className="sp-title-group">
            <div className="sp-designation">Connect a tool server</div>
            <div className="sp-class">Builds a config snippet you paste in — nothing is changed for you</div>
          </div>
          <button className="sp-close" onClick={onClose}>✕</button>
        </div>

        {snippet ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              For safety, Ambit never edits your config itself — this entry tells your agent what command to run.
              Copy it into <code>{snippet.configPath}</code>, then reload this page.
            </div>
            <pre style={{ fontSize: '10px', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px', overflow: 'auto', maxHeight: '220px', margin: 0 }}>{snippet.snippet}</pre>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="sp-action-btn"
                style={{ background: copied ? 'var(--ok)' : undefined, color: copied ? '#000' : undefined, fontWeight: 700 }}
                onClick={() => {
                  navigator.clipboard?.writeText(snippet.snippet);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? '✓ Copied to Clipboard!' : '📋 Copy Snippet'}
              </button>
              <button type="button" className="sp-action-btn" onClick={() => { setSnippet(null); setName(''); setUrl(''); setCommand(''); setEnvStr(''); onClose(); }}>Done</button>
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
          {error && <div style={{ color: 'var(--error)', fontSize: '11px', border: '1px solid var(--error)', padding: '6px', background: 'rgba(255, 51, 68, 0.1)', borderRadius: 'var(--radius)' }}>{error}</div>}

          {/* Quick-Start Presets */}
          <div className="uplink-presets">
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              ⚡ Popular Quick-Start Presets
            </span>
            <div className="uplink-preset-list">
              {MCP_PRESETS.map(p => (
                <button
                  key={p.name}
                  type="button"
                  className={`uplink-preset-btn ${name === p.name ? 'uplink-preset-btn--selected' : ''}`}
                  onClick={() => handleSelectPreset(p)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>Name (a short nickname for this server)</label>
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
              Runs on this computer
            </button>
            <button
              type="button"
              className="tp-btn-sm"
              style={{ flex: 1, borderColor: type === 'remote' ? 'var(--accent)' : 'var(--border)', color: type === 'remote' ? 'var(--accent)' : 'var(--text-muted)' }}
              onClick={() => setType('remote')}
            >
              Runs somewhere else (URL)
            </button>
          </div>

          {type === 'remote' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <label style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>Server address (URL)</label>
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
              <label style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>Command that starts it</label>
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
            <label style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>Settings it needs, if any (KEY=VALUE, one per line)</label>
            <textarea
              placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=your_token_here"
              value={envStr}
              onChange={e => setEnvStr(e.target.value)}
              className="tp-search"
              style={{ minHeight: '60px', fontFamily: 'var(--font)', resize: 'vertical' }}
            />
          </div>

          <button type="submit" className="tp-btn" style={{ width: '100%', marginTop: '10px' }} disabled={loading}>
            {loading ? 'Building…' : 'Build the snippet'}
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
  const showApprovalModal = useToolchainStore(s => s.showApprovalModal);
  const setShowApprovalModal = useToolchainStore(s => s.setShowApprovalModal);
  const proposals = useToolchainStore(s => s.proposals);
  const loadProposals = useToolchainStore(s => s.loadProposals);
  const loadAttentionData = useToolchainStore(s => s.loadAttentionData);
  const activeLens = useToolchainStore(s => s.activeLens);
  const setActiveLens = useToolchainStore(s => s.setActiveLens);

  const [showDocs, setShowDocs] = useState(() => new URLSearchParams(window.location.search).get('docs') === 'open');
  // ?demo=1 skips the LOAD DEMO click so a shared link opens already showing the graph.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('demo') === '1') seedDemo();
    loadProposals();
    loadAttentionData();
  }, []);
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
  // ?view=tree, ?docs=open, ?focus=<id> and ?treeFilter=<domain> make a
  // particular state linkable and shareable; the filter itself is owned by the
  // store (see readInitialTreeFilter), which persists it across sessions.
  const demo = useToolchainStore(s => s.demo);
  const [view, setView] = useState<'graph' | 'loop'>(params.get('view') === 'loop' ? 'loop' : 'graph');
  const [focusId, setFocusId] = useState<string | null>(params.get('focus') || null);

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
      ctx.fillStyle = '#030712';
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
    // ?demo=1 already seeded the graph above; loadConfig()'s no-backend path
    // would otherwise clobber that seeded data back to an empty graph.
    if (params.get('demo') === '1') return;
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

  // Global hotkey manager: [/] to search, [\] to toggle console, [?] for docs, [g] for governance, [Esc] to clear/close
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        if (e.key === 'Escape') {
          target.blur();
        }
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        setLeftOpen(true);
        setTimeout(() => {
          const input = document.getElementById('tp-search-input');
          input?.focus();
        }, 60);
      } else if (e.key === '\\') {
        e.preventDefault();
        setLeftOpen(o => !o);
      } else if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setShowDocs(o => !o);
      } else if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        const curr = useToolchainStore.getState().showApprovalModal;
        setShowApprovalModal(!curr);
        if (!curr) loadProposals();
      } else if (e.key === 'Escape') {
        setShowUplinkModal(false);
        setShowApprovalModal(false);
        setShowDocs(false);
        setShowImport(false);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [loadProposals, setShowApprovalModal, setShowUplinkModal]);

  return (
    <div className="app">
      {/* ─── TOP COMMAND DECK (PRIMARY IA ANCHOR) ─── */}
      <header className="app-deck">
        <div className="app-deck-left">
          <button
            type="button"
            className="app-deck-btn"
            onClick={() => setLeftOpen(o => !o)}
            title="Toggle capabilities console (Hotkey: \)"
          >
            {leftOpen ? '◀ CONSOLE' : '▶ CONSOLE'}
          </button>
          <div className="app-brand-group">
            <span className="app-brand">◈ AMBIT</span>
          </div>
          <div className="app-status-pill">
            <span style={{ color: 'var(--ok)' }}>●</span>
            <span>{items.filter(i => i.status === 'built').length}/{items.length} REACHED</span>
          </div>
        </div>

        <div className="app-deck-center">
          <nav className="app-deck-nav" aria-label="Primary Navigation">
            <button
              type="button"
              className={`app-deck-tab ${view === 'graph' && source === 'tree' ? 'app-deck-tab--active' : ''}`}
              onClick={() => { setView('graph'); setSource('tree'); selectItem(null); loadTechTree(); }}
              title="The capability tech tree — prerequisites, frontier, and compound paths"
            >
              🌐 TECH TREE
            </button>
            <button
              type="button"
              className={`app-deck-tab ${view === 'graph' && source === 'config' ? 'app-deck-tab--active' : ''}`}
              onClick={() => { setView('graph'); setSource('config'); selectItem(null); loadConfigSource(); }}
              title="My Setup — discovered local runtimes, tools, and agents"
            >
              ⚙️ MY SETUP
            </button>
            {demo && (
              <button
                type="button"
                className={`app-deck-tab ${view === 'loop' ? 'app-deck-tab--active' : ''}`}
                onClick={() => { setView('loop'); selectItem(null); }}
                title="The Economic Loop — attention telemetry, ROI tracking, and ranked investments"
              >
                ⚡ THE LOOP
              </button>
            )}
            <button
              type="button"
              className={`app-deck-btn ${proposals.some(p => p.status === 'draft') ? 'app-deck-btn--alert' : ''}`}
              onClick={() => { setShowApprovalModal(true); loadProposals(); }}
              title="Review and sign environment configuration proposals"
            >
              📜 GOVERNANCE {proposals.filter(p => p.status === 'draft').length > 0 && `(${proposals.filter(p => p.status === 'draft').length})`}
            </button>
          </nav>
        </div>

        <div className="app-deck-right">
          {view === 'graph' && (
            <div className="app-deck-nav">
              {([
                ['default', 'Standard', '1'],
                ['attention', 'Attention', '2'],
                ['credentials', 'SPOFs', '3'],
                ['topology', 'Topology', '4'],
              ] as const).map(([lensKey, label, hotkey]) => (
                <button
                  key={lensKey}
                  type="button"
                  className={`app-deck-tab ${activeLens === lensKey ? 'app-deck-tab--active' : ''}`}
                  onClick={() => setActiveLens(lensKey)}
                  title={`Shortcut: Press ${hotkey}`}
                >
                  {label} <span style={{ opacity: 0.6, fontSize: '10px' }}>[{hotkey}]</span>
                </button>
              ))}
            </div>
          )}
          <button type="button" className="app-deck-btn" onClick={() => setShowDocs(true)} title="Documentation & Concepts">📖 DOCS</button>
          <button type="button" className="app-deck-btn" onClick={() => setShowUplinkModal(true)} title="Connect tool server">🔌 CONNECT</button>
          <button type="button" className="app-deck-btn" onClick={() => setShowImport(true)} title="Import graph JSON">📋 IMPORT</button>
          <button type="button" className="app-deck-btn" onClick={captureGraph} title="Export PNG snapshot">📷 PNG</button>
        </div>
      </header>

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
            <button className="tp-btn" onClick={() => loadConfig()}>Try again</button>
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
            style={isNarrow ? undefined : { left: leftOpen ? 340 : 0, right: showDetailPanel && selectedId ? 340 : 0 }}
          >
            <div className="app-guide-head">
              <strong>Start here</strong>
              <button className="app-guide-close" onClick={dismissGuide} aria-label="Dismiss">✕</button>
            </div>
            <ol className="app-guide-steps">
              <li><strong>Click any circle</strong> to see what depends on it.</li>
              <li><strong>Outlined circles</strong> are capabilities you have not reached — their description says what is missing.</li>
              <li><strong>TECH TREE</strong> shows where you are on the capability tree; <strong>MY SETUP</strong> shows everything in your setup and how it connects.</li>
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
                <svg width="340" height="110" viewBox="0 0 340 110">
                  <defs>
                    <linearGradient id="heroCopper" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#ff3300" />
                      <stop offset="50%" stopColor="#ffaa00" />
                      <stop offset="100%" stopColor="#ffd700" />
                    </linearGradient>
                    <linearGradient id="heroCyan" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#00f0ff" />
                      <stop offset="100%" stopColor="#00ff88" />
                    </linearGradient>
                    <filter id="heroGlow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                  </defs>
                  <rect x={0} y={0} width={340} height={110} rx={8} fill="#050c18" stroke="#162840" strokeWidth={1}/>
                  
                  {/* Gridlines */}
                  <line x1={20} y1={55} x2={320} y2={55} stroke="#0e1d30" strokeWidth={1} strokeDasharray="4,4"/>
                  <line x1={170} y1={10} x2={170} y2={100} stroke="#0e1d30" strokeWidth={1} strokeDasharray="4,4"/>

                  {/* Laser Lines */}
                  <line x1={56} y1={55} x2={146} y2={35} stroke="url(#heroCyan)" strokeWidth={2} opacity={0.8} filter="url(#heroGlow)"/>
                  <line x1={170} y1={55} x2={146} y2={35} stroke="#38557a" strokeWidth={1.2} strokeDasharray="4,3"/>
                  <line x1={56} y1={55} x2={146} y2={75} stroke="url(#heroCopper)" strokeWidth={2} opacity={0.8} filter="url(#heroGlow)"/>
                  <line x1={284} y1={55} x2={146} y2={75} stroke="#38557a" strokeWidth={1.2} strokeDasharray="4,3"/>
                  
                  {/* Nodes */}
                  <circle cx={56} cy={55} r={18} fill="#00f0ff" opacity={0.9} filter="url(#heroGlow)"/>
                  <circle cx={56} cy={55} r={18} fill="none" stroke="#ffffff" strokeWidth={1.5}/>
                  <text x={56} y={60} textAnchor="middle" fill="#030712" fontSize={14} fontWeight={800}>◈</text>
                  
                  <circle cx={284} cy={55} r={18} fill="#ff007f" opacity={0.9} filter="url(#heroGlow)"/>
                  <circle cx={284} cy={55} r={18} fill="none" stroke="#ffffff" strokeWidth={1.5}/>
                  <text x={284} y={60} textAnchor="middle" fill="#030712" fontSize={14} fontWeight={800}>◆</text>
                  
                  <circle cx={146} cy={35} r={15} fill="#ffaa00" opacity={0.9}/>
                  <text x={146} y={40} textAnchor="middle" fill="#030712" fontSize={13} fontWeight={800}>●</text>
                  
                  <circle cx={146} cy={75} r={15} fill="#00ff88" opacity={0.9}/>
                  <text x={146} y={80} textAnchor="middle" fill="#030712" fontSize={13} fontWeight={800}>◇</text>
                  
                  <circle cx={146} cy={35} r={20} fill="none" stroke="#00f0ff" strokeWidth={2} strokeDasharray="6,4" opacity={0.8} />
                  <circle cx={146} cy={75} r={20} fill="none" stroke="#ffaa00" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.8} />
                </svg>
              </div>
              <div className="app-welcome-actions">
                <button className="app-welcome-btn" onClick={() => { seedDemo(); }}>▶  LOAD DEMO</button>
                <button className="app-welcome-btn" onClick={() => { seedDemo(); setView('loop'); }}>◈  SEE THE LOOP</button>
                <button className="app-welcome-btn app-welcome-btn-outline" onClick={() => setShowImport(true)}>📋  PASTE YOUR OWN</button>
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

      {leftOpen && isNarrow && (
        <div className="app-drawer-backdrop" onClick={() => setLeftOpen(false)} aria-hidden="true" />
      )}

      <aside className={`app-console ${leftOpen ? 'app-console--open' : ''}`}>
        <CapabilityListPanel />
      </aside>

      <UplinkModal isOpen={showUplinkModal} onClose={() => setShowUplinkModal(false)} />

      <ApprovalModal isOpen={showApprovalModal} onClose={() => setShowApprovalModal(false)} />

      <DocsModal isOpen={showDocs} onClose={() => setShowDocs(false)} />

      {showImport && (
        <div style={{ position:'fixed', inset:0, background:'rgba(2, 6, 14, 0.82)', backdropFilter: 'blur(8px)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={() => setShowImport(false)}>
          <div style={{ background:'var(--bg-surface)', borderRadius:'var(--radius-lg)', maxWidth:520, width:'90%', padding:26, border:'1px solid var(--border-bright)', boxShadow: '0 24px 64px rgba(0,0,0,0.85), var(--accent-glow)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin:'0 0 6px 0', fontSize:15, fontWeight:700, letterSpacing:1.5, color:'var(--accent)', textTransform: 'uppercase' }}>IMPORT A GRAPH</h3>
            <p style={{ margin:'0 0 14px 0', fontSize:12, color:'var(--text-secondary)' }}>Run <code style={{background:'var(--bg-deep)', color:'var(--accent)', padding:'2px 6px', borderRadius:3, border:'1px solid var(--border)'}}>ambit graph</code> locally and paste the output — or load a sample to see the shape.</p>
            <textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="Paste JSON from ambit graph here, or load a sample…" style={{ width:'100%', height:200, fontFamily:'var(--font)', fontSize:12, padding:10, border:'1px solid var(--border)', borderRadius:'var(--radius-xs)', background:'var(--bg-deep)', resize:'vertical', color:'var(--text-primary)', outline: 'none' }} />
            <div style={{ display:'flex', gap:8, marginTop:14, justifyContent:'flex-end' }}>
              <button onClick={() => setShowImport(false)} className="tp-btn-sm" style={{ padding: '6px 14px' }}>CANCEL</button>
              <button onClick={() => setImportText(demoGraphExport())} className="tp-btn-sm" style={{ padding: '6px 14px', borderColor: 'var(--accent-dim)', color: 'var(--accent)' }}>LOAD SAMPLE</button>
              <button onClick={() => { if (loadFromJSON(importText)) { setShowImport(false); setImportText(''); } }} className="tp-btn" style={{ padding: '6px 16px', background: 'var(--accent)', color: 'var(--bg-deep)', borderColor: 'var(--accent)' }}>LOAD GRAPH</button>
            </div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <span className="app-footer-info">
          ◈ AMBIT · {items.length} capabilities · {items.filter(i => i.status === 'built').length} reached
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 0.5 }}>
          KEYS: [J/K] NAVIGATE · [1-4] SWITCH LENS · [/] SEARCH · [ESC] CLEAR · [?] DOCS · [G] GOV
        </span>
        <span className="app-footer-info">
          <a href="https://github.com/zz-plant/ambit" target="_blank" rel="noopener" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>GITHUB ↗</a>
        </span>
      </footer>

      {toast && (
        <div role="status" className="ambit-toast">
          <span>{toast}</span>
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px', justifyContent: 'flex-end' }}>
            {toast.includes('Approved:') && (
              <button
                type="button"
                className="tp-btn-sm"
                style={{ fontSize: '10px', padding: '2px 8px', color: 'var(--ok)', borderColor: 'var(--ok)' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowApprovalModal(true);
                  setToast(null);
                }}
              >
                View Governance
              </button>
            )}
            <button
              type="button"
              className="tp-btn-sm"
              style={{ fontSize: '10px', padding: '2px 8px' }}
              onClick={(e) => {
                e.stopPropagation();
                setToast(null);
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

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