import React, { Suspense, useEffect, useState } from 'react';
import AppDeck from './components/AppDeck';
import { isNext } from './components/civ/layout';
import ApprovalModal from './components/ApprovalModal';
import CapabilityListPanel from './components/CapabilityListPanel';
import LoopDashboard from './components/LoopDashboard';
import DocsModal from './components/DocsModal';
import GettingStartedGuide from './components/GettingStartedGuide';
import NodeDetailPanel from './components/NodeDetailPanel';
import Toast from './components/Toast';
import WelcomeScreen from './components/WelcomeScreen';
import { useGraphStream } from './hooks/useGraphStream';
import { useGuide } from './hooks/useGuide';
import { useHotkeys } from './hooks/useHotkeys';
import { useToast } from './hooks/useToast';
import { useUrlSync } from './hooks/useUrlSync';
import { useViewport } from './hooks/useViewport';
import { readLinkState } from './linkState';
import { statusLabel } from './utils/labels';
import { useAmbitStore } from './store/ambitStore';

const CivTree = React.lazy(() => import('./components/CivTree'));

/** The width of the docked capability list and of the detail panel. */
const PANEL_W = 340;

const Loading = () => (
  <div className="app-loading">
    <div className="app-loading-ring" />
    <p>Loading capability graph…</p>
  </div>
);

/**
 * The shell: which view is showing, what is open around it, and the wiring
 * between the store, the URL, the keyboard, and the graph stream. Each of
 * those is a hook or a component of its own; this file decides how they fit.
 */
