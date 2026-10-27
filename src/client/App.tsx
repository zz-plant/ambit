import React, { Suspense, useEffect, useMemo, useState } from 'react';
import AppDeck, { mapCounts } from './components/AppDeck';
import { dayOf, hasHistory, itemsAsOf, momentOf, tickAt } from './components/civ/history';
import { isEntry, unlockedSince, visibleItems } from './components/civ/layout';
import { Timeline } from './components/civ/Timeline';
import DocsModal, { type DocsTab } from './components/DocsModal';
import Finder from './components/Finder';
import GettingStartedGuide from './components/GettingStartedGuide';
import MapYoursDialog from './components/MapYours';
import NodeDetailPanel from './components/NodeDetailPanel';
import SetupView from './components/SetupView';
import Toast from './components/Toast';
import Tour from './components/Tour';
import YourAmbit from './components/YourAmbit';
import WelcomeScreen from './components/WelcomeScreen';
import { useGraphStream } from './hooks/useGraphStream';
import { useGuide } from './hooks/useGuide';
import { useHotkeys } from './hooks/useHotkeys';
import { useLatest } from './hooks/useLatest';
import { useToast } from './hooks/useToast';
import { useUrlSync } from './hooks/useUrlSync';
import { isNarrowScreen, useNarrow } from './hooks/useViewport';
import {
  hostedLanding,
  initialView,
  linkFocus,
  readLinkState,
  VIEWS,
  type SetupTab,
  type View,
} from './linkState';
import { isHostedDemo, useAmbitStore } from './store/ambitStore';
import { statusLabel } from './utils/labels';
import { escapeLayer } from './utils/keys';
import type { PaletteHandlers } from './utils/palette';
import { DRAWN_FACES, mapFile } from './utils/mapFile';
import { svgToPng } from './utils/saveImage';
import { buildCard, CARD_H, CARD_W, cardFileName, cardSvg, type Showing } from './utils/shareCard';
import type { ImageKind } from './components/civ/ImageMenu';
import { embeddedFontCss } from './fonts';

const CivTree = React.lazy(() => import('./components/CivTree'));
// Fetched when first opened: a visit lands on the map, and the views it
// does not show were 41KB of the script every first load waited for.
const LoopDashboard = React.lazy(() => import('./components/LoopDashboard'));
const AuditView = React.lazy(() => import('./components/AuditView'));
const ProposalsView = React.lazy(() => import('./components/ProposalsView'));
// The modal is the tour's narration of the approval gate, on the demo alone;
// the Proposals view is where decisions are read on a real machine. The desk
// they share is a chunk of its own, so neither waits for the other.
const ApprovalModal = React.lazy(() => import('./components/ApprovalModal'));

/** The width of the detail panel. */
const PANEL_W = 340;

