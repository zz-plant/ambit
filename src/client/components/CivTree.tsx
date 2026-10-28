import React, { useId, useMemo, useState } from 'react';
import type { Item, Connection } from '../utils/configImporter';
import { useAmbitStore } from '../store/ambitStore';
import { mapKey, typingIn } from '../utils/keys';
import { isRuntimeNode } from '../utils/labels';
import { typeColor } from '../utils/typeColors';
import {
  BAND_MARGIN,
  bandOf,
  bandSpan,
  blocksOf,
  AUTHORITY_LABEL,
  type AuthorityMark,
  authorityMark,
  buildAdjacency,
  buildColumns,
  columnAt,
  columnCentre,
  columnOf,
  columnsSpan,
  columnWindow,
  collapseTo,
  eraOf,
  type Framing,
  frameScene,
  frontierFrame,
  type GridMove,
  gridStep,
  headlineReserve,
  evidenceOf,
  isFailing,
  isRecovering,
  isNext,
  isProven,
  type OutageRole,
  outageRole,
  type JointMark,
  jointMark,
  layoutNodes,
  mapFindings,
  NODE_R,
  READ_ZOOM,
  ROW_H,
  readingOrder,
  rungOf,
  sceneSize,
  START_Y,
  stepSelection,
  visibleItems,
  wholeColumns,
} from './civ/layout.ts';
import { GAINED_THIS_WEEK, LOST_THIS_WEEK, MapFinding } from './civ/MapFinding.tsx';
import { hasHistory } from './civ/history.ts';
import { ImageMenu, type ImageKind } from './civ/ImageMenu.tsx';
import { MapKey } from './civ/MapKey.tsx';
import { AUTHORITY_FILL, AUTHORITY_SYM, heatBins, MapScene } from './civ/MapScene.tsx';
import {
  calloutReach,
  HazardPattern,
  KeystoneMark,
  KeySwatch,
  type LegendKey,
  MapFilters,
  mapKeys,
} from './civ/marks.tsx';
import { Minimap, type MinimapNode } from './civ/Minimap.tsx';
import { SimulationBanner } from './civ/SimulationBanner.tsx';
import { usePinchZoom } from './civ/usePinchZoom.ts';
import { ZOOM_MIN } from './civ/viewport.ts';
import { ZoomHud } from './civ/ZoomHud.tsx';
import { termTitle } from './Term.tsx';
import { isNarrowScreen, useNarrow, useOcclusion } from '../hooks/useViewport';
import { SITE_HOST } from '../utils/copy';

