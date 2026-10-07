import React, { useEffect, useId, useMemo, useState } from 'react';
import type { Item, Connection } from '../utils/configImporter';
import { useAmbitStore } from '../store/ambitStore';
import { mapKey, typingIn } from '../utils/keys';
import { isRuntimeNode } from '../utils/labels';
import { typeColor } from '../utils/typeColors';
import {
  AUTHORITY_LABEL,
  type AuthorityMark,
  authorityMark,
  buildAdjacency,
  buildColumns,
  columnCentre,
  columnOf,
  collapseTo,
  eraOf,
  frameScene,
  headlineReserve,
  isFailing,
  isNext,
  isProven,
  type JointMark,
  jointMark,
  layoutNodes,
  mapFindings,
  NODE_R,
  ROW_H,
  rungOf,
  sceneSize,
  START_Y,
  stepSelection,
  visibleItems,
} from './civ/layout.ts';
import { GAINED_THIS_WEEK, LOST_THIS_WEEK, MapFinding } from './civ/MapFinding.tsx';
import { hasHistory } from './civ/history.ts';
import { ImageMenu, type ImageKind } from './civ/ImageMenu.tsx';
import { MapKey } from './civ/MapKey.tsx';
import { AUTHORITY_FILL, AUTHORITY_SYM, heatBins, MapScene } from './civ/MapScene.tsx';
import { HazardPattern, KeySwatch, type LegendKey } from './civ/marks.tsx';
import { Minimap, type MinimapNode } from './civ/Minimap.tsx';
import { SimulationBanner } from './civ/SimulationBanner.tsx';
import { usePinchZoom } from './civ/usePinchZoom.ts';
import { ZOOM_MIN } from './civ/viewport.ts';
import { ZoomHud } from './civ/ZoomHud.tsx';
import { termTitle } from './Term.tsx';
import { useBottomOcclusion, useNarrow } from '../hooks/useViewport';
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
  /** Told where the headline's bottom edge is, so a card laid over the map can sit below it. */
  onHeadline?: (bottom: number) => void;
  /** Save the map's finding as a card made to be posted, or the whole map as a file. */
  onSaveImage?: (kind: ImageKind) => void;
}

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
  onHeadline,
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
  // The headline is two rows when there is a finding under the range line.
  const headlined = Boolean(!narrated && !asOf && (findings.failing.length || findings.best));
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
  // Its height, measured, so the canvas starts below it however many lines its
  // rows wrap to. A fixed 40px reserved one line of each, and at 900px the
  // range line wraps and the finding sat on the era names, which are controls.
  // The last measure is kept while a panel hides the headline, so the map does
  // not move when a node is opened.
  const [headlineBox, setHeadlineBox] = useState<{ height: number; bottom: number } | null>(null);
  const measureHeadline = React.useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
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
  const headlinePad = headlineReserve(headlineBox ? headlineBox.bottom - 12 : null);
  useEffect(() => {
    if (headlineBox) onHeadline?.(headlineBox.bottom);
  }, [headlineBox, onHeadline]);
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
    Keystone: 'keystone',
    Combo: 'combo',
    'Tool server': 'tool-server',
    Agent: 'capability',
    Skill: 'capability',
    Passing: 'evidence',
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
    Blocked: i => i.status !== 'built' && !isNext(i),
    Server: i => i.type === 'mcp-server',
    Agent: i => i.type === 'agent',
    Skill: i => i.type === 'skill',
    Combo: i => i.type === 'possibility',
    Keystone: keystone,
    Passing: isProven,
    Failing: isFailing,
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
  // While a node is selected the legend also keys the two directions its
  // edges are drawn in.
  // Keyed only when the map has one: most machines declare no person and no
  // device, and a key for a mark nothing carries is a question with no answer.
  const jointKeys: LegendKey[] = (['person', 'device'] as JointMark[])
    .filter(m => filtered.some(i => jointMark(i) === m))
    .map(m => ({
      kind: 'joint',
      mark: m,
      label: m === 'person' ? 'Needs a person' : 'Runs on a device',
    }));
  const directionKeys: LegendKey[] =
    selectedId && focusId === selectedId
      ? [
          { kind: 'line', color: 'var(--edge-needs)', label: 'Needs' },
          { kind: 'line', color: 'var(--accent)', label: 'Enables' },
        ]
      : [];
  const legend: LegendKey[] =
    activeLens === 'authority'
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
              (b, i): LegendKey => ({ kind: 'node', color: `var(--heat-${i + 1})`, label: b.label })
            ),
          ]
        : isTreeView
          ? [
              { kind: 'node', color: 'var(--node-reached)', label: 'Reached' },
              { kind: 'ring', label: 'Next step' },
              { kind: 'faded', label: 'Blocked' },
              { kind: 'keystone', label: 'Keystone' },
              { kind: 'node', color: 'var(--ok)', sym: '✓', label: 'Passing' },
              { kind: 'node', color: 'var(--error)', sym: '!', label: 'Failing', hatch: true },
              { kind: 'line', label: 'Required' },
              { kind: 'line', dashed: true, label: 'Optional' },
              ...jointKeys,
              ...directionKeys,
            ]
          : [
              { kind: 'node', color: typeColor('mcp-server'), sym: '◈', label: 'Tool server' },
              { kind: 'node', color: typeColor('agent'), sym: '◆', label: 'Agent' },
              { kind: 'node', color: typeColor('skill'), sym: '◇', label: 'Skill' },
              { kind: 'node', color: typeColor('possibility'), sym: '●', label: 'Combo' },
              { kind: 'keystone', label: 'Keystone' },
              { kind: 'node', color: 'var(--ok)', sym: '✓', label: 'Passing' },
              { kind: 'node', color: 'var(--error)', sym: '!', label: 'Failing', hatch: true },
              { kind: 'line', label: 'Required' },
              { kind: 'line', dashed: true, label: 'Optional' },
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
  // explaining the map. A phone has no room under it.
  const strip: LegendKey[] =
    isTreeView &&
    activeLens === 'default' &&
    !keyOpen &&
    !narrated &&
    simulationMode === 'none' &&
    !narrow
      ? [
          { kind: 'node', color: 'var(--node-reached)', label: 'Reached' },
          { kind: 'ring', label: 'Next step' },
          { kind: 'faded', label: 'Blocked' },
          ...(findings.failing.length
            ? [
                {
                  kind: 'node',
                  color: 'var(--error)',
                  sym: '!',
                  label: 'Failing',
                  hatch: true,
                } satisfies LegendKey,
              ]
            : []),
        ]
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
        // nobody can see, so the walk skips them.
        const to = stepSelection(filtered, selectedId, key.by, collapse?.shown);
        if (to) onSelect(to);
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
    filtered,
    collapse,
    zoomTo,
  ]);

  // The bottom of the canvas a tour card or a bottom sheet is covering.
  const covered = useBottomOcclusion(containerRef);

  // Centre the node in view: the selection, or else where a simulation
  // started. On a wide screen the whole map is in view and this is a no-op; on
  // a phone the framing below does it instead, fitted around the cards.
  // A zoom made by hand centres nothing: it is anchored where it was asked
  // for, and centring the selection again pulled every step of a pinch back
  // to the node. Any other zoom, the fit on arrival included, centres it.
  const centreOn = selectedId ?? (simulationMode !== 'none' ? simulatedNodeId : null);
  const centred = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (narrow) return;
    if (centreOn && nodePositionMap.has(centreOn)) {
      if (centred.current === centreOn && zoom === handZoom.current) return;
      centred.current = centreOn;
      const pos = nodePositionMap.get(centreOn)!;
      if (containerRef.current) {
        const container = containerRef.current;
        const targetScrollLeft = pos.x * zoom - container.clientWidth / 2;
        const targetScrollTop = pos.y * zoom - container.clientHeight / 2;
        container.scrollTo({
          left: Math.max(0, targetScrollLeft),
          top: Math.max(0, targetScrollTop),
          behavior: 'smooth',
        });
      }
    } else {
      centred.current = null;
    }
  }, [narrow, centreOn, zoom, nodePositionMap, handZoom]);

  const { width: contentWidth, height: contentHeight } = sceneSize({ cols, colOrder });

  // Open with every column on screen. At 100% the seventh era sat past the
  // right edge with nothing to say it was there, and in the setup view every
  // edge to the runtime column ran off the canvas towards a node nobody could
  // see. Fits once per dataset, and again when the canvas changes width while
  // the zoom is still the one the fit chose: a window opened narrow and then
  // widened kept its narrow zoom, or the reverse, with Foundation or Launch
  // Ready off the edge. Once someone zooms, the zoom controls own it.
  const [boxWidth, setBoxWidth] = useState<number | null>(null);
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
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
    const available = width - leftInset - 16;
    if (available <= 0) return;
    fittedFor.current = contentWidth;
    // A phone fits the whole tree at about 0.3, where a node's name is four
    // pixels tall. There the map opens at a scale its names can be read at,
    // two columns or so across, and scrolls sideways; Fit still shows it all.
    const floor = width < 700 ? 0.72 : ZOOM_MIN;
    const fit = Math.max(floor, Math.min(1, +(available / contentWidth).toFixed(2)));
    fittedAt.current = { width, zoom: fit };
    setZoom(fit);
  }, [contentWidth, leftInset, boxWidth, zoom]);

  // On a wider screen the panel sits over the map's right edge, which is
  // where the Product and Operations eras are, so a route to Launch Ready was
  // numbered entirely under it. When a simulation lights a node that is off
  // screen or under the panel, bring the lit part into the rest of the canvas,
  // zooming out if it has to and never in. What is already in view stays put.
  const framedWide = React.useRef('');
  React.useEffect(() => {
    const el = containerRef.current;
    if (narrow || !el || simulationMode === 'none') {
      framedWide.current = '';
      return;
    }
    const key = `${simulationMode}:${simulatedNodeId}`;
    if (framedWide.current === key) return;
    framedWide.current = key;
    const points = [...simSet].flatMap(id => nodePositionMap.get(id) ?? []);
    const hud = 88;
    const right = el.scrollLeft + el.clientWidth - rightInset;
    // While the tour narrates, its card covers the map's lower right, and a
    // lit node under it is as hidden as one off screen: the outage's last eras
    // ran on under the card that was describing them. Measured in the
    // scroller's own viewport.
    const box = el.getBoundingClientRect();
    const tour = narrated ? document.querySelector('.app-tour')?.getBoundingClientRect() : null;
    const card = tour ? { left: tour.left - box.left, top: tour.top - box.top } : null;
    const inView = points.every(p => {
      const x = p.x * zoom + leftInset;
      const y = p.y * zoom;
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
    if (inView) return;
    const open = {
      top: hud,
      width: el.clientWidth - leftInset - rightInset,
      height: el.clientHeight - hud,
    };
    const zoomRange = { min: ZOOM_MIN, max: zoom, inset: leftInset };
    // With a card, the lit part goes beside it or above it, whichever leaves
    // the larger map.
    const frame = card
      ? [
          frameScene(points, { ...open, width: card.left - leftInset - 16 }, zoomRange),
          frameScene(points, { ...open, height: card.top - hud - 8 }, zoomRange),
        ].reduce<ReturnType<typeof frameScene>>(
          (best, f) => (f && (!best || f.zoom > best.zoom) ? f : best),
          null
        )
      : frameScene(points, open, zoomRange);
    if (!frame) return;
    if (frame.zoom !== zoom) setZoom(frame.zoom);
    requestAnimationFrame(() =>
      el.scrollTo({ left: frame.left, top: frame.top, behavior: 'smooth' })
    );
  }, [
    narrow,
    narrated,
    simulationMode,
    simulatedNodeId,
    simSet,
    nodePositionMap,
    leftInset,
    rightInset,
    zoom,
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
    // The zoom and lens controls, and the map's tools on a row of their own,
    // sit over the canvas's first 88px, except in the tour, which hides them
    // on a phone.
    const hud = narrated ? 8 : 88;
    const frame = frameScene(
      points,
      { top: hud, width: el.clientWidth - leftInset, height: el.clientHeight - hud - covered },
      { min: 0.7, max: 1.1, inset: leftInset }
    );
    if (!frame) return;
    setZoom(frame.zoom);
    // After the zoom lands, so the offsets are measured against the new size.
    requestAnimationFrame(() =>
      el.scrollTo({ left: frame.left, top: frame.top, behavior: 'smooth' })
    );
  }, [
    narrow,
    narrated,
    simulationMode,
    simulatedNodeId,
    simSet,
    selectedId,
    needs,
    enables,
    covered,
    nodePositionMap,
    leftInset,
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
            ? 'History keeps what was reached and what its checks said, not who stepped in or what may act. Return to today to use this view.'
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
                title="The frontier through time: scrub the map back to an earlier observation"
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
                title="Save an image: the map's finding sized for posting, or the whole map"
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
            // and on a wide screen out from under the tour's card (380px and
            // its 16px margin): at 800px the lit eras had nowhere to scroll to.
            paddingRight: rightInset + (narrated && !narrow ? 396 : 0),
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
          }}
        >
          <title>Capability tree: what this setup can do, by era</title>
          <defs>
            <HazardPattern id={hazardId} />
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

              const W = 236;
              const headH = 22;
              const keyH = isKey ? 18 : 0;
              const descH = lines.length * 15;
              const enablesH = enables.length ? 20 + enables.length * 15 : 0;
              // The simulations are the thing people do not find, and a faded
              // circle reads as scenery until something says otherwise. A click
              // opens the panel that offers the one this node can run: an outage
              // on a node you have, an unlock on one you do not.
              const hint = asOf
                ? 'Click: details, as of this observation'
                : unreached
                  ? 'Click: details, and simulate unlocking it'
                  : 'Click: details, and simulate an outage';
              const hintH = 17;
              const boxH = headH + keyH + descH + enablesH + hintH + 12;

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
                  {isKey && (
                    <text
                      x={12}
                      y={headH + 12}
                      fill="var(--warn)"
                      fontSize={11}
                      fontWeight={600}
                      fontFamily="var(--font-sans)"
                    >
                      ★ Keystone ({downCount} enables)
                    </text>
                  )}
                  {lines.map((line, i) => (
                    <text
                      key={i}
                      x={12}
                      y={headH + keyH + 12 + i * 15}
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
                      y={headH + keyH + descH + 15}
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
                        y={headH + keyH + descH + 30 + i * 15}
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
        <div className="civ-source" style={{ bottom: covered + 10, left: leftInset + 8 }}>
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
          role="toolbar"
          aria-label="What the circles mean"
          style={{ bottom: covered + 10, left: leftInset + 8 }}
        >
          {strip.map(entry => {
            const on = spotlight === entry.label;
            return (
              <button
                key={entry.label}
                type="button"
                className={`civ-strip-key${on ? ' is-on' : ''}`}
                aria-pressed={on}
                onClick={() => setSpotlight(on ? null : entry.label)}
                title={termTitle(LEGEND_CONCEPTS[entry.label] ?? '')}
              >
                <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">
                  <KeySwatch entry={entry} hazard={hazard} />
                </svg>
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
        />
      )}
    </div>
  );
}