const Loading = () => (
  <div className="app-loading">
    <div className="app-loading-ring" />
    <p>Loading the map…</p>
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
  const selectedEra = useAmbitStore(s => s.selectedEra);
  const hoveredId = useAmbitStore(s => s.hoveredItem);
  const showDetailPanel = useAmbitStore(s => s.showDetailPanel);
  const loading = useAmbitStore(s => s.loading);
  const error = useAmbitStore(s => s.error);
  const demo = useAmbitStore(s => s.demo);
  const reading = useAmbitStore(s => s.reading);
  const lens = useAmbitStore(s => s.activeLens);
  const spotlight = useAmbitStore(s => s.spotlight);
  const collapse = useAmbitStore(s => s.collapsed);
  const depth = useAmbitStore(s => s.collapseDepth);
  const dir = useAmbitStore(s => s.collapseDirection);
  const proposals = useAmbitStore(s => s.proposals);
  const showApprovalModal = useAmbitStore(s => s.showApprovalModal);
  const history = useAmbitStore(s => s.history);
  const historyAt = useAmbitStore(s => s.historyAt);
  const setHistoryAt = useAmbitStore(s => s.setHistoryAt);
  const historyOpen = useAmbitStore(s => s.historyOpen);
  const historyPlaying = useAmbitStore(s => s.historyPlaying);
  const setHistoryPlaying = useAmbitStore(s => s.setHistoryPlaying);
  const loadHistory = useAmbitStore(s => s.loadHistory);

  const selectItem = useAmbitStore(s => s.selectItem);
  const selectEra = useAmbitStore(s => s.selectEra);
  const hoverItem = useAmbitStore(s => s.hoverItem);
  const loadGraph = useAmbitStore(s => s.loadGraph);
  const seedDemo = useAmbitStore(s => s.seedDemo);
  const loadProposals = useAmbitStore(s => s.loadProposals);
  const loadAttentionData = useAmbitStore(s => s.loadAttentionData);
  const loadLoop = useAmbitStore(s => s.loadLoop);
  const loadAudit = useAmbitStore(s => s.loadAudit);
  const probeBackend = useAmbitStore(s => s.probeBackend);
  const setShowApprovalModal = useAmbitStore(s => s.setShowApprovalModal);
  const setSpotlight = useAmbitStore(s => s.setSpotlight);
  const setCollapsed = useAmbitStore(s => s.setCollapsed);
  const clearSimulation = useAmbitStore(s => s.clearSimulation);
  const startAcquisition = useAmbitStore(s => s.startAcquisitionSimulation);
  const startOutage = useAmbitStore(s => s.startOutageSimulation);
  const setActiveLens = useAmbitStore(s => s.setActiveLens);

  // The URL is read once; the controls own every later change, and `popstate`
  // owns the ones Back and Forward bring.
  const [link, setLink] = useState(() =>
    hostedLanding(
      readLinkState(typeof window === 'undefined' ? '' : window.location.search),
      isHostedDemo()
    )
  );
  const { showGuide, dismissGuide } = useGuide(link.guideOff);
  const [view, setView] = useState<View>(() =>
    initialView(link, isNarrowScreen(), link.demo && (showGuide || Boolean(link.tour)))
  );
  // Which section of My Setup is showing. App owns it, so a link can open on
  // it and the address bar carries it.
  const [setupTab, setSetupTab] = useState<SetupTab>(() => link.tab);
  const [showDocs, setShowDocs] = useState(link.docsOpen);
  const [docsTab, setDocsTab] = useState<DocsTab | undefined>(undefined);
  const [finderOpen, setFinderOpen] = useState(false);
  // Where the map's headline ends, so the first-run card sits below it: at
  // 1024px it sat on the finding and covered its Show button.
  const [headlineBottom, setHeadlineBottom] = useState<number | null>(null);

  const openDocs = (tab?: DocsTab) => {
    setDocsTab(tab);
    setShowDocs(true);
  };
  const closeDocs = () => {
    setShowDocs(false);
    setDocsTab(undefined);
  };

  useUrlSync({
    view,
    focusId: selectedId,
    docsOpen: showDocs,
    demo,
    lens,
    at: historyAt,
    tab: view === 'setup' ? setupTab : undefined,
    collapse,
    depth,
    dir,
  });

  const isNarrow = useNarrow();
  // The tour runs on the demo the first time, like the card it replaces there,
  // and again whenever someone asks: Replay in the header, or a link from a
  // docs page that names the step it is about.
  const [tourAsked, setTourAsked] = useState(() => Boolean(link.demo && link.tour));
  // The step a link opened the tour on. Replaying it from the header starts
  // at the beginning, so the link's step is spent when the tour ends.
  const [tourStart, setTourStart] = useState(link.tour ?? null);
  const [mapYoursOpen, setMapYoursOpen] = useState(false);
  // The card that says what a config read in the tab adds up to. It opens
  // with each reading, and closing it leaves the map and its finding.
  const [readoutOpen, setReadoutOpen] = useState(true);
  const [toast, setToast] = useToast();

  const { connected } = useGraphStream({
    graphChanged: changed => {
      // A proposal drafted or decided elsewhere, an agent's over MCP or this
      // page's own, changes the waiting count and nothing the map draws: the
      // badge refreshes and nothing is announced.
      loadProposals();
      if (changed.every(key => key === 'drafts')) return;
      // Something changed the graph: a seed, an adapter, a check run in another
      // terminal. The page reloads itself, and says so: a view that changes
      // under the reader with no explanation reads as a glitch. When it reached
      // something, that is the news, and it is said by name.
      const checked = changed.some(key => key === 'proven' || key === 'failing');
      const before = useAmbitStore.getState().items;
      loadGraph().then(() =>
        setToast(
          unlockedSince(before, useAmbitStore.getState().items) ??
            (checked
              ? 'A check ran, so the map has reloaded with its result.'
              : 'The graph was rebuilt, so the map has reloaded.')
        )
      );
      loadLoop();
      loadHistory();
    },
    // A browser approval becomes a notice to act on, with the exact command
    // the terminal would run.
    proposalApproved: id =>
      setToast(
        `Approved ${id}. Review it with \`ambit proposals ${id}\`, then apply it with \`ambit apply ${id}\`.`
      ),
  });

  // The view the hotkeys read, current at the moment a key lands.
  const viewNow = useLatest(view);
  useHotkeys({
    openSearch: () => setFinderOpen(true),
    toggleDocs: () => setShowDocs(o => !o),
    // `g` holds the one view its letter names: to the decisions, and back to
    // the map from there.
    proposals: () => showView(viewNow.current === 'proposals' ? 'map' : 'proposals'),
    viewStep: dir =>
      showView(VIEWS[(VIEWS.indexOf(viewNow.current) + dir + VIEWS.length) % VIEWS.length]),
    // One owner, and one thing a press: see escapeLayer.
    escape: () => {
      const s = useAmbitStore.getState();
      const layer = escapeLayer({
        docs: showDocs,
        proposals: s.showApprovalModal,
        finder: finderOpen,
        onMap: view === 'map',
        key: s.keyToggled ?? s.activeLens !== 'default',
        spotlight: s.spotlight !== null,
        simulation: s.simulationMode !== 'none',
        selection: s.selectedItem !== null || s.selectedEra !== null,
      });
      if (layer === 'docs') closeDocs();
      else if (layer === 'proposals') setShowApprovalModal(false);
      else if (layer === 'finder') setFinderOpen(false);
      else if (layer === 'key') s.setKeyToggled(false);
      else if (layer === 'spotlight') setSpotlight(null);
      else if (layer === 'simulation') clearSimulation();
      else if (layer === 'selection') selectItem(null);
    },
  });

  // Back and Forward re-enter the app the way a first visit does: the address
  // names the place, and what it says is applied. A lens, a focus and a scrub
  // live in the store across views, so the URL's word for them agrees with
  // what is already on screen; the view, its section and the docs are the
  // changes a push recorded, and the ones that need applying.
  useEffect(() => {
    const onPop = () => {
      const next = readLinkState(window.location.search);
      setLink(next);
      setView(next.view);
      setSetupTab(next.tab);
      setShowDocs(next.docsOpen);
      const s = useAmbitStore.getState();
      const target = linkFocus(next, s.items);
      if (target) {
        if (s.selectedItem !== target.id) s.selectItem(target.id);
        if (target.collapse) s.setCollapsed(true);
      } else if (s.selectedItem !== null || s.selectedEra !== null) {
        // An address that names no node is a map with nothing selected.
        s.selectItem(null);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

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
      loadHistory();
    }
    // A link to the trail opens on it, so it is read now, not on a tab click.
    if (link.view === 'audit') loadAudit();
  }, []);

  // ?focus=<id> selects a node once the graph that contains it has loaded, and
  // ?collapse=1 collapses the map to it then, and only then. The lookup happens
  // outside the effect so its dependencies are a string and a flag, and not
  // `items`, whose identity changes every render.
  const linked = linkFocus(link, items);
  const focusTarget = linked?.id;
  const focusCollapse = linked?.collapse ?? false;
  useEffect(() => {
    if (!focusTarget) return;
    // `selectItem` toggles, because clicking the selected node clears it. A
    // link is not a toggle: if this effect runs again with the same target (a
    // remount, a hot reload), selecting it a second time would close the panel
    // the link was for.
    if (useAmbitStore.getState().selectedItem !== focusTarget) selectItem(focusTarget);
    if (focusCollapse) setCollapsed(true);
  }, [focusTarget, focusCollapse, selectItem, setCollapsed]);

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
    setView(isEntry(item) ? 'setup' : 'map');
    select(id);
  };

  /**
   * Follow a priced opportunity to the node it is about, with the unlock
   * simulation running. Both happen on the map, so the map is shown first.
   */
  const showOnMap = (id: string) => {
    setView('map');
    select(id);
    startAcquisition(id);
  };

  /** The same, for the outage: the map, the node selected, and what stops. */
  const showOutage = (id: string) => {
    setView('map');
    select(id);
    startOutage(id);
  };

  const showView = (next: View) => {
    setView(next);
    // The detail panel is meaningful over the map and the list, and in the
    // way over the figures. An era's ladder is the map's alone: it stayed open
    // over My Setup, covering the right edge of the list.
    if (next !== 'map' && useAmbitStore.getState().selectedEra !== null) selectEra(null);
    if (next === 'cost') {
      selectItem(null);
      if (!demo) loadLoop();
    }
    if (next === 'audit') {
      selectItem(null);
      loadAudit();
    }
    // The decisions are a page of their own: the panel over it was the map's
    // business, and the queue decides in its own transaction anyway.
    if (next === 'proposals') {
      selectItem(null);
      loadProposals();
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
      setToast('Could not copy. The address bar is a link to this view.');
    }
  };

  // The map's finding as a portrait image, or the whole map: the share sheet
  // on a phone, where it goes straight to a post or a message, and a download
  // elsewhere.
  const saveImage = async (kind: ImageKind) => {
    const st = useAmbitStore.getState();
    const showing: Showing = {
      mode: st.simulationMode,
      rootId: st.simulatedNodeId,
      cascade: st.simulatedCascadeIds,
      weakened: st.simulatedWeakenedIds,
    };
    const card =
      kind === 'card'
        ? buildCard(
            items,
            connections,
            showing,
            st.loop?.next.map(n => n.id)
          )
        : null;
    if (kind === 'card' && !card) {
      setToast('The map has no finding to put in an image yet.');
      return;
    }
    try {
      // A face that cannot be read leaves the image in its fallback, never unsaved.
      const fonts = await embeddedFontCss(DRAWN_FACES).catch(() => '');
      const file = card
        ? new File([await svgToPng(cardSvg(card, fonts), CARD_W, CARD_H)], cardFileName(card), {
            type: 'image/png',
          })
        : await mapFile(
            items,
            connections,
            kind === 'svg' ? 'svg' : 'png',
            showing,
            fonts,
            kind === 'relief' ? 'relief' : 'map'
          );
      if (isNarrow && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (e) {
          if ((e as Error).name === 'AbortError') return;
        }
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setToast(`Saved ${file.name}.`);
    } catch {
      setToast('The image could not be drawn in this browser.');
    }
  };

  /**
   * The modal is the tour's narration of the approval gate, on the demo; the
   * decisions themselves are the Proposals view, which a link can name.
   */
  const showProposals = () => {
    setShowApprovalModal(true);
    loadProposals();
  };

  /**
   * What the finder's actions do to the page. Each one shows a view or a
   * panel, and `view` lives here, so the finder is handed these and never sets
   * a view itself. A check is copied and never run: the page has no route that
   * runs one.
   */
  const paletteHandlers: PaletteHandlers = {
    simulate: (id, mode) => (mode === 'outage' ? showOutage(id) : showOnMap(id)),
    lens: lens => {
      setView('map');
      setActiveLens(lens);
    },
    view: showView,
    briefing: () => {
      setSetupTab('briefing');
      showView('setup');
    },
    proposals: () => showView('proposals'),
    copy: async (text, notice) => {
      try {
        await navigator.clipboard.writeText(text);
        setToast(notice);
      } catch {
        setToast(`Could not copy. Type ${text} in a terminal.`);
      }
    },
  };

  // The map as a past observation left it, while the playhead is off now:
  // only on the map, and not while the tour narrates the map as it is. The
  // header, the map and the panel all read `shown`, so they tell one date.
  const tick =
    view === 'map' && !(demo && (tourAsked || showGuide)) ? tickAt(history, historyAt) : null;
  const shown = useMemo(
    () => (tick ? itemsAsOf(items, connections, tick) : items),
    [tick, items, connections]
  );

  const selected = selectedId ? shown.find(i => i.id === selectedId) : undefined;
  // A node the observation on screen did not hold has no panel to open.
  const detailOpen = Boolean(showDetailPanel && ((selectedId && selected) || selectedEra !== null));

  // The header counts one population per view: the map's nodes by state, or
  // the setup's entries by whether they are enabled. It used to count both in
  // one fraction, so the demo read "42 of 60" over a tree of 33. An
  // observation recorded before lifecycles were cannot split reached by
  // evidence, so the header counts it whole.
  // No check runs in the tab, so a config read there is counted as reached
  // and next, unsplit, like an observation recorded before lifecycles were.
  const counts = mapCounts(visibleItems(shown), !(tick && !tick.lifecycles) && !reading);
  const entries = items.filter(isEntry);
  const hasTree = items.some(i => !isEntry(i));
  const touring = demo && view === 'map' && hasTree && (tourAsked || showGuide);
  // Under the map, once a series has come back. It explains itself when it
  // holds fewer than two ticks; with no engine behind the page it is absent.
  const showTimeline =
    view === 'map' && hasTree && !touring && (historyOpen || Boolean(tick)) && hasHistory(history);
  // Play runs only where it is seen. When the strip goes (another view, the
  // tour, an emptied graph) it pauses, and does not step on unseen and come
  // back somewhere else.
  useEffect(() => {
    if (!showTimeline && useAmbitStore.getState().historyPlaying) setHistoryPlaying(false);
  }, [showTimeline, setHistoryPlaying]);
  const endTour = () => {
    setTourAsked(false);
    setTourStart(null);
    dismissGuide();
  };
  /**
   * A config of the visitor's own was read: the sample is over, and the map
   * shows where theirs stands. It used to open the list of entries, under a
   * note that placing them took the engine, so the demo's question went
   * unanswered for the one setup the visitor cared about.
   */
  const mapped = () => {
    setMapYoursOpen(false);
    endTour();
    setReadoutOpen(true);
    showView('map');
  };
  const readout = Boolean(reading) && readoutOpen && view === 'map' && hasTree;

  // No graph yet: the welcome page, on its own. The chrome around the map (a
  // status pill reading "0 of 0") would otherwise be the first thing a
  // visitor saw.
  if (!items.length && !loading && !error) {
    return (
      <div className="app">
        <WelcomeScreen
          onExploreDemo={() => {
            seedDemo();
            setView('map');
            setTourAsked(true);
          }}
          onViewLoop={() => {
            seedDemo();
            showView('cost');
          }}
          onMapped={mapped}
        />
        <DocsModal isOpen={showDocs} initialTab={docsTab} onClose={closeDocs} />
      </div>
    );
  }

  return (
    <div className={`app${touring ? ' app--touring' : ''}${detailOpen ? ' app--detail' : ''}`}>
      <AppDeck
        view={view}
        counts={view === 'map' ? counts : null}
        entries={
          view === 'setup'
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
        onShowDocs={() => openDocs()}
        asOf={tick ? dayOf(tick.at) : undefined}
        sample={
          demo
            ? {
                onReplay:
                  touring || !hasTree
                    ? undefined
                    : () => {
                        showView('map');
                        setTourAsked(true);
                      },
                onMapYours: () => setMapYoursOpen(true),
              }
            : undefined
        }
        yours={
          reading
            ? {
                onOpen: () => {
                  setReadoutOpen(true);
                  showView('map');
                },
              }
            : undefined
        }
      />

      <div className={`app-scene${showTimeline ? ' app-scene--timeline' : ''}`}>
        {loading && !items.length && <Loading />}
        {error && (
          <div className="app-error">
            <p>{error}</p>
            <button type="button" className="tp-btn" onClick={() => loadGraph()}>
              Try again
            </button>
          </div>
        )}
        {view === 'cost' ? (
          <Suspense fallback={<Loading />}>
            <LoopDashboard onShowOnMap={showOnMap} onShow={show} />
          </Suspense>
        ) : view === 'audit' ? (
          <Suspense fallback={<Loading />}>
            <AuditView />
          </Suspense>
        ) : view === 'proposals' ? (
          <Suspense fallback={<Loading />}>
            <ProposalsView />
          </Suspense>
        ) : view === 'setup' ? (
          <SetupView onShow={show} tab={setupTab} onTab={setSetupTab} />
        ) : items.length > 0 && hasTree ? (
          <Suspense fallback={<Loading />}>
            <CivTree
              items={shown}
              connections={connections}
              selectedId={selectedId}
              hoveredId={hoveredId}
              onSelect={selectItem}
              onHover={hoverItem}
              leftInset={8}
              rightInset={detailOpen && !isNarrow ? PANEL_W : 0}
              narrated={touring || readout}
              asOf={tick ? momentOf(tick.at) : undefined}
              onHeadline={setHeadlineBottom}
              onSaveImage={saveImage}
            />
          </Suspense>
        ) : items.length > 0 ? (
          // A config read in the browser has entries and no tree: placing
          // them on the curated tree is the engine's job, and there is none
          // behind a dropped file.
          <div className="app-map-empty">
            <p>
              What this file declares is in My Setup. Placing a setup on the map takes Ambit running
              on your machine: run <code>ambit web</code>, or <code>./bootstrap.sh web</code> in a
              clone of the repository.
            </p>
            <button type="button" className="tp-btn" onClick={() => showView('setup')}>
              Open My Setup
            </button>
          </div>
        ) : null}
        {showTimeline && history && (
          <Timeline
            history={history}
            at={tick ? historyAt : null}
            onScrub={setHistoryAt}
            playing={historyPlaying}
            onPlay={setHistoryPlaying}
            leftInset={8}
            rightInset={detailOpen && !isNarrow ? PANEL_W : 0}
          />
        )}
        {readout ? (
          <YourAmbit
            style={isNarrow ? undefined : { right: detailOpen ? PANEL_W + 16 : 16 }}
            onClose={() => setReadoutOpen(false)}
            onMapAnother={() => setMapYoursOpen(true)}
            onSample={() => {
              seedDemo();
              setReadoutOpen(false);
              showView('map');
            }}
          />
        ) : touring ? (
          <Tour
            style={isNarrow ? undefined : { right: detailOpen ? PANEL_W + 16 : 16 }}
            onDone={endTour}
            onShowProposals={showProposals}
            onMapped={mapped}
            start={tourStart}
          />
        ) : (
          showGuide &&
          view === 'map' &&
          hasTree && (
            <GettingStartedGuide
              style={
                isNarrow
                  ? undefined
                  : {
                      right: detailOpen ? PANEL_W + 16 : 16,
                      ...(headlineBottom === null ? {} : { top: headlineBottom + 10 }),
                    }
              }
              onDismiss={dismissGuide}
              onReadMore={() => {
                openDocs('reading');
                dismissGuide();
              }}
            />
          )
        )}
      </div>

      {/* On a phone the panel is a bottom sheet, and so is the tour card: while
          the tour narrates the node, the sheet under it said the same thing. */}
      {detailOpen && !(touring && isNarrow) && (
        <aside className="app-detail-panel" aria-label="Capability details">
          <NodeDetailPanel
            onShow={show}
            items={tick ? shown : undefined}
            asOf={tick ? momentOf(tick.at) : undefined}
          />
        </aside>
      )}

      <Finder
        open={finderOpen}
        onClose={() => setFinderOpen(false)}
        onShow={show}
        handlers={paletteHandlers}
      />
      {showApprovalModal && (
        <Suspense fallback={null}>
          <ApprovalModal isOpen onClose={() => setShowApprovalModal(false)} />
        </Suspense>
      )}
      <DocsModal isOpen={showDocs} initialTab={docsTab} onClose={closeDocs} />
      <MapYoursDialog
        open={mapYoursOpen}
        onClose={() => setMapYoursOpen(false)}
        onMapped={mapped}
      />

      {toast && (
        <Toast
          message={toast}
          onDismiss={() => setToast(null)}
          onViewProposals={() => {
            showView('proposals');
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