export default function App() {
  const items = useAmbitStore(s => s.items);
  const connections = useAmbitStore(s => s.connections);
  const selectedId = useAmbitStore(s => s.selectedItem);
  const hoveredId = useAmbitStore(s => s.hoveredItem);
  const showDetailPanel = useAmbitStore(s => s.showDetailPanel);
  const loading = useAmbitStore(s => s.loading);
  const error = useAmbitStore(s => s.error);
  const demo = useAmbitStore(s => s.demo);
  const lens = useAmbitStore(s => s.activeLens);
  const treeFilter = useAmbitStore(s => s.treeFilter);
  const proposals = useAmbitStore(s => s.proposals);
  const showApprovalModal = useAmbitStore(s => s.showApprovalModal);

  const selectItem = useAmbitStore(s => s.selectItem);
  const hoverItem = useAmbitStore(s => s.hoverItem);
  const loadConfig = useAmbitStore(s => s.loadConfig);
  const loadTechTree = useAmbitStore(s => s.loadTechTree);
  const seedDemo = useAmbitStore(s => s.seedDemo);
  const seedDemoTree = useAmbitStore(s => s.seedDemoTree);
  const loadProposals = useAmbitStore(s => s.loadProposals);
  const loadAttentionData = useAmbitStore(s => s.loadAttentionData);
  const loadLoop = useAmbitStore(s => s.loadLoop);
  const probeBackend = useAmbitStore(s => s.probeBackend);
  const setShowApprovalModal = useAmbitStore(s => s.setShowApprovalModal);
  const startAcquisition = useAmbitStore(s => s.startAcquisitionSimulation);

  // The URL is read once; the toggles own every later change.
  const [link] = useState(() =>
    readLinkState(typeof window === 'undefined' ? '' : window.location.search)
  );
  const [source, setSource] = useState(link.source);
  const [view, setView] = useState(link.view);
  const [showDocs, setShowDocs] = useState(link.docsOpen);

  useUrlSync({
    source,
    view,
    focusId: selectedId,
    docsOpen: showDocs,
    demo,
    lens,
    treeFilter,
  });

  const { isNarrow, leftOpen, setLeftOpen } = useViewport(selectedId);
  const { showGuide, dismissGuide } = useGuide(link.guideOff);
  const [toast, setToast] = useToast();

  const { connected } = useGraphStream({
    graphChanged: () => {
      // Something rebuilt the graph — a seed, an adapter, another session. The
      // page reloads itself, and says so: a view that changes under the reader
      // with no explanation reads as a glitch.
      if (source === 'tree') loadTechTree();
      else loadConfig();
      loadLoop();
      setToast('The graph changed underneath — reloaded.');
    },
    // A browser approval becomes a notice to act on, with the exact command
    // the terminal would run.
    proposalApproved: id =>
      setToast(
        `Approved: ${id} — review with \`ambit proposal ${id}\`, apply with \`ambit apply ${id}\`.`
      ),
  });

  useHotkeys({
    openSearch: () => {
      setLeftOpen(true);
      setTimeout(() => document.getElementById('tp-search-input')?.focus(), 60);
    },
    toggleSidebar: () => setLeftOpen(o => !o),
    toggleDocs: () => setShowDocs(o => !o),
    toggleGovernance: () => {
      const open = useAmbitStore.getState().showApprovalModal;
      setShowApprovalModal(!open);
      if (!open) loadProposals();
    },
    escape: () => {
      setShowApprovalModal(false);
      setShowDocs(false);
      selectItem(null);
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount only — the link is read once, and the store actions have stable identities. Re-running this on a re-render would re-seed the demo, which is exactly what it must not do.
  useEffect(() => {
    // ?demo=1 seeds the graph before anything can fetch. loadConfig()'s
    // no-backend path would otherwise clobber the seeded data back to an
    // empty graph. The tree is a different dataset from the config view, so
    // it is asked for explicitly rather than fetched — the demo must look the
    // same with an engine behind it as without one.
    if (link.demo) seedDemo();
    probeBackend();
    loadProposals();
    loadAttentionData();
    if (!link.demo) loadLoop();
    if (link.demo) {
      if (source === 'tree') seedDemoTree();
      return;
    }
    if (source === 'tree') loadTechTree();
    else loadConfig();
  }, []);

  // ?focus=<id> selects a node once the graph that contains it has loaded.
  // The lookup happens outside the effect so its dependency is the found id —
  // a string — rather than `items`, whose identity changes every render.
  const focusTarget = link.focusId ? items.find(i => i.id === link.focusId)?.id : undefined;
  useEffect(() => {
    // `selectItem` toggles, because clicking the selected node clears it. A
    // link is not a toggle: if this effect runs again with the same target —
    // a remount, a hot reload — selecting it a second time would close the
    // panel the link was for.
    if (focusTarget && useAmbitStore.getState().selectedItem !== focusTarget) {
      selectItem(focusTarget);
    }
  }, [focusTarget, selectItem]);

  // In the demo the two views are the same invented setup seen twice, so
  // switching tabs must not go to the network — locally that fetched the
  // developer's own machine into a page they asked to be a demo.
  const openTree = () => {
    setView('graph');
    setSource('tree');
    if (demo) seedDemoTree();
    else loadTechTree();
  };
  const showTree = () => {
    openTree();
    selectItem(null);
  };

  /**
   * Follow a priced opportunity to the node it is about.
   *
   * The Time & cost page's "Map" button selected the node and ran the unlock
   * simulation while leaving you on the dashboard, where neither is visible —
   * so the button appeared to do nothing at all.
   */
  const showOnMap = (id: string) => {
    openTree();
    selectItem(id);
    startAcquisition(id);
  };
  const showSetup = () => {
    setView('graph');
    setSource('config');
    selectItem(null);
    if (demo) seedDemo();
    else loadConfig();
  };
  const showLoop = () => {
    setView('loop');
    selectItem(null);
    if (!demo) loadLoop();
  };

  /**
   * Copy a link to what is on screen.
   *
   * The URL already describes the view — useUrlSync keeps it that way — so
   * sharing is a copy of the address bar rather than a second serializer.
   */
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setToast('Link copied. It opens on this view.');
    } catch {
      setToast('Copy the address bar — it is a link to this view.');
    }
  };

  const showProposals = () => {
    setShowApprovalModal(true);
    loadProposals();
  };

  const selected = selectedId ? items.find(i => i.id === selectedId) : undefined;
  const detailOpen = Boolean(showDetailPanel && selectedId);
  const listInset = leftOpen && !isNarrow ? PANEL_W : 0;

  // No graph yet: the welcome page, on its own. The chrome around the map —
  // a capability list reading "(0)", a status pill reading "0 / 0" — would
  // otherwise be the first thing a visitor saw.
  if (!items.length && !loading && !error) {
    return (
      <div className="app">
        <WelcomeScreen
          onExploreDemo={seedDemo}
          onViewLoop={() => {
            seedDemo();
            setView('loop');
          }}
          onShowDocs={() => setShowDocs(true)}
        />
        <DocsModal isOpen={showDocs} onClose={() => setShowDocs(false)} />
      </div>
    );
  }

  return (
    <div className="app">
      <AppDeck
        reached={items.filter(i => i.status === 'built').length}
        next={items.filter(i => i.status !== 'built' && isNext(i)).length}
        total={items.length}
        view={view}
        source={source}
        connected={connected}
        draftCount={proposals.filter(p => p.status === 'draft').length}
        leftOpen={leftOpen}
        onToggleSidebar={() => setLeftOpen(o => !o)}
        onShare={share}
        onShowTree={showTree}
        onShowSetup={showSetup}
        onShowLoop={showLoop}
        onShowProposals={showProposals}
        onShowDocs={() => setShowDocs(true)}
      />

      <div className="app-scene">
        {loading && !items.length && <Loading />}
        {error && (
          <div className="app-error">
            <p>{error}</p>
            <button type="button" className="tp-btn" onClick={() => loadConfig()}>
              Try again
            </button>
          </div>
        )}
        {view === 'loop' ? (
          <LoopDashboard leftInset={listInset} onShowOnMap={showOnMap} />
        ) : items.length > 0 ? (
          <Suspense fallback={<Loading />}>
            <CivTree
              items={items}
              connections={connections}
              selectedId={selectedId}
              hoveredId={hoveredId}
              onSelect={selectItem}
              onHover={hoverItem}
              leftInset={listInset ? listInset + 8 : 8}
              rightInset={detailOpen && !isNarrow ? PANEL_W : 0}
            />
          </Suspense>
        ) : null}
        {showGuide && view === 'graph' && items.length > 0 && (
          <GettingStartedGuide
            style={isNarrow ? undefined : { right: detailOpen ? PANEL_W + 16 : 16 }}
            onDismiss={dismissGuide}
            onReadMore={() => {
              setShowDocs(true);
              dismissGuide();
            }}
          />
        )}
      </div>

      {detailOpen && (
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

      {leftOpen && (
        <aside className="app-capabilities-panel" aria-label="Capabilities">
          <CapabilityListPanel />
        </aside>
      )}

      <ApprovalModal isOpen={showApprovalModal} onClose={() => setShowApprovalModal(false)} />
      <DocsModal isOpen={showDocs} onClose={() => setShowDocs(false)} />

      {toast && (
        <Toast
          message={toast}
          onDismiss={() => setToast(null)}
          onViewProposals={() => {
            setShowApprovalModal(true);
            setToast(null);
          }}
        />
      )}

      <div className="visually-hidden" role="status" aria-live="polite">
        {selected ? `Selected ${selected.name}. ${statusLabel(selected.status, selected)}.` : ''}
      </div>
    </div>
  );
}
