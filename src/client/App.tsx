import React, { Suspense, useEffect, useState } from 'react';
import AppDeck, { type MapCounts } from './components/AppDeck';
import ApprovalModal from './components/ApprovalModal';
import { isEntry, isNext, isProven, visibleItems } from './components/civ/layout';
import DocsModal, { type DocsTab } from './components/DocsModal';
import Finder from './components/Finder';
import GettingStartedGuide from './components/GettingStartedGuide';
import LoopDashboard from './components/LoopDashboard';
import NodeDetailPanel from './components/NodeDetailPanel';
import SetupView from './components/SetupView';
import Toast from './components/Toast';
import Tour from './components/Tour';
import WelcomeScreen from './components/WelcomeScreen';
import { useGraphStream } from './hooks/useGraphStream';
import { useGuide } from './hooks/useGuide';
import { useHotkeys } from './hooks/useHotkeys';
import { useToast } from './hooks/useToast';
import { useUrlSync } from './hooks/useUrlSync';
import { isNarrowScreen, useNarrow } from './hooks/useViewport';
import { hostedLanding, initialView, readLinkState, type View } from './linkState';
import { isHostedDemo, useAmbitStore } from './store/ambitStore';
import { statusLabel } from './utils/labels';

const CivTree = React.lazy(() => import('./components/CivTree'));

