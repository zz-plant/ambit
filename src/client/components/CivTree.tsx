import React, { useEffect, useId, useMemo, useState } from 'react';
import type { Item, Connection } from '../utils/configImporter';
import { useAmbitStore } from '../store/ambitStore';
import { mapKey, typingIn } from '../utils/keys';
import { isRuntimeNode } from '../utils/labels';
import { typeColor, typeSymbol } from '../utils/typeColors';
import {
  AUTHORITY_LABEL,
  type AuthorityMark,
  authorityMark,
  bandOf,
  buildAdjacency,
  buildColumns,
  cascadeDepths,
  COL_W,
  columnCentre,
  columnLabel,
  columnOf,
  collapseTo,
  columnProgress,
  costOf,
  edgePath,
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
  type Progress,
  readableSeconds,
  ROW_H,
  rungOf,
  sceneSize,
  START_X,
  START_Y,
  stepSelection,
  visibleItems,
  wrapLabel,
} from './civ/layout.ts';
import { GAINED_THIS_WEEK, LOST_THIS_WEEK, MapFinding } from './civ/MapFinding.tsx';
import { hasHistory } from './civ/history.ts';
import { MapKey } from './civ/MapKey.tsx';
import { Brackets, HazardPattern, JointIcon, type LegendKey } from './civ/marks.tsx';
import { Minimap, type MinimapNode } from './civ/Minimap.tsx';
import { SimulationBanner } from './civ/SimulationBanner.tsx';
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
  /** Save what the map shows as an image made to be posted. */
  onSaveImage?: () => void;
}

/**
 * The attention lens is a magnitude, so it gets one hue in four steps rather
 * than two colours either side of a number nobody wrote down.
 *
 * The bins come from the data — a quarter of the observed maximum each — so
 * the ramp always spans the range actually present, and the legend can print
 * the boundaries instead of asking the reader to guess what "warm" means.
 */
function heatBins(max: number): { from: number; to: number; label: string }[] {
  const top = Math.max(max, 4);
  const width = Math.ceil(top / 4);
  return [0, 1, 2, 3].map(i => {
    const from = i * width + 1;
    const to = i === 3 ? top : (i + 1) * width;
    return { from, to, label: i === 3 ? `${from}+` : `${from}–${to}` };
  });
}

/** Which of the four steps a count falls in, 1-based; 0 means no interventions. */
function heatStep(count: number, max: number): number {
  if (count <= 0) return 0;
  const bins = heatBins(max);
  const hit = bins.findIndex(b => count <= b.to);
  return hit === -1 ? bins.length : hit + 1;
}

/**
 * The authority lens: one hue per mode and a glyph in the centre, so a reader
 * who cannot tell amber from green still reads the mode. No grant yet is
 * drawn as an outline, since nothing has been decided about it.
 */
const AUTHORITY_FILL: Record<AuthorityMark, string> = {
  autonomous: 'var(--ok)',
  confirm: 'var(--warn)',
  forbidden: 'var(--error)',
  ungranted: 'var(--bg-canvas)',
};
const AUTHORITY_SYM: Record<AuthorityMark, string> = {
  autonomous: '▶',
  confirm: '?',
  forbidden: '×',
  ungranted: '–',
};

/**
 * The count under a column's name, drawn as well as written. A column is a
 * set with a size and a filled fraction; saying "Era 5" where "1 of 5" could
 * stand was a label where a measurement belonged. One scale across all seven
 * columns: the bar's full width is the largest era, so a short bar is a small
 * era and not a poorly-filled one. Beside the count, what finishing the
 * column would cost in setup time.
 *
 * Reached leaves out a node whose check failed, which is configured and not
 * working, so the count agrees with the rungs of the era's ladder. That node
 * is a red segment of the bar, between what is reached and what is next.
 */
