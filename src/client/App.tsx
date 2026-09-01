import React, { useEffect, useState, Suspense } from 'react';
const CivTree = React.lazy(() => import('./components/CivTree'));
import NodeDetailPanel from './components/NodeDetailPanel';

import CapabilityListPanel from './components/CapabilityListPanel';
import DocsModal from './components/DocsModal';
import ApprovalModal from './components/ApprovalModal';
import { useToolchainStore, backendAvailable } from './store/toolchainStore';
import DemoDashboard from './components/DemoDashboard';

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
  const hoveredId = useToolchainStore(s => s.hoveredItem);
  const hoverItem = useToolchainStore(s => s.hoverItem);

  const showApprovalModal = useToolchainStore(s => s.showApprovalModal);
  const setShowApprovalModal = useToolchainStore(s => s.setShowApprovalModal);
  const proposals = useToolchainStore(s => s.proposals);
  const loadProposals = useToolchainStore(s => s.loadProposals);
  const loadAttentionData = useToolchainStore(s => s.loadAttentionData);
  const activeLens = useToolchainStore(s => s.activeLens);
  const setActiveLens = useToolchainStore(s => s.setActiveLens);

  const [showDocs, setShowDocs] = useState(
    () => new URLSearchParams(window.location.search).get('docs') === 'open'
  );
  // ?demo=1 skips the LOAD DEMO click so a shared link opens already showing the graph.
  // Deliberately mount-only. These are store actions with stable identities;
  // listing them as dependencies would say this effect may re-run, and
  // re-seeding the demo on a re-render is exactly what it must not do.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('demo') === '1') seedDemo();
    loadProposals();
    loadAttentionData();
  }, []);
  // Shown once on first run, for real configs as well as the demo — it used to
  // fire only after LOAD DEMO, so the normal path taught nothing.
  const [showGuide, setShowGuide] = useState(() => {
    try {
      return localStorage.getItem('cg.seenGuide') !== '1';
    } catch {
      return true;
    }
  });
  const dismissGuide = () => {
    setShowGuide(false);
    try {
      localStorage.setItem('cg.seenGuide', '1');
    } catch {
      /* private mode */
    }
  };
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
  // ?view=tree, ?docs=open, ?focus=<id> and ?treeFilter=<domain> make a
  // particular state linkable and shareable; the filter itself is owned by the
  // store (see readInitialTreeFilter), which persists it across sessions.
  const demo = useToolchainStore(s => s.demo);
  const [view, setView] = useState<'graph' | 'loop'>(
    params.get('view') === 'loop' ? 'loop' : 'graph'
  );
  const [focusId] = useState<string | null>(params.get('focus') || null);

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

  // Viewport squeeze prevention: on medium screens (<1200px), auto-collapse the left console when a node is selected
  useEffect(() => {
    if (selectedId && typeof window !== 'undefined' && window.innerWidth < 1200 && !isNarrow) {
      setLeftOpen(false);
    }
  }, [selectedId, isNarrow]);

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
            setToast(
              `Approved: ${event.proposalId} — review with \`ambit proposal ${event.proposalId}\`, apply with \`ambit apply ${event.proposalId}\`.`
            );
            return;
          }
          if (event.type === 'WorkEvent') return; // telemetry, not a view change
          // StateSnapshot carries the whole state; StateDelta is a change to it.
          // Either one is a signal to refetch the graph — the visualiser renders
          // the graph, not the counts, so the patch itself is not applied here.
          if (event.type !== 'StateSnapshot' && event.type !== 'StateDelta') return;
          const fingerprint =
            event.type === 'StateDelta'
              ? 'delta:' + JSON.stringify(event.delta)
              : JSON.stringify(event.snapshot);
          if (last && fingerprint !== last) {
            source === 'tree' ? loadTechTree() : loadConfig();
          }
          last = fingerprint;
        } catch {
          /* a malformed frame should not take the view down */
        }
      };
      // Deliberately no onerror handler that closes: EventSource reconnects on
      // its own, and closing on the first transient error disabled live updates
      // permanently for the rest of the session.
    });
    return () => {
      cancelled = true;
      es?.close();
    };
  }, [source, loadTechTree, loadConfig]);

  useEffect(() => {
    if (params.get('guide') === 'off') dismissGuide();
    // ?demo=1 already seeded the graph above; loadConfig()'s no-backend path
    // would otherwise clobber that seeded data back to an empty graph.
    if (params.get('demo') === '1') return;
    if (source === 'tree') loadTechTree();
    else loadConfig();
    // Intentionally once on mount; the toggles drive later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTechTree, loadConfig, source, params.get, dismissGuide]);

  useEffect(() => {
    if (focusId && items.length > 0) {
      const item = items.find(i => i.id === focusId);
      if (item) selectItem(item.id);
    }
  }, [focusId, items.length, selectItem, items.find]);

  // Global hotkey manager: [/] to search, [\] to toggle console, [?] for docs, [g] for governance, [Esc] to clear/close
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        if (e.key === 'Escape') {
          target.blur();
        }
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
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
        setShowApprovalModal(false);
        setShowDocs(false);
        selectItem(null);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [loadProposals, setShowApprovalModal, selectItem]);

  return (
    <div className="app">
      {/* ─── TOP NAVIGATION BAR ─── */}
      <header className="app-deck">
        <div className="app-deck-left">
          <button
            type="button"
            className="app-deck-btn"
            onClick={() => setLeftOpen(o => !o)}
            title="Toggle capabilities sidebar (Hotkey: \)"
          >
            <span style={{ fontSize: '12px' }}>{leftOpen ? '◧' : '◫'}</span>
            <span>{leftOpen ? 'Sidebar' : 'Sidebar'}</span>
          </button>
          <div className="app-brand-group">
            <span className="app-brand">Ambit</span>
          </div>
          <div className="app-status-pill">
            <span className="app-status-dot" />
            <span>
              {items.filter(i => i.status === 'built').length} / {items.length} active
            </span>
          </div>
        </div>

        <div className="app-deck-center">
          <nav className="app-deck-nav" aria-label="Primary Navigation">
            <button
              type="button"
              className={`app-deck-tab ${view === 'graph' && source === 'tree' ? 'app-deck-tab--active' : ''}`}
              onClick={() => {
                setView('graph');
                setSource('tree');
                selectItem(null);
                loadTechTree();
              }}
              title="The capability tech tree — prerequisites, frontier, and compound paths"
            >
              Tech Tree
            </button>
            <button
              type="button"
              className={`app-deck-tab ${view === 'graph' && source === 'config' ? 'app-deck-tab--active' : ''}`}
              onClick={() => {
                setView('graph');
                setSource('config');
                selectItem(null);
                loadConfigSource();
              }}
              title="My Setup — discovered local runtimes, tools, and agents"
            >
              My Setup
            </button>
            {demo && (
              <button
                type="button"
                className={`app-deck-tab ${view === 'loop' ? 'app-deck-tab--active' : ''}`}
                onClick={() => {
                  setView('loop');
                  selectItem(null);
                }}
                title="The Economic Loop — attention telemetry, ROI tracking, and ranked investments"
              >
                Economic Loop
              </button>
            )}
            <button
              type="button"
              className={`app-deck-btn ${proposals.some(p => p.status === 'draft') ? 'app-deck-btn--alert' : ''}`}
              onClick={() => {
                setShowApprovalModal(true);
                loadProposals();
              }}
              title="Review and sign environment configuration proposals"
            >
              Proposals{' '}
              {proposals.filter(p => p.status === 'draft').length > 0 &&
                `(${proposals.filter(p => p.status === 'draft').length})`}
            </button>
          </nav>
        </div>

        <div className="app-deck-right">
          {view === 'graph' && (
            <div className="app-deck-nav">
              {(
                [
                  ['default', 'Standard', '1'],
                  ['attention', 'Attention', '2'],
                  ['credentials', 'SPOFs', '3'],
                ] as const
              ).map(([lensKey, label, hotkey]) => (
                <button
                  key={lensKey}
                  type="button"
                  className={`app-deck-tab ${activeLens === lensKey ? 'app-deck-tab--active' : ''}`}
                  onClick={() => setActiveLens(lensKey)}
                  title={`Shortcut: Press ${hotkey}`}
                >
                  {label}{' '}
                  <span style={{ opacity: 0.5, fontSize: '10px', marginLeft: '4px' }}>
                    [{hotkey}]
                  </span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="app-deck-btn"
            onClick={() => setShowDocs(true)}
            title="Documentation & Concepts (Hotkey: ?)"
          >
            Docs
          </button>
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
            <button className="tp-btn" onClick={() => loadConfig()}>
              Try again
            </button>
            {typeof window !== 'undefined' && !backendAvailable() && (
              <div
                style={{ marginTop: '8px', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}
              >
                <strong>Published demo note:</strong> Live updates require a running backend.
                <a
                  href="https://zz-plant.github.io/ambit/"
                  style={{ color: 'var(--text-muted)' }}
                  target="_blank"
                  rel="noopener"
                >
                  Open the demo
                </a>
                or <code>node src/engine/engine.ts seed</code> locally for full functionality.
              </div>
            )}
          </div>
        )}
        {showGuide && view === 'graph' && items.length > 0 && (
          <div
            className="app-guide"
            style={
              isNarrow
                ? undefined
                : { left: leftOpen ? 340 : 0, right: showDetailPanel && selectedId ? 340 : 0 }
            }
          >
            <div className="app-guide-head">
              <strong>Getting Started</strong>
              <button className="app-guide-close" onClick={dismissGuide} aria-label="Dismiss">
                ✕
              </button>
            </div>
            <ol className="app-guide-steps">
              <li>
                <strong>Click any node</strong> to inspect dependencies, verified evidence, and
                blast radius.
              </li>
              <li>
                <strong>Outlined nodes</strong> are reachable next steps on your frontier — their
                description explains what is needed.
              </li>
              <li>
                <strong>Tech Tree</strong> visualizes evolutionary prerequisites;{' '}
                <strong>My Setup</strong> inspects discovered local tools and agents.
              </li>
            </ol>
            <button
              className="app-guide-more"
              onClick={() => {
                setShowDocs(true);
                dismissGuide();
              }}
            >
              Read the concept guide →
            </button>
          </div>
        )}
        {!items.length && !loading && (
          <div className="app-welcome">
            <div className="app-welcome-hero">
              <div className="app-welcome-title">Ambit</div>
              <div className="app-welcome-tagline">
                Map your agent environment as a capability tech tree.
                <br />
                Audit blast radius, discover emergent combos, and govern changes safely.
              </div>
              <div className="app-welcome-diagram">
                <svg width="340" height="110" viewBox="0 0 340 110">
                  <defs>
                    <linearGradient id="heroGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#4f46e5" />
                      <stop offset="100%" stopColor="#0ea5e9" />
                    </linearGradient>
                  </defs>
                  <rect
                    x={0}
                    y={0}
                    width={340}
                    height={110}
                    rx={12}
                    fill="#111827"
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth={1}
                  />

                  {/* Subtle connection paths */}
                  <line
                    x1={60}
                    y1={55}
                    x2={150}
                    y2={35}
                    stroke="#3b82f6"
                    strokeWidth={1.5}
                    opacity={0.6}
                  />
                  <line
                    x1={150}
                    y1={35}
                    x2={260}
                    y2={55}
                    stroke="#6366f1"
                    strokeWidth={1.5}
                    opacity={0.6}
                  />
                  <line
                    x1={60}
                    y1={55}
                    x2={150}
                    y2={75}
                    stroke="#10b981"
                    strokeWidth={1.5}
                    opacity={0.6}
                  />
                  <line
                    x1={150}
                    y1={75}
                    x2={260}
                    y2={55}
                    stroke="#10b981"
                    strokeWidth={1.5}
                    opacity={0.6}
                  />

                  {/* Nodes */}
                  <circle cx={60} cy={55} r={16} fill="#1e293b" stroke="#3b82f6" strokeWidth={2} />
                  <text
                    x={60}
                    y={59}
                    textAnchor="middle"
                    fill="#93c5fd"
                    fontSize={11}
                    fontWeight={600}
                  >
                    LLM
                  </text>

                  <circle cx={150} cy={35} r={14} fill="#1e293b" stroke="#6366f1" strokeWidth={2} />
                  <text
                    x={150}
                    y={39}
                    textAnchor="middle"
                    fill="#c7d2fe"
                    fontSize={10}
                    fontWeight={600}
                  >
                    MCP
                  </text>

                  <circle cx={150} cy={75} r={14} fill="#1e293b" stroke="#10b981" strokeWidth={2} />
                  <text
                    x={150}
                    y={79}
                    textAnchor="middle"
                    fill="#a7f3d0"
                    fontSize={10}
                    fontWeight={600}
                  >
                    Tool
                  </text>

                  <circle cx={260} cy={55} r={18} fill="#1e293b" stroke="#0ea5e9" strokeWidth={2} />
                  <text
                    x={260}
                    y={59}
                    textAnchor="middle"
                    fill="#7dd3fc"
                    fontSize={11}
                    fontWeight={700}
                  >
                    Goal
                  </text>
                </svg>
              </div>
              <div className="app-welcome-actions">
                <button
                  className="app-welcome-btn"
                  onClick={() => {
                    seedDemo();
                  }}
                >
                  Explore Interactive Demo
                </button>
                <button
                  className="app-welcome-btn app-welcome-btn-outline"
                  onClick={() => {
                    seedDemo();
                    setView('loop');
                  }}
                >
                  View Economic Loop
                </button>
                <button
                  className="app-welcome-btn app-welcome-btn-outline"
                  onClick={() => setShowDocs(true)}
                >
                  Documentation
                </button>
                <a
                  href="https://github.com/zz-plant/ambit"
                  target="_blank"
                  rel="noopener"
                  className="app-welcome-btn app-welcome-btn-outline"
                >
                  GitHub
                </a>
              </div>
              <div className="app-welcome-code">
                <code>
                  node src/engine/engine.ts seed &amp;&amp; node src/engine/engine.ts status
                </code>
              </div>
              <div className="app-welcome-modes">
                <span>
                  <em>LOAD DEMO</em> — a sample capability graph to click around
                </span>
                <span>
                  <em>SEE THE LOOP</em> — where time goes, what to build next, what it paid back
                </span>
                <span>The real thing: Node 22, no dependencies — one command</span>
              </div>
            </div>
          </div>
        )}
        {view === 'loop' && demo ? (
          <DemoDashboard />
        ) : items.length > 0 ? (
          <Suspense
            fallback={
              <div className="app-loading">
                <div className="app-loading-ring" />
                <p>Loading capability graph…</p>
              </div>
            }
          >
            <CivTree
              items={items}
              connections={connections}
              selectedId={selectedId}
              hoveredId={hoveredId}
              onSelect={selectItem}
              onHover={hoverItem}
              leftInset={leftOpen && !isNarrow ? 348 : 8}
            />
          </Suspense>
        ) : null}
      </div>

      {showDetailPanel && selectedId && (
        <aside className="app-detail-panel" aria-label="Capability details">
          <NodeDetailPanel />
        </aside>
      )}

      {leftOpen && isNarrow && (
        <div
          className="app-drawer-backdrop"
          onClick={() => setLeftOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`app-console ${leftOpen ? 'app-console--open' : ''}`}>
        <CapabilityListPanel />
      </aside>

      <ApprovalModal isOpen={showApprovalModal} onClose={() => setShowApprovalModal(false)} />

      <DocsModal isOpen={showDocs} onClose={() => setShowDocs(false)} />

      {toast && (
        <div role="status" className="ambit-toast">
          <span>{toast}</span>
          <div
            style={{ display: 'flex', gap: '6px', marginTop: '6px', justifyContent: 'flex-end' }}
          >
            {toast.includes('Approved:') && (
              <button
                type="button"
                className="tp-btn-sm"
                style={{
                  fontSize: '10px',
                  padding: '2px 8px',
                  color: 'var(--ok)',
                  borderColor: 'var(--ok)',
                }}
                onClick={e => {
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
              onClick={e => {
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
              return item
                ? `Selected ${item.name}. ${item.status === 'built' ? 'Reached' : 'Not reached'}.`
                : '';
            })()
          : ''}
      </div>
    </div>
  );
}