interface CivTreeProps {
  /** Pixels of the scene covered by the docked panel, so column one is visible. */
  leftInset?: number;
  /** Pixels covered by the detail panel, so the lens switcher stays clear of it. */
  rightInset?: number;
  items: Item[];
  connections: Connection[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  /**
   * A tour is telling the story of what is on screen. The simulation banner
   * and the map's finding would say the same thing a second time, and the
   * banner's Done would end a step out from under the tour.
   */
  narrated?: boolean;
  /**
   * The items are a past observation, taken at this moment. What no snapshot
   * stores stays off the map: the attention lens, and the headline with its
   * week and its simulations.
   */
  asOf?: string;
  /** Save the map's finding as a card made to be posted, or the whole map as a file. */
  onSaveImage?: (kind: ImageKind) => void;
}

/** Which outage role each of the outage's keys draws. */
const OUTAGE_ROLE: Record<string, OutageRole> = {
  Down: 'down',
  'Stops working': 'stops',
  'Loses a provider': 'loses a provider',
  'Cut off': 'cut off',
};

/** Where App.css moves the headline to the bottom edge (`.civ-finding-wrap`). */
const HEADLINE_AT_FOOT = '(max-width: 720px)';

export default function CivTree({
  items,
  connections,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  leftInset = 0,
  rightInset = 0,
  narrated = false,
  asOf,
  onSaveImage,
}: CivTreeProps) {
  const requestedLens = useAmbitStore(s => s.activeLens);
  const setActiveLens = useAmbitStore(s => s.setActiveLens);
  // The era whose ladder is open, so its header reads as pressed.
  const selectedEra = useAmbitStore(s => s.selectedEra);
  const selectEra = useAmbitStore(s => s.selectEra);
  // Owned by the store so the header's segments light the same keys the
  // legend does; see AppDeck.tsx.
  const spotlight = useAmbitStore(s => s.spotlight);
  const setSpotlight = useAmbitStore(s => s.setSpotlight);
  const simulationMode = useAmbitStore(s => s.simulationMode);
  const simulatedNodeId = useAmbitStore(s => s.simulatedNodeId);
  const simulatedCascadeIds = useAmbitStore(s => s.simulatedCascadeIds);
  const simulatedWeakenedIds = useAmbitStore(s => s.simulatedWeakenedIds);
  const clearSimulation = useAmbitStore(s => s.clearSimulation);
  const startAcquisition = useAmbitStore(s => s.startAcquisitionSimulation);
  const startOutage = useAmbitStore(s => s.startOutageSimulation);
  const simulation = useMemo(
    () => ({
      mode: simulationMode,
      rootId: simulatedNodeId,
      cascade: simulatedCascadeIds,
      weakened: simulatedWeakenedIds,
    }),
    [simulationMode, simulatedNodeId, simulatedCascadeIds, simulatedWeakenedIds]
  );
  // Everything a simulation touches: what the framing brings into view.
  const simSet = useMemo(
    () =>
      new Set([
        ...(simulatedNodeId ? [simulatedNodeId] : []),
        ...simulatedCascadeIds,
        ...simulatedWeakenedIds,
      ]),
    [simulatedNodeId, simulatedCascadeIds, simulatedWeakenedIds]
  );
  const attentionInterventions = useAmbitStore(s => s.attentionInterventions);
  // The top of the scale the lens is drawn against, and the number its legend
  // prints. Taken from the data so the ramp spans what is actually there.
  const attentionMax = React.useMemo(
    () => Math.max(0, ...Object.values(attentionInterventions ?? {}).map(Number)),
    [attentionInterventions]
  );
  // A lens with no data to colour falls back to the standard map, and the
  // HUD offers it disabled with the reason. The map used to go grey with a
  // note over it.
  const attentionAvailable = !asOf && attentionMax > 0;
  const authorityAvailable = React.useMemo(
    () => items.some(i => authorityMark(i) !== undefined),
    [items]
  );
  const activeLens =
    (requestedLens === 'attention' && !attentionAvailable) ||
    (requestedLens === 'authority' && !authorityAvailable)
      ? 'default'
      : requestedLens;

  const simulatedItem = items.find(i => i.id === simulatedNodeId);

  const { downstream, upstream } = useMemo(() => buildAdjacency(connections, null), [connections]);

  const filtered = useMemo(() => visibleItems(items), [items]);

  // The map collapsed to the selected node's neighbourhood, when a collapse is
  // on. It keys on the selection and never on hover, so the map does not
  // rearrange itself under the pointer. Hidden nodes keep their places: they
  // are skipped where they would be drawn, so the columns do not jump.
  const collapsed = useAmbitStore(s => s.collapsed);
  const collapseDepth = useAmbitStore(s => s.collapseDepth);
  const collapseDirection = useAmbitStore(s => s.collapseDirection);
  const collapse = useMemo(
    () =>
      collapsed && selectedId
        ? collapseTo(filtered, connections, selectedId, collapseDepth, collapseDirection)
        : null,
    [collapsed, selectedId, filtered, connections, collapseDepth, collapseDirection]
  );
  /** Whether the map draws a node: every one, unless a collapse hides it. */
  const shown = (id: string) => !collapse || collapse.shown.has(id);

  const [hoverItem, setHoverItem] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = React.useRef<{
    scrollLeft: number;
    scrollTop: number;
    mouseX: number;
    mouseY: number;
  } | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const surfaceRef = React.useRef<HTMLDivElement>(null);
  /** Put the keyboard on a node, scrolling it into view when asked to. */
  const focusNode = React.useCallback((id: string, scroll: boolean) => {
    const node = containerRef.current?.querySelector<SVGGElement>(
      `[data-node="${CSS.escape(id)}"]`
    );
    node?.focus({ preventScroll: !scroll });
  }, []);
  // The node the arrows last moved to, which keeps the map's one Tab stop
  // when nothing is selected.
  const [rove, setRove] = useState<string | null>(null);
  const { zoomTo, handZoom } = usePinchZoom({
    surface: surfaceRef,
    scroller: containerRef,
    zoom,
    setZoom,
  });

  const { cols, colOrder } = useMemo(
    () => buildColumns(filtered, connections),
    [filtered, connections]
  );

  const nodePositionMap = useMemo(() => layoutNodes({ cols, colOrder }), [cols, colOrder]);
  // A simulation ignores the collapse: its counts are the whole cascade. What
  // the banner adds is how much of it the collapse keeps off the map.
  const hiddenBySimulation = collapse
    ? [...simSet].filter(id => nodePositionMap.has(id) && !collapse.shown.has(id)).length
    : 0;
  const ranked = useAmbitStore(s => s.loop?.next);
  const findings = useMemo(
    () =>
      mapFindings(
        items,
        connections,
        ranked?.map(n => n.id)
      ),
    [items, connections, ranked]
  );
  // The columns holding a next step, and the one holding the best of them:
  // where the map opens when every column will not fit at a size to read.
  const frontierCols = useMemo(
    () =>
      colOrder.flatMap((c, ci) =>
        (cols[c] || []).some(i => i.status !== 'built' && isNext(i)) ? [ci] : []
      ),
    [cols, colOrder]
  );
  const leadCol = useMemo(() => {
    const id = findings.best?.item.id;
    const ci = id ? colOrder.findIndex(c => (cols[c] || []).some(i => i.id === id)) : -1;
    return ci < 0 ? null : ci;
  }, [findings.best, cols, colOrder]);
  // The thumbnail's dots: every node the map draws, where it sits and where it stands.
  const minimapNodes = useMemo<MinimapNode[]>(
    () =>
      [...nodePositionMap.values()]
        .filter(p => !collapse || collapse.shown.has(p.item.id))
        .map(p => ({ id: p.item.id, x: p.x, y: p.y, state: rungOf(p.item) })),
    [nodePositionMap, collapse]
  );
  // Which way the finding's node lies when it is out of sight, as the minimap
  // reports it. The minimap owns the scroll subscription, so this changes when
  // the answer does and not on every scroll event.
  const [where, setWhere] = useState<string | null>(null);
  // A simulation's banner takes the headline's place, a row lower: below the
  // controls, where it sat on the era names, which are buttons, whenever the
  // canvas was scrolled to its top. Its bottom is measured as the headline's is.
  const [bannerBottom, setBannerBottom] = useState<number | null>(null);
  const measureBanner = React.useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      // A phone frames below whatever covers its top, measured as it frames,
      // and its canvas takes no headline padding.
      if (isNarrowScreen()) {
        setBannerBottom(null);
        return;
      }
      const wrap = el.offsetParent as HTMLElement | null;
      const bottom = (wrap?.offsetTop ?? 0) + el.offsetTop + el.offsetHeight;
      setBannerBottom(prev => (prev === bottom ? prev : bottom));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const bannered = !narrated && simulationMode !== 'none' && bannerBottom !== null;
  // The headline is two rows when there is a finding under the range line.
  const headlined =
    Boolean(!narrated && !asOf && (findings.failing.length || findings.best)) || bannered;
  // The node the headline is about, bracketed on the map while the headline
  // shows: the sentence names it, the corners say which circle that is.
  const findingShown =
    !narrated && !asOf && simulationMode === 'none' && !selectedId && selectedEra === null;
  // The sample leads with its next step; see MapFinding.
  const demo = useAmbitStore(s => s.demo);
  const reachFirst = demo && Boolean(findings.best);
  const findingTarget = findingShown
    ? findings.failing[0] && !reachFirst
      ? { id: findings.failing[0].id, color: 'var(--error)' }
      : findings.best
        ? { id: findings.best.item.id, color: 'var(--accent)' }
        : null
    : null;
  // The map's one Tab stop: the selection, else where the arrows last were,
  // else the node the headline names, else the first node there is.
  const tabStop =
    [selectedId, rove, findingTarget?.id].find(
      id => id && nodePositionMap.has(id) && (!collapse || collapse.shown.has(id))
    ) ??
    readingOrder({ cols, colOrder }).find(i => !collapse || collapse.shown.has(i.id))?.id ??
    null;
  const moveFocus = (from: string, move: GridMove) => {
    const to = gridStep({ cols, colOrder }, from, move, collapse?.shown);
    if (!to) return;
    setRove(to);
    focusNode(to, true);
  };
  // Its height, measured, so the canvas starts below it however many lines its
  // rows wrap to. A fixed 40px reserved one line of each, and at 900px the
  // range line wraps and the finding sat on the era names, which are controls.
  // The last measure is kept while a panel hides the headline, so the map does
  // not move when a node is opened. At phone width the headline sits on the
  // bottom edge and takes nothing from the top, so it is measured as absent:
  // kept through a simulation that hid it, its bottom-edge position became
  // the canvas's top padding once the window widened, some 500px of it.
  const [headlineBox, setHeadlineBox] = useState<{ height: number; bottom: number } | null>(null);
  const measureHeadline = React.useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (window.matchMedia(HEADLINE_AT_FOOT).matches) {
        setHeadlineBox(null);
        return;
      }
      const next = { height: el.offsetHeight, bottom: el.offsetTop + el.offsetHeight };
      setHeadlineBox(prev =>
        prev && prev.height === next.height && prev.bottom === next.bottom ? prev : next
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Measured from the controls' row, 12px down, so a headline that moved under
  // the controls on a narrow screen pushes the canvas by that much more.
  const topBottom = Math.max(headlineBox?.bottom ?? 0, bannered ? bannerBottom : 0);
  const headlinePad = headlineReserve(topBottom ? topBottom - 12 : null);
  const rangeSince = useAmbitStore(s => s.rangeSince);
  // The ledger reports the week by name; the tree's names are unique.
  const weekNames = useMemo(
    () => ({
      gained: new Set([...(rangeSince?.gained ?? []), ...(rangeSince?.emergent ?? [])]),
      lost: new Set([...(rangeSince?.lost ?? []), ...(rangeSince?.diminished ?? [])]),
    }),
    [rangeSince]
  );

  // One hop, both ways, from the node in focus: the selection, or failing
  // that whatever the pointer is over. Selecting used to light the whole
  // connected component in both directions, transitively, so a keystone lit
  // most of the map and the two directions read the same. What a node needs
  // and what it enables are drawn apart now, and the transitive answer is
  // the simulation, one click away in the panel.
  const hovered = hoverItem || hoveredId;
  const hazardId = `hazard-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const hazard = `url(#${hazardId})`;
  const filterPrefix = `fx-${hazardId}`;
  const focusId =
    selectedId && nodePositionMap.has(selectedId)
      ? selectedId
      : hovered && nodePositionMap.has(hovered) && shown(hovered)
        ? hovered
        : null;
  const needs = useMemo(
    () => new Set(focusId ? upstream.get(focusId) || [] : []),
    [focusId, upstream]
  );
  const enables = useMemo(
    () => new Set(focusId ? downstream.get(focusId) || [] : []),
    [focusId, downstream]
  );

  // The tree view is one kind of node in era columns; the setup view is many
  // kinds in domain columns. The legend and the spotlights follow.
  const isTreeView = filtered.some(i => eraOf(i) !== undefined);
  const keystone = (item: Item) =>
    (downstream.get(item.id) || []).length >= 3 || isRuntimeNode(item);
  /** The glossary entry each legend key is a picture of. */
  const LEGEND_CONCEPTS: Record<string, string> = {
    Reached: 'state',
    'Next step': 'state',
    Blocked: 'state',
    'Asked for': 'asked-for',
    Keystone: 'keystone',
    Combo: 'combo',
    'Tool server': 'tool-server',
    Agent: 'capability',
    Skill: 'capability',
    Passing: 'evidence',
    Recovering: 'evidence',
    Failing: 'evidence',
    Required: 'prerequisite',
    Optional: 'prerequisite',
    'Interventions a month': 'attention',
    'Needs a person': 'joint',
    'Runs on a device': 'joint',
    ...Object.fromEntries(Object.values(AUTHORITY_LABEL).map(l => [l, 'authority'])),
  };
  const SPOTLIGHTS: Record<string, (item: Item) => boolean> = {
    Reached: i => i.status === 'built',
    'Needs a person': i => jointMark(i) === 'person',
    'Runs on a device': i => jointMark(i) === 'device',
    [GAINED_THIS_WEEK]: i => weekNames.gained.has(i.name),
    [LOST_THIS_WEEK]: i => weekNames.lost.has(i.name),
    // The header's segments light the same nodes they count.
    Verified: isProven,
    'Next step': i => i.status !== 'built' && isNext(i),
    'Asked for': i => i.status !== 'built' && blocksOf(i) > 0,
    Blocked: i => i.status !== 'built' && !isNext(i),
    Server: i => i.type === 'mcp-server',
    Agent: i => i.type === 'agent',
    Skill: i => i.type === 'skill',
    Combo: i => i.type === 'possibility',
    Keystone: keystone,
    Passing: isProven,
    Failing: isFailing,
    Recovering: isRecovering,
    ...Object.fromEntries(
      (Object.keys(AUTHORITY_LABEL) as AuthorityMark[]).map(m => [
        AUTHORITY_LABEL[m],
        (i: Item) => authorityMark(i) === m,
      ])
    ),
  };

  /**
   * The legend for the lens in front of you. Hoisted out of the JSX because
   * the row below it reports how many keys there are and whether any of them
   * can be clicked.
   */
  const KEY = mapKeys(filterPrefix);
  // While a node is selected the legend also keys the two directions its
  // edges are drawn in.
  // Keyed only when the map has one: most machines declare no person and no
  // device, and a key for a mark nothing carries is a question with no answer.
  const jointKeys: LegendKey[] = (['person', 'device'] as JointMark[])
    .filter(m => filtered.some(i => jointMark(i) === m))
    .map(m => KEY[m]);
  // Keyed only when a node is recovering, as the joint marks are.
  const recoveringKeys: LegendKey[] = filtered.some(isRecovering) ? [KEY.recovering] : [];
  // While an outage runs, its own marks, in the banner's words, and only
  // the ones it drew: a key for a mark nothing carries is a question with
  // no answer. None of them lights nodes, since the simulation already has.
  const roles = new Set(
    simulationMode === 'outage' ? filtered.map(i => outageRole(i, simulation)) : []
  );
  const outageKeys: LegendKey[] = [KEY.down, KEY.stops, KEY.losesProvider, KEY.cutOff].filter(k =>
    roles.has(OUTAGE_ROLE[k.label])
  );
  const directionKeys: LegendKey[] =
    selectedId && focusId === selectedId
      ? [
          { kind: 'line', color: 'var(--edge-needs)', label: 'Needs' },
          { kind: 'line', color: 'var(--accent)', label: 'Enables' },
        ]
      : [];
  const failingKey: LegendKey = KEY.failing;
  const legend: LegendKey[] =
    outageKeys.length && activeLens === 'default'
      ? [...outageKeys, ...(filtered.some(isFailing) ? [failingKey] : [])]
      : activeLens === 'authority'
        ? (Object.keys(AUTHORITY_LABEL) as AuthorityMark[]).map(
            (m): LegendKey => ({
              kind: 'node',
              color: AUTHORITY_FILL[m],
              sym: AUTHORITY_SYM[m],
              label: AUTHORITY_LABEL[m],
              hatch: m === 'forbidden',
            })
          )
        : activeLens === 'attention'
          ? [
              // A scale with no unit is a row of coloured dots. Say what is
              // being counted, once, at the head of the ramp.
              { kind: 'label', label: 'Interventions a month' },
              ...heatBins(attentionMax).map(
                (b, i): LegendKey => ({
                  kind: 'node',
                  color: `var(--heat-${i + 1})`,
                  label: b.label,
                })
              ),
            ]
          : isTreeView
            ? [
                KEY.reached,
                KEY.next,
                KEY.askedFor,
                KEY.blocked,
                KEY.keystone,
                KEY.passing,
                ...recoveringKeys,
                failingKey,
                KEY.required,
                KEY.optional,
                ...jointKeys,
                ...directionKeys,
              ]
            : [
                { kind: 'node', color: typeColor('mcp-server'), sym: '◈', label: 'Tool server' },
                { kind: 'node', color: typeColor('agent'), sym: '◆', label: 'Agent' },
                { kind: 'node', color: typeColor('skill'), sym: '◇', label: 'Skill' },
                { kind: 'node', color: typeColor('possibility'), sym: '●', label: 'Combo' },
                KEY.keystone,
                KEY.passing,
                ...recoveringKeys,
                failingKey,
                KEY.required,
                KEY.optional,
                ...directionKeys,
              ];
  // A lens paints with a scale the standard map does not use, so switching to
  // one opens the key until someone closes it; the standard map's key waits
  // to be asked for.
  const keyToggled = useAmbitStore(s => s.keyToggled);
  const setKeyToggled = useAmbitStore(s => s.setKeyToggled);
  const keyOpen = keyToggled ?? activeLens !== 'default';
  const narrow = useNarrow();
  // The strip under the map: the standard map's states, while nothing else is
  // explaining the map, with recovering and failing when a node is either.
  // A phone has no room under it.
  const strip: LegendKey[] =
    isTreeView && activeLens === 'default' && !keyOpen && !narrated && !narrow
      ? simulationMode === 'none'
        ? [
            KEY.reached,
            KEY.next,
            KEY.blocked,
            ...recoveringKeys,
            ...(findings.failing.length ? [failingKey] : []),
          ]
        : outageKeys
      : [];
  const closeKey = React.useCallback(() => setKeyToggled(false), [setKeyToggled]);
  // The Image button's choices: the card, or the whole map as a file. They
  // open where the key does, and in its place while they are open.
  const [imageOpen, setImageOpen] = useState(false);
  const closeImage = React.useCallback(() => setImageOpen(false), []);
  const history = useAmbitStore(s => s.history);
  const historyOpen = useAmbitStore(s => s.historyOpen);
  const setHistoryOpen = useAmbitStore(s => s.setHistoryOpen);

  // The selected node has the detail panel open beside it, which says
  // everything the tooltip would, so the tooltip is for the others.
  const hoverTarget =
    hovered && hovered !== selectedId && nodePositionMap.has(hovered) && shown(hovered)
      ? hovered
      : null;
  const hoverDownstream = hoverTarget ? downstream.get(hoverTarget) || [] : [];

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (typingIn(e.target)) return;
      // A key held with Ctrl, Cmd or Alt is the browser's: see mapKey.
      const key = mapKey(e);
      if (!key) return;
      if (key.kind === 'lens') {
        const available =
          key.lens === 'default' ||
          (key.lens === 'attention' && attentionAvailable) ||
          (key.lens === 'authority' && authorityAvailable);
        if (available) setActiveLens(key.lens);
      } else if (key.kind === 'zoom') {
        e.preventDefault();
        if (key.to === 'actual') zoomTo(1);
        else if (key.to === 'in') zoomTo(z => +(z + 0.15).toFixed(2));
        else zoomTo(z => +(z - 0.15).toFixed(2));
      } else {
        e.preventDefault();
        // A collapse hides nodes, and a key that lands on one selects what
        // nobody can see, so the walk skips them. It walks the map as it is
        // read, down an era and on to the next, and takes the focus along
        // when the focus was on the map or nowhere.
        const to = stepSelection(
          readingOrder({ cols, colOrder }),
          selectedId,
          key.by,
          collapse?.shown
        );
        if (to) {
          onSelect(to);
          const at = document.activeElement;
          if (!at || at === document.body || at.closest?.('[data-node]')) focusNode(to, false);
        }
      }
      // Escape is the shell's, which peels the spotlight, the simulation and
      // the selection one press at a time (escapeLayer, in utils/keys.ts).
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    setActiveLens,
    attentionAvailable,
    authorityAvailable,
    selectedId,
    onSelect,
    cols,
    colOrder,
    focusNode,
    collapse,
    zoomTo,
  ]);

  // The bottom of the canvas a tour card or a bottom sheet is covering.
  const { bottom: covered, right: coveredRight } = useOcclusion(containerRef);

  const { width: contentWidth, height: contentHeight } = sceneSize({ cols, colOrder });

  // Open on what can be read. Every column when the names read at that size:
  // at 1440px all nine at 93%, where fitting the scene's margins as well drew
  // them at 84% and the names at ten pixels. A narrower screen opens on the
  // frontier, on whole columns, with the rest a scroll away and on the
  // minimap. Fits once per dataset, and again when the canvas changes width
  // while the zoom is still the one the fit chose: a window opened narrow and
  // then widened kept its narrow zoom, or the reverse, with Foundation or
  // Launch Ready off the edge. Once someone zooms, the zoom controls own it.
  const [boxWidth, setBoxWidth] = useState<number | null>(null);
  const [boxHeight, setBoxHeight] = useState<number | null>(null);
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setBoxWidth(el.clientWidth);
      setBoxHeight(el.clientHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  /**
   * The zoom the map opens at in a canvas `width` wide, and the scroll that
   * starts it on a whole column: as many columns as read at READ_ZOOM, and on
   * a phone, where every column is a name four pixels tall, as many as read
   * at 0.66, which is three at 390px. See frontierFrame for which ones.
   */
  const restFrame = React.useCallback(
    (width: number) => {
      const phone = width < 700;
      const f = frontierFrame(
        phone ? width : width - leftInset - 16,
        colOrder.length,
        frontierCols,
        leadCol,
        phone ? 0.66 : READ_ZOOM
      );
      // The room left over, which the frame was fitted inside, split either
      // side of it: flush, the first column sat 6px from the window's edge.
      return { zoom: f.zoom, left: leftInset + f.left * f.zoom - (phone ? 0 : 8) };
    },
    [colOrder.length, leftInset, frontierCols, leadCol]
  );
  // At rest, a tree shorter than the canvas sat at the top of it, 170px over
  // the key at 1440 by 900; it is centred between the controls and the key.
  const KEY_STRIP = 56;
  const centring =
    !narrow && boxHeight !== null
      ? Math.max(
          0,
          Math.floor(
            (boxHeight - (headlined ? headlinePad : 0) - 44 - contentHeight * zoom - KEY_STRIP) / 2
          )
        )
      : 0;
  // A scroll computed for a zoom being set waits for that zoom to draw. Sent
  // in the next animation frame, it could reach the browser while the canvas
  // was still the old size, and the browser held it to the old size's end: a
  // phone framing the last two columns stopped 80px short, inside a third.
  // It waits for its own zoom: run again at the old one, as React's strict mode
  // runs an effect twice, it landed on the canvas at its old size and was lost.
  // A zoom that moves somewhere else, a pinch say, leaves it with nothing to wait for.
  const pendingScroll = React.useRef<{
    left: number;
    top: number;
    smooth: boolean;
    zoom: number;
    from: number;
  } | null>(null);
  React.useLayoutEffect(() => {
    const el = containerRef.current;
    const to = pendingScroll.current;
    if (!el || !to) return;
    if (to.zoom !== zoom) {
      if (zoom !== to.from) pendingScroll.current = null;
      return;
    }
    pendingScroll.current = null;
    el.scrollTo({ left: to.left, top: to.top, behavior: to.smooth ? 'smooth' : 'auto' });
  }, [zoom]);
  /**
   * Set the zoom and then scroll, in that order, whether or not the zoom
   * changes. The scroll glides, unless the reader has asked for less motion.
   */
  const zoomAndScroll = React.useCallback(
    (next: number, left: number, top: number, glide = true) => {
      const el = containerRef.current;
      if (!el) return;
      const smooth =
        glide &&
        !(
          typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
        );
      if (next === zoom) {
        el.scrollTo({ left, top, behavior: smooth ? 'smooth' : 'auto' });
        return;
      }
      pendingScroll.current = { left, top, smooth, zoom: next, from: zoom };
      setZoom(next);
    },
    [zoom]
  );
  const fittedFor = React.useRef<number | null>(null);
  const fittedAt = React.useRef<{ width: number; zoom: number } | null>(null);
  React.useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // The observer's width once it has reported; the first fit reads the box.
    const width = boxWidth ?? el.clientWidth;
    const fresh = fittedFor.current !== contentWidth;
    const refit =
      fittedAt.current !== null &&
      fittedAt.current.width !== width &&
      fittedAt.current.zoom === zoom;
    if (!fresh && !refit) return;
    if (width - leftInset - 16 <= 0) return;
    fittedFor.current = contentWidth;
    // The map opens on whole columns and scrolls sideways; Fit still shows it
    // all. It starts at a column's edge, not the scene's margin, so the last
    // column it holds ends at the screen's edge instead of under it.
    const rest = restFrame(width);
    fittedAt.current = { width, zoom: rest.zoom };
    // A framing decided before this fit was decided at the old zoom, and this
    // fit would undo it unseen: a node selected by a link was framed at 100%,
    // then the fit set 84%, and the panel cut a column. It is asked again.
    framedWide.current = '';
    zoomAndScroll(rest.zoom, rest.left, el.scrollTop, false);
  }, [contentWidth, leftInset, boxWidth, zoom, restFrame, zoomAndScroll]);