function ColumnCount({
  column,
  progress,
  largest,
  x,
}: {
  column: string;
  progress: Progress;
  largest: number;
  x: number;
}) {
  const { reached, failing, next, total } = progress;
  const left = readableSeconds(progress.seconds);
  const barW = ((COL_W - 64) * total) / largest;
  const unit = total ? barW / total : 0;
  const bx = x + COL_W / 2 - 16 - barW / 2;
  const by = START_Y - 11;
  return (
    <g>
      <text
        x={x + COL_W / 2 - 16}
        y={START_Y - 16}
        textAnchor="middle"
        fill="var(--text-muted)"
        fontSize={11}
        fontWeight={500}
        style={{ fontFamily: 'var(--font-sans)', fontVariantNumeric: 'tabular-nums' }}
      >
        {/* The count alone under the name. The era's number and what is left
            to set up are the ladder's to say, and on hover here: seven
            columns of "Era 2 · 3 of 6 · 35m left" at 10px were a row of
            fine print over the map. */}
        <title>{`${column.startsWith('era:') ? `Era ${column.slice(4)}: ` : ''}${reached} of ${total} reached${left ? `, about ${left} of setup left` : ''}`}</title>
        {reached} of {total}
      </text>
      <rect className="fig-eras-track" x={bx} y={by} width={barW} height={3} rx={1} />
      {reached > 0 && (
        <rect className="fig-eras-reached" x={bx} y={by} width={unit * reached} height={3} rx={1} />
      )}
      {failing > 0 && (
        <rect
          className="fig-eras-failing"
          x={bx + unit * reached}
          y={by}
          width={unit * failing}
          height={3}
          rx={1}
        />
      )}
      {next > 0 && (
        <rect
          className="fig-eras-next"
          x={bx + unit * (reached + failing)}
          y={by}
          width={unit * next}
          height={3}
          rx={1}
        />
      )}
    </g>
  );
}

/**
 * A column's header: its name and count. On the tree it is also a control,
 * since an era has a ladder to open and a domain has nothing behind its name.
 * No hooks, so the wiring can be tested by calling it.
 */
