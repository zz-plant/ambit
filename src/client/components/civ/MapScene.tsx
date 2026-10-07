/**
 * What the map draws: the era bands and their heads, the edges, and the nodes
 * with their marks.
 *
 * CivTree draws it on the page, under a selection, a focus, a spotlight and a
 * lens. A saved file draws it as a still: every node and edge, at rest, with
 * no control, tooltip or stylesheet in it. One renderer for both, so the file
 * is the map and not a second drawing of it that drifts.
 */
import type React from 'react';
import { useMemo } from 'react';
import type { ActiveLens } from '../../linkState';
import type { Connection, Item } from '../../utils/configImporter';
import { isRuntimeNode } from '../../utils/labels';
import type { Showing } from '../../utils/shareCard';
import { typeColor, typeSymbol } from '../../utils/typeColors';
import { termTitle } from '../Term.tsx';
import {
  type AuthorityMark,
  authorityMark,
  bandOf,
  buildAdjacency,
  buildColumns,
  type Columns,
  cascadeDepths,
  COL_W,
  columnCentre,
  columnLabel,
  columnProgress,
  costOf,
  edgePath,
  isFailing,
  isNext,
  isProven,
  jointMark,
  layoutNodes,
  NODE_R,
  outageImpact,
  type Placed,
  type Progress,
  readableSeconds,
  ROW_H,
  routeTo,
  START_X,
  START_Y,
  sceneSize,
  visibleItems,
  wrapLabel,
} from './layout.ts';
import { Brackets, CAPS, Callout, HazardPattern, JointIcon, KeystoneMark } from './marks.tsx';

/**
 * The attention lens is a magnitude, so it gets one hue in four steps rather
 * than two colours either side of a number nobody wrote down.
 *
 * The bins come from the data — a quarter of the observed maximum each — so
 * the ramp always spans the range actually present, and the legend can print
 * the boundaries instead of asking the reader to guess what "warm" means.
 */