  // On a wider screen the panel or a card sits over the map's right edge,
  // which is where the Product and Operations eras are, so a route to Launch
  // Ready was numbered entirely under it, and opening a node's panel cut a
  // column at the panel's edge in every screenshot of it. What is lit, or the
  // selected node with what it needs and enables, is brought into the canvas
  // they leave. The whole tree comes first when it fits there at READ_ZOOM,
  // since a frame of all of it cuts nothing; past that, whole columns up to
  // the panel's edge or the card's, the subject among them (columnFrame).
  // Fitted at half size, the whole tree drew the names beside the panel at
  // eight pixels. A zoom someone made by hand keeps its scale. When the
  // subject goes, a frame this chose gives way to the one on arrival again.
  const framedWide = React.useRef('');
  const framedZoom = React.useRef<number | null>(null);
  React.useEffect(() => {
    const el = containerRef.current;
    if (narrow || !el) return;
    const subject =
      simulationMode !== 'none'
        ? [...simSet]
        : selectedId
          ? [selectedId, ...needs, ...enables]
          : [];
    // The card is measured a frame after it mounts, and a step lit before then
    // was framed as if nothing covered the map.
    const key = `${simulationMode}:${simulatedNodeId}:${selectedId}:${coveredRight}:${rightInset}:${headlinePad}`;
    // A frame worked out at a zoom about to change is worked out at the wrong
    // one: the first visit's tour framed at 100% while the fit's zoom waited to
    // draw. Asked again once it has, since the zoom is a dependency.
    if (pendingScroll.current) return;
    if (framedWide.current === key) return;
    framedWide.current = key;
    if (!subject.length) {
      if (framedZoom.current !== null && zoom === framedZoom.current) {
        const rest = restFrame(el.clientWidth);
        zoomAndScroll(rest.zoom, rest.left, 0);
      }
      framedZoom.current = null;
      return;
    }
    const points: { x: number; y: number }[] = subject.flatMap(id => nodePositionMap.get(id) ?? []);
    if (!points.length) return;
    // An outage's callout reaches left of its root, and past the map's edge
    // when the root is in the first column: a frame flush to the bands cut
    // "DOWN ·" off. Its count is at most what is lit, so this is never short.
    const root =
      simulationMode === 'outage' && simulatedNodeId ? nodePositionMap.get(simulatedNodeId) : null;
    if (root) {
      points.push({
        x: root.x - calloutReach(NODE_R, `DOWN · STOPS ${simSet.size}`),
        y: root.y - NODE_R - 28,
      });
    }
    const box = el.getBoundingClientRect();
    // What lies over the top of the canvas, measured as on a phone: the
    // controls, a simulation's banner, the finding. A constant for the
    // controls alone put the era names under a banner.
    let hud = 88;
    for (const over of surfaceRef.current?.querySelectorAll(
      '.civ-zoom-hud, .civ-lens-hud, .civ-sim-banner, .civ-finding'
    ) ?? []) {
      const r = over.getBoundingClientRect();
      if (r.height > 0 && r.top < box.top + box.height / 2) {
        hud = Math.max(hud, r.bottom - box.top + 8);
      }
    }
    // Where the scene starts below the scroller's top: the headline's padding
    // and the canvas's margin. The centring is left out, since it is above
    // zero only when the canvas is too short to scroll.
    const svg = el.querySelector('svg');
    const insetTop = svg ? svg.getBoundingClientRect().top - box.top + el.scrollTop - centring : 0;
    const right = el.scrollLeft + el.clientWidth - rightInset;
    // While the tour narrates, its card covers the map's lower right, and a
    // lit node under it is as hidden as one off screen: the outage's last eras
    // ran on under the card that was describing them. Measured in the
    // scroller's own viewport.
    const tour = narrated ? document.querySelector('.app-tour')?.getBoundingClientRect() : null;
    const card = tour ? { left: tour.left - box.left, top: tour.top - box.top } : null;
    const inView = points.every(p => {
      const x = p.x * zoom + leftInset;
      const y = p.y * zoom + insetTop + centring;
      const underCard =
        card !== null &&
        x + NODE_R - el.scrollLeft >= card.left &&
        // The name hangs below the circle.
        y + NODE_R + 30 - el.scrollTop >= card.top;
      return (
        x - NODE_R >= el.scrollLeft &&
        x + NODE_R <= right &&
        y >= el.scrollTop + hud &&
        y <= el.scrollTop + el.clientHeight &&
        !underCard
      );
    });
    // The panel cuts whatever of the map runs under it.
    const cut =
      rightInset > 0 && leftInset + contentWidth * zoom - el.scrollLeft > right - el.scrollLeft;
    const byHand = zoom === handZoom.current;
    if (inView && (!cut || byHand)) return;
    const open = {
      top: hud,
      width: (card ? card.left : el.clientWidth - rightInset) - leftInset - 16,
      height: el.clientHeight - hud,
    };
    const scene = [
      { x: Math.min(bandSpan(0).left, ...points.map(p => p.x)), y: START_Y },
      { x: bandSpan(colOrder.length - 1).right, y: contentHeight - 60 },
    ];
    const head = bandOf(0, contentHeight).y;
    const whole = byHand
      ? null
      : frameScene(scene, open, {
          min: READ_ZOOM,
          max: zoom,
          inset: leftInset,
          insetTop,
          head,
          pad: BAND_MARGIN * 2,
        });
    // A zoom rounded to two places can come out a pixel or two over.
    const wholeFits =
      whole !== null && (scene[1].x - scene[0].x + BAND_MARGIN * 4) * whole.zoom <= open.width + 4;
    const simulating = simulationMode !== 'none';
    const kept = !simulating && selectedId ? nodePositionMap.get(selectedId) : undefined;
    const zoomRange = {
      min: simulating ? ZOOM_MIN : Math.min(READ_ZOOM, zoom),
      max: zoom,
      inset: leftInset,
      insetTop,
      head,
      keep: kept,
      columns: colOrder.length,
      sceneWidth: contentWidth,
    };
    const columns = colOrder.length;
    const lit = points.map(p => columnAt(p.x, columns));
    const keepCol = kept && columnAt(kept.x, columns);
    // Whole columns up to an edge `room` pixels from where the scene starts:
    // the panel's, or the card's. Exactly n of them fill it at one zoom each;
    // of the two either side of the zoom already drawn, the nearer that reads,
    // and never past 100%. A simulation takes as many as it lights. Filled to
    // the edge, the frame is also one the scroller can reach: left short of
    // it, a frame of the last columns asked for a scroll past the canvas's end.
    const columnFrame = (room: number): Framing | null => {
      const span = simulating ? Math.max(...lit) - Math.min(...lit) + 1 : 1;
      const near = wholeColumns(room, columns, zoom);
      const options = [near, near + 1]
        .map(n => Math.min(columns, Math.max(n, span)))
        .map(n => ({ n, z: Math.floor((room / columnsSpan(n)) * 1000) / 1000 }))
        .filter(o => o.z <= 1);
      const reads = options.filter(o => o.z >= (simulating ? ZOOM_MIN : READ_ZOOM));
      const pick = (reads.length ? reads : options).reduce<{ n: number; z: number } | null>(
        (best, o) => (!best || Math.abs(o.z - zoom) < Math.abs(best.z - zoom) ? o : best),
        null
      ) ?? { n: columns, z: 1 };
      const z = Math.max(ZOOM_MIN, pick.z);
      const upright = frameScene(points, open, {
        ...zoomRange,
        min: z,
        max: z,
        columns: undefined,
      });
      if (!upright) return null;
      // Where the scroller stops short of the frame, before a card is
      // measured say, the frame starts a column earlier. Clamped there by the
      // browser, it began inside one, and a frame with what is lit in view is
      // not asked again.
      const reach = leftInset + contentWidth * z + rightInset + coveredRight - el.clientWidth;
      const at = (ci: number) => leftInset + (bandSpan(ci).left - BAND_MARGIN) * z;
      let first = columnWindow(lit, pick.n, columns, keepCol);
      while (first > 0 && at(first) > reach + 1) first--;
      return { zoom: z, top: upright.top, left: Math.max(0, Math.round(at(first))) };
    };
    const frame = wholeFits
      ? whole!
      : byHand
        ? frameScene(points, open, zoomRange)
        : columnFrame(card ? card.left - leftInset : el.clientWidth - rightInset - leftInset);
    if (!frame) return;
    // Remembered whether or not the zoom moved, so the frame on arrival comes
    // back when the subject goes: a selection that only scrolled left the map
    // where the panel had needed it.
    framedZoom.current = frame.zoom;
    zoomAndScroll(frame.zoom, frame.left, frame.top);
  }, [
    narrow,
    narrated,
    simulationMode,
    simulatedNodeId,
    simSet,
    selectedId,
    needs,
    enables,
    nodePositionMap,
    leftInset,
    rightInset,
    coveredRight,
    zoom,
    handZoom,
    colOrder.length,
    contentWidth,
    contentHeight,
    restFrame,
    zoomAndScroll,
    centring,
    headlinePad,
  ]);