export function ColumnHead({
  column,
  index,
  label,
  progress,
  largest,
  term,
  openEra,
  onOpen,
}: {
  /** `era:3`, or a domain. */
  column: string;
  index: number;
  label: string;
  progress: Progress;
  largest: number;
  /** The glossary entry the hover tooltip defines: an era on the tree, a domain elsewhere. */
  term: 'era' | 'domain';
  /** The era whose ladder is open, if any. */
  openEra: number | null;
  onOpen: (era: number) => void;
}) {
  const x = START_X + index * COL_W;
  const era = column.startsWith('era:') ? Number(column.slice(4)) : undefined;
  const head = (
    <>
      <text
        className="civ-era-name"
        x={columnCentre(index)}
        y={START_Y - 27}
        textAnchor="middle"
        fill="var(--text-primary)"
        fontSize={13}
        fontWeight={600}
        style={{ fontFamily: 'var(--font-sans)' }}
      >
        <title>{termTitle(term)}</title>
        {label}
      </text>
      <ColumnCount column={column} progress={progress} largest={largest} x={x} />
    </>
  );
  if (era === undefined) return head;

  const open = () => onOpen(era);
  const pressed = openEra === era;
  const who = label === `Era ${era}` ? label : `${label}, era ${era}`;
  const facts = `${progress.reached} of ${progress.total} reached${
    progress.failing ? `, ${progress.failing} failing` : ''
  }`;
  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG element groups cannot be HTML buttons
    <g
      role="button"
      tabIndex={0}
      className={`civ-era-head${pressed ? ' civ-era-head--open' : ''}`}
      aria-pressed={pressed}
      aria-label={`${who}: ${facts}. Show its ladder`}
      onClick={open}
      onKeyDown={e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        open();
      }}
    >
      <rect {...bandOf(index, 0)} height={42} fill="transparent" />
      {head}
    </g>
  );
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
  // Everything a simulation touches, so an edge is lit when both ends are.
  const simSet = useMemo(
    () =>
      new Set([
        ...(simulatedNodeId ? [simulatedNodeId] : []),
        ...simulatedCascadeIds,
        ...simulatedWeakenedIds,
      ]),
    [simulatedNodeId, simulatedCascadeIds, simulatedWeakenedIds]
  );
  // How far each simulated node is from where the simulation started, so the
  // cascade can be drawn spreading outward, one hop after another.
  const simDepth = useMemo(
    () =>
      simulatedNodeId
        ? cascadeDepths(connections, simulatedNodeId, simSet)
        : new Map<string, number>(),
    [connections, simulatedNodeId, simSet]
  );
  /** The stagger for a node the simulation reaches: the hop count, as a CSS variable. */
  const hopStyle = (id: string): React.CSSProperties | undefined => {
    const hop = simDepth.get(id);
    return hop === undefined ? undefined : ({ '--hop': hop } as React.CSSProperties);
  };
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
  const findings = useMemo(() => mapFindings(items, connections), [items, connections]);
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
  const findingTarget = findingShown
    ? findings.failing[0]
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
  const headlinePad = headlineReserve(headlineBox?.height ?? null);
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
  const largestColumn = Math.max(...colOrder.map(c => (cols[c] || []).length), 1);

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
  const lifecycleOf = (item: Item) => (item.meta?.lifecycle as string | undefined) ?? '';
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
    Unproven: i => i.status === 'built' && !isProven(i) && !isFailing(i),
    'Next step': i => i.status !== 'built' && isNext(i),
    Blocked: i => i.status !== 'built' && !isNext(i),
    Server: i => i.type === 'mcp-server',
    Agent: i => i.type === 'agent',
    Skill: i => i.type === 'skill',
    Combo: i => i.type === 'possibility',
    Keystone: keystone,
    Passing: i => ['verified', 'reliable'].includes(lifecycleOf(i)),
    Failing: i => ['degraded', 'broken'].includes(lifecycleOf(i)),
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
              { kind: 'square', label: 'Keystone' },
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
              { kind: 'square', label: 'Keystone' },
              { kind: 'node', color: 'var(--ok)', sym: '✓', label: 'Passing' },
              { kind: 'node', color: 'var(--error)', sym: '!', label: 'Failing', hatch: true },
              { kind: 'line', label: 'Required' },
              { kind: 'line', dashed: true, label: 'Optional' },
              ...directionKeys,
            ];
  // A lens paints with a scale the standard map does not use, so switching to
  // one opens the key until someone closes it; the standard map's key waits
  // to be asked for.
  const [keyToggled, setKeyToggled] = useState<boolean | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new lens is what resets the choice
  useEffect(() => setKeyToggled(null), [activeLens]);
  const keyOpen = keyToggled ?? activeLens !== 'default';
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
        if (key.to === 'actual') setZoom(1);
        else if (key.to === 'in') setZoom(z => Math.min(2.5, +(z + 0.15).toFixed(2)));
        else setZoom(z => Math.max(0.4, +(z - 0.15).toFixed(2)));
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
  ]);

  const narrow = useNarrow();
  // The bottom of the canvas a tour card or a bottom sheet is covering.
  const covered = useBottomOcclusion(containerRef);

  // Centre the node in view: the selection, or else where a simulation
  // started. On a wide screen the whole map is in view and this is a no-op; on
  // a phone the framing below does it instead, fitted around the cards.
  const centreOn = selectedId ?? (simulationMode !== 'none' ? simulatedNodeId : null);
  React.useEffect(() => {
    if (narrow) return;
    if (centreOn && nodePositionMap.has(centreOn)) {
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
    }
  }, [narrow, centreOn, zoom, nodePositionMap]);

  const { width: contentWidth, height: contentHeight } = sceneSize({ cols, colOrder });

  // Open with every column on screen. At 100% the seventh era sat past the
  // right edge with nothing to say it was there, and in the setup view every
  // edge to the runtime column ran off the canvas towards a node nobody could
  // see. Fits once per dataset; the zoom controls own it after that.
  const fittedFor = React.useRef<number | null>(null);
  React.useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || fittedFor.current === contentWidth) return;
    fittedFor.current = contentWidth;
    const available = el.clientWidth - leftInset - 16;
    if (available <= 0) return;
    // A phone fits the whole tree at about 0.3, where a node's name is four
    // pixels tall. There the map opens at a scale its names can be read at,
    // two columns or so across, and scrolls sideways; Fit still shows it all.
    const floor = el.clientWidth < 700 ? 0.72 : 0.4;
    setZoom(Math.max(floor, Math.min(1, +(available / contentWidth).toFixed(2))));
  }, [contentWidth, leftInset]);

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

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(z => Math.max(0.4, Math.min(2.5, +(z + delta).toFixed(2))));
    }
  };

  // The controls sit over the scroller, not inside it. Inside, they were
  // sticky, which holds vertically and, with a left inset, horizontally too;
  // but Chrome measures that inset from the scroller's padding edge and other
  // engines from its border edge, so centring a node pushed the zoom controls
  // 340px to the right in one and under the capability list in the other.
  return (
    <div className="civ-tree">
      <ZoomHud
        zoom={zoom}
        setZoom={setZoom}
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
            ? 'An observation of the frontier records states and checks, not attention or authority. Back to now to use this lens.'
            : undefined
        }
        tools={
          <>
            <button
              type="button"
              className={`civ-zoom-btn${keyOpen ? ' is-on' : ''}`}
              aria-expanded={keyOpen}
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
                className="civ-zoom-btn"
                onClick={onSaveImage}
                title="Save what the map shows as an image sized for posting"
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
          keyOpen && (
            <MapKey
              keys={legend}
              spotlight={spotlight}
              lights={label => Boolean(SPOTLIGHTS[label])}
              onSpotlight={setSpotlight}
              concepts={LEGEND_CONCEPTS}
              hazard={hazard}
            />
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
        onWheel={handleWheel}
        style={
          {
            paddingLeft: leftInset,
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
          {/* Era column bands with clean headers */}
          {colOrder.map((d, i) => {
            const list = cols[d] || [];
            return (
              <g key={`band-${d}`}>
                <rect {...bandOf(i, contentHeight)} fill="var(--band)" rx={12} />
                <ColumnHead
                  column={d}
                  index={i}
                  label={columnLabel(d, list)}
                  progress={columnProgress(list)}
                  largest={largestColumn}
                  term={isTreeView ? 'era' : 'domain'}
                  openEra={selectedEra}
                  onOpen={selectEra}
                />
              </g>
            );
          })}

          {/* Edges, behind the nodes. Curved, so a bundle into one node fans
              instead of converging through everything between. Into the focus
              in one colour, out of it in another. */}
          {connections.map((conn, i) => {
            const fromPos = nodePositionMap.get(conn.from);
            const toPos = nodePositionMap.get(conn.to);
            if (!fromPos || !toPos || !shown(conn.from) || !shown(conn.to)) return null;
            const isHard = conn.type === 'hard-dep';
            const isSoft = conn.type === 'soft-dep';
            const isSimLine =
              simulationMode !== 'none' && simSet.has(conn.from) && simSet.has(conn.to);
            const intoFocus = focusId !== null && conn.to === focusId;
            const outOfFocus = focusId !== null && conn.from === focusId;
            // At rest, an edge across more than two eras is a whisper. Eight
            // of the demo's 43 crossed six columns and were most of what read
            // as a tangle; which node needs which is one hover away, and the
            // short edges between neighbours carry the shape of the tree.
            const long = Math.abs(toPos.x - fromPos.x) > COL_W * 2.5;
            const op = isSimLine
              ? 1
              : simulationMode !== 'none'
                ? 0.08
                : focusId
                  ? intoFocus || outOfFocus
                    ? 0.95
                    : collapse
                      ? // What the collapse kept is what to read, so its other
                        // edges stay drawn and the focus's own stand out from them.
                        isHard
                        ? 0.4
                        : 0.3
                      : 0.06
                  : long
                    ? 0.07
                    : isHard
                      ? 0.3
                      : 0.22;
            const strokeColor = isSimLine
              ? simulationMode === 'outage'
                ? 'var(--error)'
                : simulationMode === 'gap'
                  ? 'var(--warn)'
                  : 'var(--ok)'
              : intoFocus
                ? 'var(--edge-needs)'
                : outOfFocus
                  ? 'var(--accent)'
                  : isHard || isSoft
                    ? 'var(--text-muted)'
                    : 'var(--warn)';

            return (
              <path
                key={`c-${i}`}
                className={isSimLine ? 'civ-sim-edge' : undefined}
                style={isSimLine ? hopStyle(conn.to) : undefined}
                d={edgePath(fromPos.x, fromPos.y, toPos.x, toPos.y)}
                fill="none"
                stroke={strokeColor}
                strokeWidth={isSimLine ? 2.5 : intoFocus || outOfFocus ? 2 : isHard ? 1.25 : 1}
                strokeDasharray={isHard ? 'none' : isSoft ? '4,4' : '3,3'}
                strokeLinecap="round"
                opacity={op}
              />
            );
          })}

          {/* Nodes */}
          {colOrder.map((domain, ci) => {
            const caps = cols[domain] || [];
            const cx = columnCentre(ci);
            return (
              <g key={domain}>
                {caps.map((item, ri) => {
                  // Skipped, and not filtered out: the row index is the node's place.
                  if (!shown(item.id)) return null;
                  const cy = START_Y + ri * ROW_H + NODE_R;
                  const defaultColor = typeColor(item.type);
                  const selected = item.id === selectedId;
                  const isFocus = item.id === focusId;
                  const inNeeds = needs.has(item.id);
                  const inEnables = enables.has(item.id);
                  const nearFocus = isFocus || inNeeds || inEnables;

                  const isSimRoot = simulationMode !== 'none' && simulatedNodeId === item.id;
                  const isSimWeak = simulationMode !== 'none' && simulatedWeakenedIds.has(item.id);
                  const isSimAffected =
                    simulationMode !== 'none' && (simulatedCascadeIds.has(item.id) || isSimWeak);
                  const isSimDimmed = simulationMode !== 'none' && !isSimRoot && !isSimAffected;

                  const interventionCount = attentionInterventions[item.id] || 0;
                  const isAttentionHot = activeLens === 'attention' && interventionCount > 0;
                  const heat = heatStep(interventionCount, attentionMax);

                  const mark = activeLens === 'authority' ? authorityMark(item) : undefined;
                  const isAuthorityLens = activeLens === 'authority';

                  const isKeystone = keystone(item);

                  const next = isNext(item);
                  const reached = item.status === 'built';

                  const isSpotlit = !spotlight || (SPOTLIGHTS[spotlight]?.(item) ?? true);

                  const dimmed =
                    (focusId !== null && !collapse && !nearFocus) ||
                    isSimDimmed ||
                    !isSpotlit ||
                    (isAuthorityLens && simulationMode === 'none' && !mark);
                  // Blocked is not faded: the dashed ring and the muted label say
                  // it, and a node drawn at three quarters with a grey label on
                  // top came out near 3:1, too faint to read the name.
                  const baseOpacity =
                    isSimRoot || isSimAffected ? 1 : !isSpotlit ? 0.15 : dimmed ? 0.25 : 1;
                  const failingNode = reached && ['degraded', 'broken'].includes(lifecycleOf(item));

                  // Reached is done, so it is the quietest filled state; a next
                  // step is the recommendation, so it is the loudest ring on the
                  // map; blocked is drawn as a gap, dashed and legible, and not
                  // faded to where it could not be read.
                  // A node of the tree is drawn in the state's colours; any other
                  // kind keeps its type's colour, since a list of kinds is what
                  // that map is for.
                  const treeNode = item.type === 'possibility';
                  let nodeFill = reached
                    ? treeNode
                      ? 'var(--node-reached)'
                      : defaultColor
                    : 'var(--bg-canvas)';
                  if (failingNode) nodeFill = hazard;
                  // Failing outranks selection and focus: the ring outside the
                  // node already says it is selected, and a broken node drawn in
                  // the selection's colour read as working in the one step that
                  // was about it being broken.
                  let sc = failingNode
                    ? 'var(--error)'
                    : selected
                      ? 'var(--text-primary)'
                      : inNeeds
                        ? 'var(--edge-needs)'
                        : inEnables
                          ? 'var(--accent)'
                          : next
                            ? 'var(--accent)'
                            : reached
                              ? treeNode
                                ? 'var(--node-reached-ring)'
                                : defaultColor
                              : 'var(--text-muted)';
                  let sw =
                    selected || inNeeds || inEnables || failingNode
                      ? 2.25
                      : next
                        ? 2.25
                        : reached
                          ? 1.5
                          : 1.25;

                  if (simulationMode === 'outage') {
                    if (isSimRoot) {
                      nodeFill = 'var(--error)';
                      sc = 'var(--text-primary)';
                      sw = 2.5;
                    } else if (isSimAffected) {
                      // Red for what stops; amber for what keeps another
                      // provider and only loses one. It was all red.
                      nodeFill = isSimWeak ? 'var(--warn)' : 'var(--error-deep)';
                      sc = 'var(--on-accent)';
                      sw = 2;
                    }
                  } else if (simulationMode === 'gap') {
                    if (isSimRoot) {
                      nodeFill = 'var(--accent)';
                      sc = 'var(--text-primary)';
                      sw = 2.5;
                    } else if (isSimAffected) {
                      nodeFill = 'var(--warn)';
                      sc = 'var(--on-accent)';
                      sw = 2;
                    }
                  } else if (simulationMode === 'acquisition') {
                    if (isSimRoot) {
                      nodeFill = 'var(--accent)';
                      sc = 'var(--text-primary)';
                      sw = 2.5;
                    } else if (isSimAffected) {
                      nodeFill = 'var(--ok)';
                      sc = 'var(--on-accent)';
                      sw = 2;
                    }
                  } else if (mark) {
                    // Four categories, so four hues, each with its own glyph
                    // in the centre: the lens must read without colour.
                    nodeFill = mark === 'forbidden' ? hazard : AUTHORITY_FILL[mark];
                    sc = mark === 'ungranted' ? 'var(--text-muted)' : 'var(--on-accent)';
                    sw = 2;
                  } else if (isAttentionHot) {
                    // One hue, four steps, brighter with more — a quantity read
                    // as a quantity. It used to be two colours split at twenty:
                    // red above, amber below, a threshold nothing stated and a
                    // second hue that made a magnitude look like a category.
                    nodeFill = `var(--heat-${heat})`;
                    sc = 'var(--on-accent)';
                    sw = 2;
                  }

                  const sym = mark
                    ? AUTHORITY_SYM[mark]
                    : item.type === 'possibility'
                      ? ''
                      : typeSymbol(item.type);
                  const lines = wrapLabel(item.name);

                  return (
                    // biome-ignore lint/a11y/useSemanticElements: SVG element groups cannot be HTML buttons
                    <g
                      key={item.id}
                      transform={`translate(${cx}, ${cy})`}
                      opacity={baseOpacity}
                      className={
                        isSimRoot || isSimAffected
                          ? 'civ-sim-hit'
                          : dimmed && isSpotlit
                            ? 'civ-node--dim'
                            : undefined
                      }
                      tabIndex={0}
                      role="button"
                      aria-pressed={selected}
                      aria-label={`${item.name}, ${item.type}`}
                      data-node={item.id}
                      onClick={() => onSelect(selected ? null : item.id)}
                      onKeyDown={e => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        onSelect(selected ? null : item.id);
                      }}
                      onFocus={() => {
                        onHover?.(item.id);
                        setHoverItem(item.id);
                      }}
                      onBlur={() => {
                        onHover?.(null);
                        setHoverItem(null);
                      }}
                      onMouseEnter={() => {
                        onHover?.(item.id);
                        setHoverItem(item.id);
                      }}
                      onMouseLeave={() => {
                        onHover?.(null);
                        setHoverItem(null);
                      }}
                      style={{
                        cursor: 'pointer',
                        transition: 'opacity .15s',
                        ...hopStyle(item.id),
                      }}
                    >
                      {(isSimRoot || isSimAffected) && (
                        <circle
                          // Remounted per simulation, so each one replays its ripple.
                          key={`${simulationMode}:${simulatedNodeId}`}
                          className="civ-sim-ripple"
                          r={NODE_R}
                          fill="none"
                          stroke={
                            simulationMode === 'outage'
                              ? 'var(--error)'
                              : simulationMode === 'gap'
                                ? 'var(--warn)'
                                : 'var(--ok)'
                          }
                          strokeWidth={2}
                        />
                      )}
                      {/* Quiet until asked for. Five amber squares were the loudest
                          marks on the map, louder than the one failing node, for
                          a structural fact nobody acts on first. The legend's
                          Keystone key, or selecting the node, draws it in full. */}
                      {isKeystone && !dimmed && (
                        <rect
                          x={-NODE_R - 6}
                          y={-NODE_R - 6}
                          width={(NODE_R + 6) * 2}
                          height={(NODE_R + 6) * 2}
                          rx={9}
                          fill="none"
                          stroke="var(--warn)"
                          strokeOpacity={spotlight === 'Keystone' || selected ? 0.75 : 0.25}
                          strokeWidth={1.25}
                          strokeDasharray="4,3"
                        />
                      )}

                      {selected ? (
                        <Brackets r={NODE_R} color="var(--accent)" />
                      ) : (
                        findingTarget?.id === item.id &&
                        !dimmed && <Brackets r={NODE_R} color={findingTarget.color} />
                      )}

                      {/* A next step is the outlined circle the legend draws, with
                        its setup cost beside it. It used to carry a second ring
                        outside that one and an amber "Boost" tag that no legend,
                        glossary or document explained. */}
                      {next && !dimmed && !isSimAffected && costOf(item) && (
                        <text
                          x={NODE_R + 6}
                          y={-NODE_R + 4}
                          textAnchor="start"
                          fill="var(--accent)"
                          fontSize={12}
                          fontWeight={600}
                          fontFamily="var(--font-sans)"
                        >
                          {costOf(item)}
                        </text>
                      )}

                      <circle
                        r={NODE_R}
                        fill={nodeFill}
                        fillOpacity={
                          reached &&
                          !treeNode &&
                          simulationMode === 'none' &&
                          !isAttentionHot &&
                          !mark &&
                          !selected &&
                          !failingNode
                            ? 0.6
                            : 1
                        }
                        stroke={sc}
                        strokeWidth={sw}
                        strokeDasharray={
                          !reached && !next && simulationMode === 'none' && !isAttentionHot
                            ? '5,4'
                            : undefined
                        }
                      />
                      {sym && (
                        <text
                          y={4.5}
                          textAnchor="middle"
                          fill={
                            mark === 'ungranted'
                              ? 'var(--text-muted)'
                              : nodeFill === hazard
                                ? 'var(--text-primary)'
                                : mark || reached
                                  ? 'var(--on-accent)'
                                  : 'var(--text-muted)'
                          }
                          fontSize={13}
                          fontWeight={700}
                        >
                          {sym}
                        </text>
                      )}

                      {reached &&
                        !dimmed &&
                        ['verified', 'reliable'].includes(item.meta?.lifecycle as string) && (
                          <g transform={`translate(${NODE_R - 4}, ${-NODE_R + 4})`}>
                            <circle
                              r={6.5}
                              fill="var(--ok)"
                              stroke="var(--bg-canvas)"
                              strokeWidth={2}
                            />
                            <text
                              y={3}
                              textAnchor="middle"
                              fill="var(--on-accent)"
                              fontSize={9}
                              fontWeight={700}
                            >
                              ✓
                            </text>
                          </g>
                        )}
                      {reached &&
                        !dimmed &&
                        ['degraded', 'broken'].includes(item.meta?.lifecycle as string) && (
                          <g transform={`translate(${NODE_R - 4}, ${-NODE_R + 4})`}>
                            <circle
                              r={6.5}
                              fill="var(--error)"
                              stroke="var(--bg-canvas)"
                              strokeWidth={2}
                            />
                            <text
                              y={3}
                              textAnchor="middle"
                              fill="var(--on-accent)"
                              fontSize={9}
                              fontWeight={700}
                            >
                              !
                            </text>
                          </g>
                        )}
                      {!dimmed && jointMark(item) && (
                        <g transform={`translate(${-NODE_R + 3}, ${NODE_R - 3})`}>
                          <title>
                            {jointMark(item) === 'person'
                              ? `Needs a person: ${((item.meta?.people as string[]) ?? []).join(', ')}`
                              : `Runs on a device: ${((item.meta?.devices as string[]) ?? []).join(', ')}`}
                          </title>
                          <JointIcon mark={jointMark(item)!} />
                        </g>
                      )}
                      {/* Two lines where the name needs them. A trailing space
                          on the first keeps the element's text the whole name,
                          which the recorder matches against the aria-label. */}
                      <text
                        y={NODE_R + 17}
                        textAnchor="middle"
                        className="civ-node-label"
                        fill={
                          dimmed || (!reached && !next && !isSimAffected && !isSimRoot)
                            ? 'var(--text-muted)'
                            : 'var(--text-primary)'
                        }
                        fontSize={12}
                        fontWeight={reached || next ? 500 : 400}
                        fontFamily="var(--font-sans)"
                      >
                        {lines.map((line, li) => (
                          <tspan key={line} x={0} dy={li === 0 ? 0 : 14}>
                            {li < lines.length - 1 ? `${line} ` : line}
                          </tspan>
                        ))}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}

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

              const tx = columnCentre(di) + NODE_R + 10;
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