/** The width of the detail panel. */
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
  const spotlight = useAmbitStore(s => s.spotlight);
  const proposals = useAmbitStore(s => s.proposals);
  const showApprovalModal = useAmbitStore(s => s.showApprovalModal);

  const selectItem = useAmbitStore(s => s.selectItem);
  const hoverItem = useAmbitStore(s => s.hoverItem);
  const loadGraph = useAmbitStore(s => s.loadGraph);
  const seedDemo = useAmbitStore(s => s.seedDemo);
  const loadProposals = useAmbitStore(s => s.loadProposals);
  const loadAttentionData = useAmbitStore(s => s.loadAttentionData);
  const loadLoop = useAmbitStore(s => s.loadLoop);
  const probeBackend = useAmbitStore(s => s.probeBackend);
  const setShowApprovalModal = useAmbitStore(s => s.setShowApprovalModal);
  const setSpotlight = useAmbitStore(s => s.setSpotlight);
  const startAcquisition = useAmbitStore(s => s.startAcquisitionSimulation);

  // The URL is read once; the controls own every later change.
  const [link] = useState(() =>
    hostedLanding(
      readLinkState(typeof window === 'undefined' ? '' : window.location.search),
      isHostedDemo()
    )
  );
  const { showGuide, dismissGuide } = useGuide(link.guideOff);
  const [view, setView] = useState<View>(() =>
    initialView(link, isNarrowScreen(), link.demo && showGuide)
  );
  const [showDocs, setShowDocs] = useState(link.docsOpen);
  const [docsTab, setDocsTab] = useState<DocsTab | undefined>(undefined);
  const [finderOpen, setFinderOpen] = useState(false);

  const openDocs = (tab?: DocsTab) => {
    setDocsTab(tab);
    setShowDocs(true);
  };

  useUrlSync({ view, focusId: selectedId, docsOpen: showDocs, demo, lens });

  const isNarrow = useNarrow();
  // The tour runs on the demo the first time, like the card it replaces there,
  // and again whenever someone asks to watch the outage from the landing.
  const [tourAsked, setTourAsked] = useState(false);
  const [toast, setToast] = useToast();

  const { connected } = useGraphStream({
    graphChanged: () => {
      // Something rebuilt the graph: a seed, an adapter, another session. The
      // page reloads itself, and says so: a view that changes under the reader
      // with no explanation reads as a glitch.
      loadGraph();
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
    openSearch: () => setFinderOpen(true),
    toggleDocs: () => setShowDocs(o => !o),
    toggleGovernance: () => {
      const open = useAmbitStore.getState().showApprovalModal;
      setShowApprovalModal(!open);
      if (!open) loadProposals();
    },
    escape: () => {
      setFinderOpen(false);
      setShowApprovalModal(false);
      setShowDocs(false);
      selectItem(null);
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount only. The link is read once, and the store actions have stable identities. Re-running this on a re-render would re-seed the demo, which is exactly what it must not do.
  useEffect(() => {
    // ?demo=1 seeds the graph before anything can fetch. loadGraph()'s
    // no-backend path would otherwise clobber the seeded data back to an
    // empty graph. The demo must look the same with an engine behind it as
    // without one.
    if (link.demo) seedDemo();
    probeBackend();
    loadProposals();
    loadAttentionData();
    if (!link.demo) {
      loadLoop();
      loadGraph();
    }
  }, []);

  // ?focus=<id> selects a node once the graph that contains it has loaded.
  // The lookup happens outside the effect so its dependency is the found id, a
  // string, and not `items`, whose identity changes every render.
  const focusTarget = link.focusId ? items.find(i => i.id === link.focusId)?.id : undefined;
  useEffect(() => {
    // `selectItem` toggles, because clicking the selected node clears it. A
    // link is not a toggle: if this effect runs again with the same target (a
    // remount, a hot reload), selecting it a second time would close the panel
    // the link was for.
    if (focusTarget && useAmbitStore.getState().selectedItem !== focusTarget) {
      selectItem(focusTarget);
    }
  }, [focusTarget, selectItem]);

  /** Select something without toggling it off when it is already selected. */
  const select = (id: string) => {
    if (useAmbitStore.getState().selectedItem !== id) selectItem(id);
  };

  /**
   * Show an item where it lives: a node of the tree on the map, an entry of
   * the machine in My Setup. The finder and the detail panel's neighbour
   * lists both go through here, so following a link from a tree node to the
   * server that provides it lands on the list where that server is.
   */
  const show = (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    setView(isEntry(item) ? 'config' : 'tree');
    select(id);
  };

  /**
   * Follow a priced opportunity to the node it is about, with the unlock
   * simulation running. Both happen on the map, so the map is shown first.
   */
  const showOnMap = (id: string) => {
    setView('tree');
    select(id);
    startAcquisition(id);
  };

  const showView = (next: View) => {
    setView(next);
    // The detail panel is meaningful over the map and the list, and in the
    // way over the figures.
    if (next === 'loop') {
      selectItem(null);
      if (!demo) loadLoop();
    }
  };

  /**
   * Copy a link to what is on screen.
   *
   * The URL already describes the view, and useUrlSync keeps it that way, so
   * sharing is a copy of the address bar and not a second serializer.
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

  // The header counts one population per view: the map's nodes by state, or
  // the setup's entries by whether they are enabled. It used to count both in
  // one fraction, so the demo read "42 of 60" over a tree of 33.
  const mapItems = visibleItems(items);
  const counts: MapCounts = {
    verified: mapItems.filter(isProven).length,
    unproven: mapItems.filter(i => i.status === 'built' && !isProven(i)).length,
    next: mapItems.filter(i => i.status !== 'built' && isNext(i)).length,
    blocked: mapItems.filter(i => i.status !== 'built' && !isNext(i)).length,
  };
  const entries = items.filter(isEntry);
  const hasTree = items.some(i => !isEntry(i));
  const touring = demo && view === 'tree' && hasTree && (tourAsked || showGuide);
  const endTour = () => {
    setTourAsked(false);
    dismissGuide();
  };

  // No graph yet: the welcome page, on its own. The chrome around the map (a
  // status pill reading "0 of 0") would otherwise be the first thing a
  // visitor saw.
  if (!items.length && !loading && !error) {
    return (
      <div className="app">
        <WelcomeScreen
          onExploreDemo={() => {
            seedDemo();
            setView('tree');
            setTourAsked(true);
          }}
          onViewLoop={() => {
            seedDemo();
            setView('loop');
          }}
        />
        <DocsModal
          isOpen={showDocs}
          initialTab={docsTab}
          onClose={() => {
            setShowDocs(false);
            setDocsTab(undefined);
          }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <AppDeck
        view={view}
        counts={view === 'tree' ? counts : null}
        entries={
          view === 'config'
            ? { enabled: entries.filter(i => i.status === 'built').length, total: entries.length }
            : null
        }
        connected={connected}
        draftCount={proposals.filter(p => p.status === 'draft').length}
        spotlight={spotlight}
        onSpotlight={setSpotlight}
        onSearch={() => setFinderOpen(true)}
        onShowView={showView}
        onShare={share}
        onShowProposals={showProposals}
        onShowDocs={() => openDocs()}
      />

      <div className="app-scene">
        {loading && !items.length && <Loading />}
        {error && (
          <div className="app-error">
            <p>{error}</p>
            <button type="button" className="tp-btn" onClick={() => loadGraph()}>
              Try again
            </button>
          </div>
        )}
        {view === 'loop' ? (
          <LoopDashboard onShowOnMap={showOnMap} />
        ) : view === 'config' ? (
          <SetupView onShow={show} />
        ) : items.length > 0 && hasTree ? (
          <Suspense fallback={<Loading />}>
            <CivTree
              items={items}
              connections={connections}
              selectedId={selectedId}
              hoveredId={hoveredId}
              onSelect={selectItem}
              onHover={hoverItem}
              leftInset={8}
              rightInset={detailOpen && !isNarrow ? PANEL_W : 0}
              narrated={touring}
            />
          </Suspense>
        ) : items.length > 0 ? (
          // A config read in the browser has entries and no tree: placing
          // them on the curated tree is the engine's job, and there is none
          // behind a dropped file.
          <div className="app-map-empty">
            <p>
              The map places a setup on the curated tree, and placing it takes the engine. What this
              file declares is in My Setup; for the map, clone the repository and run{' '}
              <code>./bootstrap.sh web</code>.
            </p>
            <button type="button" className="tp-btn" onClick={() => showView('config')}>
              Open My Setup
            </button>
          </div>
        ) : null}
        {touring ? (
          <Tour
            style={isNarrow ? undefined : { right: detailOpen ? PANEL_W + 16 : 16 }}
            onDone={endTour}
            onShowProposals={showProposals}
            onMapped={() => {
              endTour();
              setView('config');
            }}
          />
        ) : (
          showGuide &&
          view === 'tree' &&
          hasTree && (
            <GettingStartedGuide
              style={isNarrow ? undefined : { right: detailOpen ? PANEL_W + 16 : 16 }}
              onDismiss={dismissGuide}
              onReadMore={() => {
                openDocs('reading');
                dismissGuide();
              }}
            />
          )
        )}
      </div>

      {detailOpen && (
        <aside className="app-detail-panel" aria-label="Capability details">
          <NodeDetailPanel onShow={show} />
        </aside>
      )}

      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} onShow={show} />
      <ApprovalModal isOpen={showApprovalModal} onClose={() => setShowApprovalModal(false)} />
      <DocsModal
        isOpen={showDocs}
        initialTab={docsTab}
        onClose={() => {
          setShowDocs(false);
          setDocsTab(undefined);
        }}
      />

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