  // On a phone, whatever is lit gets the screen: a simulation's cascade, or a
  // selected node with what it needs and enables. Framed into the part of the
  // canvas not under a card, at a zoom where the names can be read.
  const framedFor = React.useRef('');
  React.useEffect(() => {
    const el = containerRef.current;
    if (!narrow || !el) return;
    const lit =
      simulationMode !== 'none'
        ? [...simSet]
        : selectedId
          ? [selectedId, ...needs, ...enables]
          : [];
    const key = `${simulationMode}:${simulatedNodeId}:${selectedId}:${covered}`;
    if (!lit.length || framedFor.current === key) return;
    framedFor.current = key;
    const points = lit.flatMap(id => nodePositionMap.get(id) ?? []);
    // What lies over the top of the canvas, measured: the zoom and lens
    // controls with the map's tools on a row of their own, and a simulation's
    // banner. The tour and an open sheet hide the controls on a phone.
    const box = el.getBoundingClientRect();
    let hud = 0;
    for (const over of surfaceRef.current?.querySelectorAll(
      '.civ-zoom-hud, .civ-lens-hud, .civ-sim-banner'
    ) ?? []) {
      const r = over.getBoundingClientRect();
      if (r.height > 0 && r.top < box.top + box.height / 2) hud = Math.max(hud, r.bottom - box.top);
    }
    hud += 8;
    const svg = el.querySelector('svg');
    const insetTop = svg ? Number.parseFloat(getComputedStyle(svg).marginTop) || 0 : 0;
    const keepId = simulationMode !== 'none' ? simulatedNodeId : selectedId;
    // The screen's width: the inset is where the scene starts inside the
    // scroller, which `inset` places, and at the scene's end the scroll stops
    // by the whole width. Less the inset, a frame there began a sliver of a
    // column early.
    const view = { top: hud, width: el.clientWidth, height: el.clientHeight - hud - covered };
    // A simulation's card names everything it lights, so every column it
    // lights gets the screen, whole, at the zoom that holds exactly those:
    // framed round its points, the tour's first step at 390px cut Sovereignty
    // at the right edge, and at 0.7 it had shown two of the four it named.
    if (simulationMode !== 'none') {
      const litCols = points.map(p => columnAt(p.x, colOrder.length));
      const first = Math.min(...litCols);
      const span = Math.max(...litCols) - first + 1;
      const z = Math.max(
        0.5,
        Math.min(1.1, Math.floor((view.width / columnsSpan(span)) * 1000) / 1000)
      );
      const keep = keepId ? nodePositionMap.get(keepId) : undefined;
      const upright = frameScene(points, view, {
        min: z,
        max: z,
        inset: leftInset,
        insetTop,
        keep,
      });
      if (!upright) return;
      zoomAndScroll(
        z,
        Math.round(leftInset + (bandSpan(first).left - BAND_MARGIN) * z),
        upright.top
      );
      return;
    }
    const frame = frameScene(points, view, {
      // A selection keeps the floor its names can be read at.
      min: 0.7,
      max: 1.1,
      inset: leftInset,
      insetTop,
      keep: keepId ? nodePositionMap.get(keepId) : undefined,
      columns: colOrder.length,
      sceneWidth: contentWidth,
    });
    if (!frame) return;
    zoomAndScroll(frame.zoom, frame.left, frame.top);
  }, [
    narrow,
    simulationMode,
    simulatedNodeId,
    simSet,
    selectedId,
    needs,
    enables,
    covered,
    nodePositionMap,
    leftInset,
    colOrder.length,
    contentWidth,
    zoomAndScroll,
  ]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (
      (e.target as HTMLElement).closest('[role="button"]') ||
      (e.target as HTMLElement).closest('button')
    )
      return;
    if (!containerRef.current) return;
    setIsDragging(true);
    dragStartRef.current = {
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop,
      mouseX: e.clientX,
      mouseY: e.clientY,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !dragStartRef.current || !containerRef.current) return;
    const dx = e.clientX - dragStartRef.current.mouseX;
    const dy = e.clientY - dragStartRef.current.mouseY;
    containerRef.current.scrollLeft = dragStartRef.current.scrollLeft - dx;
    containerRef.current.scrollTop = dragStartRef.current.scrollTop - dy;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    dragStartRef.current = null;
  };