export function heatBins(max: number): { from: number; to: number; label: string }[] {
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
export const AUTHORITY_FILL: Record<AuthorityMark, string> = {
  autonomous: 'var(--ok)',
  confirm: 'var(--warn)',
  forbidden: 'var(--error)',
  ungranted: 'var(--bg-canvas)',
};
export const AUTHORITY_SYM: Record<AuthorityMark, string> = {
  autonomous: '▶',
  confirm: '?',
  forbidden: '×',
  ungranted: '–',
};

/**
 * The `.fig-eras-*` rules in App.css, as attributes, for a still: a saved file
 * carries no stylesheet. The map has no `--fig-data` of its own, so the
 * fallbacks are what the page shows too.
 */
const BAR_STILL = {
  track: { fill: 'var(--fig-track, rgba(255, 255, 255, 0.07))' },
  reached: { fill: 'var(--fig-data, var(--accent))' },
  failing: { fill: 'var(--error)' },
  next: { fill: 'none', stroke: 'var(--fig-data, var(--accent))', strokeWidth: 1 },
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
  still,
}: {
  column: string;
  progress: Progress;
  largest: number;
  x: number;
  still?: boolean;
}) {
  const { reached, failing, next, total } = progress;
  const left = readableSeconds(progress.seconds);
  const barW = ((COL_W - 64) * total) / largest;
  const unit = total ? barW / total : 0;
  const bx = x + COL_W / 2 - 16 - barW / 2;
  const by = START_Y - 11;
  const bar = (kind: keyof typeof BAR_STILL) =>
    still ? BAR_STILL[kind] : { className: `fig-eras-${kind}` };
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
        {!still && (
          <title>{`${column.startsWith('era:') ? `Era ${column.slice(4)}: ` : ''}${reached} of ${total} reached${left ? `, about ${left} of setup left` : ''}`}</title>
        )}
        {reached} of {total}
      </text>
      <rect {...bar('track')} x={bx} y={by} width={barW} height={3} rx={1} />
      {reached > 0 && (
        <rect {...bar('reached')} x={bx} y={by} width={unit * reached} height={3} rx={1} />
      )}
      {failing > 0 && (
        <rect
          {...bar('failing')}
          x={bx + unit * reached}
          y={by}
          width={unit * failing}
          height={3}
          rx={1}
        />
      )}
      {next > 0 && (
        <rect
          {...bar('next')}
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
 * No hooks, so the wiring can be tested by calling it. A still draws the name
 * and the count, and nothing to press.
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
  still,
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
  still?: boolean;
}) {
  const x = START_X + index * COL_W;
  const era = column.startsWith('era:') ? Number(column.slice(4)) : undefined;
  const head = (
    <>
      <text
        className={still ? undefined : 'civ-era-name'}
        x={columnCentre(index)}
        y={START_Y - 27}
        textAnchor="middle"
        fill="var(--text-primary)"
        fontSize={12}
        fontWeight={700}
        {...(still ? CAPS : {})}
      >
        {!still && <title>{termTitle(term)}</title>}
        {still ? label.toUpperCase() : label}
      </text>
      <ColumnCount column={column} progress={progress} largest={largest} x={x} still={still} />
    </>
  );
  if (era === undefined || still) return head;

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

/** What the page lays over the map, and how a press on a node reaches it. */
export interface SceneView {
  /** The lens in front, once the map has fallen back from one with nothing to paint. */
  lens: ActiveLens;
  attention: Record<string, number>;
  selectedId: string | null;
  /** The selection, or failing that the node under the pointer. */
  focusId: string | null;
  /** One hop from the focus, both ways. */
  needs: Set<string>;
  enables: Set<string>;
  /** What a collapse keeps; null draws every node. */
  collapse: { shown: Set<string> } | null;
  spotlight: string | null;
  /** Whether the spotlight, if there is one, lights this node. */
  spotlit: (item: Item) => boolean;
  /** The node the headline names, cornered while it shows. */
  findingTarget: { id: string; color: string } | null;
  openEra: number | null;
  onOpenEra: (era: number) => void;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}

export interface MapSceneProps {
  /** Every item, which a simulation counts against; the columns hold the ones drawn. */
  items: Item[];
  connections: Connection[];
  cols: Columns['cols'];
  colOrder: string[];
  positions: Map<string, Placed>;
  /** The scene's height, which the bands run down. */
  height: number;
  downstream: Map<string, string[]>;
  simulation: Showing;
  /** `url(#…)` of the stripes the enclosing svg defines. */
  hazard: string;
  /** The page's view of the map. Absent, the scene is a still. */
  view?: SceneView;
}

/** The `.civ-node-label` rule in App.css, as attributes: a name haloed in the canvas colour. */
const LABEL_HALO = {
  paintOrder: 'stroke',
  stroke: 'var(--bg-canvas)',
  strokeWidth: 3,
  strokeLinejoin: 'round',
} as const;

const NOTHING = new Set<string>();
const UNRECORDED: Record<string, number> = {};

export function MapScene({
  items,
  connections,
  cols,
  colOrder,
  positions,
  height,
  downstream,
  simulation,
  hazard,
  view,
}: MapSceneProps) {
  const still = !view;
  // A still is drawn at rest in the standard lens: see MapStill.
  const activeLens = view?.lens ?? 'default';
  const attentionInterventions = view?.attention ?? UNRECORDED;
  const selectedId = view?.selectedId ?? null;
  const focusId = view?.focusId ?? null;
  const needs = view?.needs ?? NOTHING;
  const enables = view?.enables ?? NOTHING;
  const collapse = view?.collapse ?? null;
  const spotlight = view?.spotlight ?? null;
  const findingTarget = view?.findingTarget ?? null;
  /** Whether the map draws a node: every one, unless a collapse hides it. */
  const shown = (id: string) => !collapse || collapse.shown.has(id);

  const {
    mode: simulationMode,
    rootId: simulatedNodeId,
    cascade: simulatedCascadeIds,
    weakened: simulatedWeakenedIds = NOTHING,
  } = simulation;
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
  // The gap, numbered in the order it can be closed: step 1 needs nothing
  // else in the gap, and each later step needs only earlier ones.
  const routeStep = useMemo(
    () =>
      simulationMode === 'gap' && simulatedNodeId
        ? new Map(routeTo(items, connections, simulatedNodeId).map((id, i) => [id, i + 1]))
        : new Map<string, number>(),
    [simulationMode, simulatedNodeId, items, connections]
  );
  // The count the banner states, for the callout on the node that went down.
  const outageStops = useMemo(
    () =>
      simulationMode === 'outage'
        ? outageImpact(items, { stops: simulatedCascadeIds, weakened: simulatedWeakenedIds })
            .stopped.length
        : 0,
    [simulationMode, items, simulatedCascadeIds, simulatedWeakenedIds]
  );
  // The top of the scale the lens is drawn against.
  const attentionMax = useMemo(
    () => Math.max(0, ...Object.values(attentionInterventions).map(Number)),
    [attentionInterventions]
  );
  /** The stagger for a node the simulation reaches: the hop count, as a CSS variable. */
  const hopStyle = (id: string): React.CSSProperties | undefined => {
    const hop = simDepth.get(id);
    return hop === undefined || still ? undefined : ({ '--hop': hop } as React.CSSProperties);
  };
  const largestColumn = Math.max(...colOrder.map(c => (cols[c] || []).length), 1);
  const isTreeView = colOrder.some(c => c.startsWith('era:'));
  const keystone = (item: Item) =>
    (downstream.get(item.id) || []).length >= 3 || isRuntimeNode(item);

  return (
    <>
      {/* Era column bands with clean headers */}
      {colOrder.map((d, i) => {
        const list = cols[d] || [];
        return (
          <g key={`band-${d}`}>
            <rect {...bandOf(i, height)} fill="var(--band)" rx={12} />
            <ColumnHead
              column={d}
              index={i}
              label={columnLabel(d, list)}
              progress={columnProgress(list)}
              largest={largestColumn}
              term={isTreeView ? 'era' : 'domain'}
              openEra={view?.openEra ?? null}
              onOpen={era => view?.onOpenEra(era)}
              still={still}
            />
          </g>
        );
      })}

      {/* Edges, behind the nodes. Curved, so a bundle into one node fans
          instead of converging through everything between. Into the focus
          in one colour, out of it in another. */}
      {connections.map((conn, i) => {
        const fromPos = positions.get(conn.from);
        const toPos = positions.get(conn.to);
        if (!fromPos || !toPos || !shown(conn.from) || !shown(conn.to)) return null;
        const isHard = conn.type === 'hard-dep';
        const isSoft = conn.type === 'soft-dep';
        const isSimLine = simulationMode !== 'none' && simSet.has(conn.from) && simSet.has(conn.to);
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
            className={isSimLine && !still ? 'civ-sim-edge' : undefined}
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

              const isSpotlit = view ? view.spotlit(item) : true;

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
              const failingNode = isFailing(item);

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
                } else if (isSimAffected && !reached) {
                  // Never set up, so nothing stopped: a red outline, cut off
                  // and empty. Filled like the rest, the tour's "4 things
                  // stop" sat over sixteen red circles.
                  nodeFill = 'var(--bg-canvas)';
                  sc = 'var(--error)';
                  sw = 2;
                } else if (isSimAffected && !failingNode) {
                  // Red for what stops; amber for what keeps another
                  // provider and only loses one. It was all red. A node
                  // already failing keeps its stripes: it stopped before.
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

              // A still is a picture: a group placed and faded, and nothing in
              // it to press, focus or animate.
              const body = (
                <>
                  {(isSimRoot || isSimAffected) && !still && (
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
                      Keystone key, or selecting the node, fills it in. Not
                      during a simulation, whose callout takes this corner. */}
                  {isKeystone && !dimmed && simulationMode === 'none' && (
                    <g transform={`translate(${-NODE_R + 3}, ${-NODE_R + 3})`}>
                      {!still && (
                        <title>{`Keystone: ${(downstream.get(item.id) || []).length} capabilities depend on it`}</title>
                      )}
                      <KeystoneMark lit={spotlight === 'Keystone' || selected} />
                    </g>
                  )}

                  {/* The node an outage started at, labelled on the map
                      where the banner names it: the one callout the map
                      draws, so it is the one place the eye goes. */}
                  {isSimRoot && simulationMode === 'outage' && (
                    <Callout
                      r={NODE_R}
                      text={outageStops ? `DOWN · STOPS ${outageStops}` : 'DOWN'}
                      color="var(--error)"
                      still={still}
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
                  {((next && !dimmed && !isSimAffected) || routeStep.has(item.id)) &&
                    costOf(item) && (
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
                  {routeStep.has(item.id) && (
                    <text
                      className={still ? undefined : 'civ-route-step'}
                      y={5}
                      textAnchor="middle"
                      fill="var(--on-accent)"
                      fontSize={14}
                      fontWeight={700}
                      fontFamily="var(--font-sans)"
                    >
                      {routeStep.get(item.id)}
                    </text>
                  )}
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

                  {!dimmed && isProven(item) && (
                    <g transform={`translate(${NODE_R - 4}, ${-NODE_R + 4})`}>
                      <circle r={6.5} fill="var(--ok)" stroke="var(--bg-canvas)" strokeWidth={2} />
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
                  {!dimmed && failingNode && (
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
                      {/* Who and which: names a person can read on the page,
                          and that a file never carries. */}
                      {!still && (
                        <title>
                          {jointMark(item) === 'person'
                            ? `Needs a person: ${((item.meta?.people as string[]) ?? []).join(', ')}`
                            : `Runs on a device: ${((item.meta?.devices as string[]) ?? []).join(', ')}`}
                        </title>
                      )}
                      <JointIcon mark={jointMark(item)!} />
                    </g>
                  )}
                  {/* Two lines where the name needs them. A trailing space
                      on the first keeps the element's text the whole name,
                      which the recorder matches against the aria-label. The
                      halo is `.civ-node-label` on the page, and written out
                      in a still. */}
                  <text
                    y={NODE_R + 17}
                    textAnchor="middle"
                    className={still ? undefined : 'civ-node-label'}
                    {...(still ? LABEL_HALO : {})}
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
                </>
              );
              if (still) {
                return (
                  <g key={item.id} transform={`translate(${cx}, ${cy})`} opacity={baseOpacity}>
                    {body}
                  </g>
                );
              }
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
                  onClick={() => view.onSelect(selected ? null : item.id)}
                  onKeyDown={e => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    view.onSelect(selected ? null : item.id);
                  }}
                  onFocus={() => view.onHover(item.id)}
                  onBlur={() => view.onHover(null)}
                  onMouseEnter={() => view.onHover(item.id)}
                  onMouseLeave={() => view.onHover(null)}
                  style={{
                    cursor: 'pointer',
                    transition: 'opacity .15s',
                    ...hopStyle(item.id),
                  }}
                >
                  {body}
                </g>
              );
            })}
          </g>
        );
      })}
    </>
  );
}

/** Where a still puts everything: the map's own columns, rows and extent. */
export interface StillLayout extends Columns {
  positions: Map<string, Placed>;
  width: number;
  height: number;
  downstream: Map<string, string[]>;
}

export function stillLayout(items: Item[], connections: Connection[]): StillLayout {
  const columns = buildColumns(visibleItems(items), connections);
  return {
    ...columns,
    ...sceneSize(columns),
    positions: layoutNodes(columns),
    downstream: buildAdjacency(connections, null).downstream,
  };
}

/**
 * The whole map as one standalone drawing: every column, node and edge, from
 * the graph and not from the screen, so the page's zoom, scroll, focus and
 * minimap change nothing in it. It is drawn at rest, with no selection,
 * spotlight or headline, and a running simulation as the page draws it.
 *
 * Always in the standard lens. The other two paint who stepped in and what
 * may act without asking, which the allow-list in src/engine/share.ts keeps
 * out of a shared picture of the map; the standard lens draws only names,
 * states, checks and edges. No tooltip is drawn either, so no description and
 * no person's name.
 *
 * `scale` sizes the document and leaves its coordinates alone, so a PNG is
 * drawn at its own resolution and not enlarged from a smaller one.
 */
export function MapStill({
  items,
  connections,
  layout,
  simulation,
  scale = 1,
}: {
  items: Item[];
  connections: Connection[];
  layout: StillLayout;
  simulation: Showing;
  scale?: number;
}) {
  const { width, height } = layout;
  return (
    <svg
      width={Math.round(width * scale)}
      height={Math.round(height * scale)}
      viewBox={`0 0 ${width} ${height}`}
      fontFamily="var(--font-sans)"
    >
      <title>Capability tree: what this setup can do, by era</title>
      <defs>
        <HazardPattern id="hazard" />
      </defs>
      <rect width={width} height={height} fill="var(--bg-canvas)" />
      <MapScene
        items={items}
        connections={connections}
        cols={layout.cols}
        colOrder={layout.colOrder}
        positions={layout.positions}
        height={height}
        downstream={layout.downstream}
        simulation={simulation}
        hazard="url(#hazard)"
      />
    </svg>
  );
}