  // The controls sit over the scroller, not inside it. Inside, they were
  // sticky, which holds vertically and, with a left inset, horizontally too;
  // but Chrome measures that inset from the scroller's padding edge and other
  // engines from its border edge, so centring a node pushed the zoom controls
  // 340px to the right in one and under the capability list in the other.
  return (
    <div className="civ-tree" ref={surfaceRef}>
      <ZoomHud
        zoom={zoom}
        setZoom={setZoom}
        zoomTo={zoomTo}
        containerRef={containerRef}
        contentWidth={contentWidth}
        contentHeight={contentHeight}
        activeLens={activeLens}
        onSetLens={setActiveLens}
        attentionAvailable={attentionAvailable}
        authorityAvailable={authorityAvailable}
        leftInset={leftInset}
        rightInset={rightInset}
        lensNote={
          asOf
            ? 'A past moment keeps what was reached and what its checks said, not who stepped in or what may act. Go back to now to use this lens.'
            : undefined
        }
        tools={
          <>
            <button
              type="button"
              className={`civ-zoom-btn${keyOpen ? ' is-on' : ''}`}
              aria-expanded={keyOpen}
              data-key-toggle
              onClick={() => setKeyToggled(!keyOpen)}
              title="What each mark on the map means"
            >
              Key
            </button>
            {hasHistory(history) && (
              <button
                type="button"
                className={`civ-zoom-btn${historyOpen ? ' is-on' : ''}`}
                aria-pressed={historyOpen}
                onClick={() => setHistoryOpen(!historyOpen)}
                title="The frontier through time: scrub the map back to an earlier moment"
              >
                History
              </button>
            )}
            {onSaveImage && !asOf && (
              <button
                type="button"
                className={`civ-zoom-btn${imageOpen ? ' is-on' : ''}`}
                aria-expanded={imageOpen}
                data-image-toggle
                onClick={() => setImageOpen(!imageOpen)}
                title="Save the whole map, or its headline as a card to post"
              >
                Image
              </button>
            )}
            {spotlight && (
              <button
                type="button"
                className="civ-zoom-btn civ-spot-pill"
                onClick={() => setSpotlight(null)}
                title="Show every node again (Esc)"
                aria-label={`Showing ${spotlight} only. Show every node again`}
              >
                {spotlight} only <span aria-hidden="true">×</span>
              </button>
            )}
          </>
        }
        popover={
          imageOpen && onSaveImage && !asOf ? (
            <ImageMenu onSave={onSaveImage} onClose={closeImage} />
          ) : (
            keyOpen && (
              <MapKey
                keys={legend}
                spotlight={spotlight}
                lights={label => Boolean(SPOTLIGHTS[label])}
                onSpotlight={setSpotlight}
                concepts={LEGEND_CONCEPTS}
                hazard={hazard}
                onClose={closeKey}
              />
            )
          )
        }
      />

      {!narrated && (
        <SimulationBanner
          simulationMode={simulationMode}
          simulatedNodeId={simulatedNodeId}
          simulatedItem={simulatedItem}
          simulatedCascadeIds={simulatedCascadeIds}
          simulatedWeakenedIds={simulatedWeakenedIds}
          items={items}
          hiddenByFocus={hiddenBySimulation}
          clearSimulation={clearSimulation}
          leftInset={leftInset}
          rightInset={rightInset}
          bannerRef={measureBanner}
        />
      )}

      {/* Hidden while a panel is open, a node's or an era's ladder: the panel
          is then what is being read, and the headline sat on the lens switch. */}
      {!narrated && !asOf && simulationMode === 'none' && !selectedId && selectedEra === null && (
        <MapFinding
          wrapRef={measureHeadline}
          findings={findings}
          since={rangeSince}
          onShow={id => onSelect(id)}
          onSimulate={id => {
            onSelect(id);
            startOutage(id);
          }}
          onSpotlight={key => setSpotlight(spotlight === key ? null : key)}
          onPreview={id => {
            onSelect(id);
            startAcquisition(id);
          }}
          where={where}
          leftInset={leftInset}
          rightInset={rightInset}
          reachFirst={reachFirst}
        />
      )}

      {/* biome-ignore lint/a11y/noStaticElementInteractions: Dragging to pan is a pointer affordance layered over the canvas. Content inside is keyboard operable. */}
      <div
        ref={containerRef}
        // The headline is two rows when there is a finding under the range
        // line; the canvas starts below the second, so the era headers stay
        // readable and pressable, however far the rows wrap.
        className={`civ-scroll ${headlined ? 'civ-scroll--headline' : ''}`}
        // Dragging to pan is a pointer affordance layered over the canvas. The
        // a11y warning on this element is expected and left visible: every node
        // inside carries role="button", tabIndex and a key handler, so the
        // content is reachable and operable without a pointer.
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={
          {
            paddingLeft: leftInset,
            // Room to scroll the last columns out from under an open panel,
            // and on a wide screen out from under the card in the corner, the
            // tour's or the readout's, measured: at 800px the lit eras had
            // nowhere to scroll to.
            paddingRight: rightInset + coveredRight,
            // And on a phone, room below for whatever covers the bottom: the
            // map is shorter than the screen there, so a node under the sheet
            // describing it had nowhere to scroll up to.
            paddingBottom: narrow ? covered : 0,
            cursor: isDragging ? 'grabbing' : 'default',
            userSelect: isDragging ? 'none' : 'auto',
            '--headline-pad': `${headlinePad}px`,
          } as React.CSSProperties
        }
      >
        {/* Main SVG Vector Canvas */}
        <svg
          viewBox={`0 0 ${contentWidth} ${contentHeight}`}
          className="civ-tree-svg"
          style={{
            background: 'var(--bg-canvas)',
            width: `${contentWidth * zoom}px`,
            height: `${contentHeight * zoom}px`,
            minWidth: `${contentWidth * zoom}px`,
            ...(centring > 0 ? { marginTop: `${44 + centring}px` } : {}),
          }}
        >
          <title>Capability tree: what this setup can do, by era</title>
          <desc>
            The arrow keys move between capabilities, down an era and across to the next; Enter
            opens one.
          </desc>
          <defs>
            <HazardPattern id={hazardId} />
            <MapFilters prefix={filterPrefix} />
          </defs>
          <MapScene
            items={items}
            connections={connections}
            cols={cols}
            colOrder={colOrder}
            positions={nodePositionMap}
            height={contentHeight}
            downstream={downstream}
            simulation={simulation}
            hazard={hazard}
            filters={filterPrefix}
            view={{
              lens: activeLens,
              attention: attentionInterventions,
              selectedId,
              focusId,
              needs,
              enables,
              collapse,
              spotlight,
              spotlit: item => !spotlight || (SPOTLIGHTS[spotlight]?.(item) ?? true),
              findingTarget,
              openEra: selectedEra,
              onOpenEra: selectEra,
              onSelect,
              onHover: id => {
                onHover?.(id);
                setHoverItem(id);
              },
              tabStop,
              onMove: moveFocus,
            }}
          />
          {/* Hover tooltip */}
          {hoverTarget &&
            (() => {
              const ni = items.find(i => i.id === hoverTarget);
              if (!ni) return null;
              const di = colOrder.indexOf(columnOf(ni));
              const ai = (cols[columnOf(ni)] || []).findIndex((i: Item) => i.id === hoverTarget);
              if (di < 0 || ai < 0) return null;

              const wrap = (text: string, perLine = 28, max = 4) => {
                const out: string[] = [];
                let line = '';
                for (const word of text.split(' ')) {
                  if ((line + word).length > perLine) {
                    out.push(line.trim());
                    line = '';
                  }
                  if (out.length === max) return [...out.slice(0, max - 1), out[max - 1] + '…'];
                  line += word + ' ';
                }
                if (line.trim()) out.push(line.trim());
                return out;
              };

              const unreached = ni.status !== 'built';
              const lines = unreached && ni.description ? wrap(ni.description) : [];
              const enables = hoverDownstream.slice(0, 4);
              const downCount = (downstream.get(ni.id) || []).length;
              const isKey = downCount >= 3 || isRuntimeNode(ni);

              // What the node's evidence says, or what a running outage does
              // to it: the line that names a texture the map draws.
              const role = outageRole(ni, simulation);
              const evidence = evidenceOf(ni);
              const said = role
                ? {
                    text: `${role === 'down' ? 'Down' : role === 'stops' ? 'Stops working' : role === 'cut off' ? 'Cut off before it was set up' : 'Loses a provider, keeps another'} in this simulation`,
                    color: role === 'loses a provider' ? 'var(--warn)' : 'var(--error)',
                  }
                : evidence
                  ? {
                      text: isFailing(ni)
                        ? '! Failing its check'
                        : isProven(ni)
                          ? '✓ Passing its check'
                          : `${evidence[0].toUpperCase()}${evidence.slice(1)}`,
                      color: isFailing(ni)
                        ? 'var(--error)'
                        : isProven(ni)
                          ? 'var(--ok)'
                          : 'var(--text-secondary)',
                    }
                  : null;

              const W = 236;
              const headH = 22;
              const saidH = said ? 18 : 0;
              const keyH = isKey ? 18 : 0;
              const descH = lines.length * 15;
              const enablesH = enables.length ? 20 + enables.length * 15 : 0;
              // The simulations are the thing people do not find, and a faded
              // circle reads as scenery until something says otherwise. A click
              // opens the panel that offers the one this node can run: an outage
              // on a node you have, an unlock on one you do not. While one
              // runs, the card does not offer the next over it.
              const hint = asOf
                ? 'Click: details, as of this moment'
                : simulationMode !== 'none'
                  ? 'Click: details'
                  : unreached
                    ? 'Click: details, and simulate unlocking it'
                    : 'Click: details, and simulate an outage';
              const hintH = 17;
              const boxH = headH + saidH + keyH + descH + enablesH + hintH + 12;

              // To the right of the node, unless that runs past the map's edge:
              // the last column's card was cut off there.
              const right = columnCentre(di) + NODE_R + 10;
              const tx = right + W > contentWidth ? columnCentre(di) - NODE_R - 10 - W : right;
              const ty = START_Y + ai * ROW_H + NODE_R - 10;

              return (
                <g transform={`translate(${tx}, ${ty})`} pointerEvents="none">
                  <rect
                    x={0}
                    y={0}
                    width={W}
                    height={boxH}
                    rx={8}
                    fill="var(--bg-elevated)"
                    stroke="var(--border-bright)"
                    strokeWidth={1}
                  />
                  <text
                    x={12}
                    y={16}
                    fill="var(--text-primary)"
                    fontSize={13}
                    fontWeight={600}
                    fontFamily="var(--font-sans)"
                  >
                    {ni.name}
                  </text>
                  {said && (
                    <text
                      x={12}
                      y={headH + 12}
                      fill={said.color}
                      fontSize={11}
                      fontWeight={600}
                      fontFamily="var(--font-sans)"
                    >
                      {said.text}
                    </text>
                  )}
                  {isKey && (
                    <>
                      <g transform={`translate(17, ${headH + saidH + 8})`}>
                        <KeystoneMark />
                      </g>
                      <text
                        x={27}
                        y={headH + saidH + 12}
                        fill="var(--warn)"
                        fontSize={11}
                        fontWeight={600}
                        fontFamily="var(--font-sans)"
                      >
                        Keystone: {downCount} depend on it
                      </text>
                    </>
                  )}
                  {lines.map((line, i) => (
                    <text
                      key={i}
                      x={12}
                      y={headH + saidH + keyH + 12 + i * 15}
                      fill="var(--text-secondary)"
                      fontSize={12}
                      fontFamily="var(--font-sans)"
                    >
                      {line}
                    </text>
                  ))}
                  {enables.length > 0 && (
                    <text
                      x={12}
                      y={headH + saidH + keyH + descH + 15}
                      fill="var(--text-muted)"
                      fontSize={11}
                      fontWeight={600}
                      fontFamily="var(--font-sans)"
                    >
                      Enables
                    </text>
                  )}
                  {enables.map((did, i) => {
                    const dep = items.find(it => it.id === did);
                    const label = dep
                      ? dep.name.length > 22
                        ? dep.name.slice(0, 20) + '…'
                        : dep.name
                      : did;
                    return (
                      <text
                        key={did}
                        x={14}
                        y={headH + saidH + keyH + descH + 30 + i * 15}
                        fill="var(--text-primary)"
                        fontSize={12}
                        fontFamily="var(--font-sans)"
                      >
                        {label}
                      </text>
                    );
                  })}
                  {hoverDownstream.length > 4 && (
                    <text
                      x={14}
                      y={boxH - hintH - 6}
                      fill="var(--text-muted)"
                      fontSize={11}
                      fontFamily="var(--font-sans)"
                    >
                      +{hoverDownstream.length - 4} more
                    </text>
                  )}
                  <text
                    x={12}
                    y={boxH - 7}
                    fill="var(--accent)"
                    fontSize={11}
                    fontFamily="var(--font-sans)"
                  >
                    {hint}
                  </text>
                </g>
              );
            })()}
        </svg>
      </div>
      {/* Where this came from, for the screenshot that loses the address bar.
          Only while the map is idle, which is when the whole map is what gets
          captured: in the tour it sat on the node the story was about, and
          while anything is lit the lit thing is the point. The saved image
          carries the address either way. */}
      {!narrated && simulationMode === 'none' && !selectedId && (
        <div
          className="civ-source"
          style={{
            left: leftInset + 8,
            transform: covered ? `translateY(${-covered}px)` : undefined,
          }}
        >
          Ambit · {SITE_HOST}
        </div>
      )}

      {/* The states, always in view on the standard map. Four ways to draw a
          circle plus badges, a keystone and line styles was more than a first
          look could decode, and the key that names them waited behind a
          button. The rest of the marks stay in the Key. */}
      {strip.length > 0 && (
        <div
          className="civ-strip"
          role="group"
          aria-label="What the circles mean"
          style={{ bottom: covered + 10, left: leftInset + 8 }}
        >
          {strip.map(entry => {
            const on = spotlight === entry.label;
            const title = entry.hint ?? termTitle(LEGEND_CONCEPTS[entry.label] ?? '');
            const picture = (
              <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">
                <KeySwatch entry={entry} hazard={hazard} />
              </svg>
            );
            // An outage's marks say what the simulation drew, and light nothing.
            if (!SPOTLIGHTS[entry.label]) {
              return (
                <span
                  key={entry.label}
                  className="civ-strip-key civ-strip-key--still"
                  title={title}
                >
                  {picture}
                  {entry.label}
                </span>
              );
            }
            return (
              <button
                key={entry.label}
                type="button"
                className={`civ-strip-key${on ? ' is-on' : ''}`}
                aria-pressed={on}
                onClick={() => setSpotlight(on ? null : entry.label)}
                title={title}
              >
                {picture}
                {entry.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Not while a tour narrates the map: its card sits where the thumbnail
          does, and the finding the thumbnail feeds is hidden then too. */}
      {/* Not with a panel open either: it sat over the map's right edge, the
          part left beside the panel, and the headline it feeds is hidden then. */}
      {!narrated && !selectedId && selectedEra === null && (
        <Minimap
          containerRef={containerRef}
          zoom={zoom}
          width={contentWidth}
          height={contentHeight}
          columns={colOrder.length}
          nodes={minimapNodes}
          watch={findings.failing[0]?.id}
          onWhere={setWhere}
          layoutKey={`${headlined}:${headlinePad}`}
          leftInset={leftInset}
          rightInset={rightInset}
          across={
            colOrder.length
              ? {
                  left: bandSpan(0).left - BAND_MARGIN,
                  right: bandSpan(colOrder.length - 1).right + BAND_MARGIN,
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
