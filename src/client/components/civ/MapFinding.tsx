/**
 * The map's headline: one sentence on what is broken or what to reach next,
 * then the size of the range, how it moved, and the worst single loss.
 *
 * What is broken comes first. The range line led, so the first thing read was
 * a hypothetical ("losing Shell Execution stops 9") and the real problem, a
 * check that is failing now, came second.
 *
 * Sits where the simulation banner sits, and gives way to it, since a running
 * simulation is its own sentence. Hidden while a node is selected: the panel
 * is then the thing being read.
 */
import type { Ref } from 'react';
import type { LoopSince } from '../../../shared/api';
import type { Item } from '../../utils/configImporter';
import { costOf, type MapFindings } from './layout';

/** The spotlight keys the range line lights; CivTree resolves them to nodes. */
export const GAINED_THIS_WEEK = 'Gained this week';
export const LOST_THIS_WEEK = 'Lost this week';

interface MapFindingProps {
  findings: MapFindings;
  /** How the range moved this week; null before a second observation. */
  since?: LoopSince | null;
  onShow: (id: string) => void;
  onPreview: (id: string) => void;
  /** Run the outage simulation the weakest point names. */
  onSimulate?: (id: string) => void;
  onSpotlight?: (key: string) => void;
  /**
   * Which way the first failing node lies when it is out of sight ("left",
   * "top right"), from the minimap. Absent when it is in view, or the whole
   * map is.
   */
  where?: string | null;
  leftInset?: number;
  rightInset?: number;
  /** The headline's box, which the map measures to start its canvas below it. */
  wrapRef?: Ref<HTMLDivElement>;
}

/**
 * The range in one line. The count is the verified part, because that is the
 * part there is evidence for; the week's movement follows, split the way the
 * ledger splits it, and absent movement is said, never printed as +0; the
 * weakest point is the single loss that would stop the most of it.
 */
function RangeLine({
  findings,
  since,
  onSimulate,
  onSpotlight,
}: Pick<MapFindingProps, 'findings' | 'since' | 'onSimulate' | 'onSpotlight'>) {
  const { verified, weakest } = findings;
  const up = since ? since.gained.length + since.emergent.length : 0;
  const down = since ? since.lost.length + since.diminished.length : 0;
  const composed = since?.emergent.length ?? 0;
  return (
    <div className="civ-range" role="status">
      {/* The header's pill says this on a wide screen; a phone hides the
          pill, so it is said here. */}
      <span className="civ-range-count">
        <strong>{verified}</strong> verified
      </span>
      <span className="civ-range-sep civ-range-count" aria-hidden="true">
        ·
      </span>
      {since === undefined ? null : !since ? (
        <span className="civ-range-note">no earlier observation to compare yet</span>
      ) : up || down ? (
        <span>
          {up > 0 && (
            <button
              type="button"
              className="civ-range-delta civ-range-delta--up"
              onClick={() => onSpotlight?.(GAINED_THIS_WEEK)}
              aria-label={`Highlight the ${up} gained this week`}
            >
              +{up}
            </button>
          )}
          {up > 0 && down > 0 ? ' ' : ''}
          {down > 0 && (
            <button
              type="button"
              className="civ-range-delta civ-range-delta--down"
              onClick={() => onSpotlight?.(LOST_THIS_WEEK)}
              aria-label={`Highlight the ${down} lost or failing this week`}
            >
              −{down}
            </button>
          )}{' '}
          <span
            title={
              composed
                ? `${composed} became reachable with nothing added: a prerequisite was met elsewhere`
                : undefined
            }
          >
            this week
          </span>
        </span>
      ) : (
        <span className="civ-range-note">no change this week</span>
      )}
      {weakest && (
        <>
          <span className="civ-range-sep" aria-hidden="true">
            ·
          </span>
          <span>
            losing <strong>{weakest.item.name}</strong> stops {weakest.stops}
            {onSimulate && (
              <button
                type="button"
                className="civ-range-sim"
                onClick={() => onSimulate(weakest.item.id)}
              >
                Simulate
              </button>
            )}
          </span>
        </>
      )}
    </div>
  );
}

const names = (list: Item[]) =>
  list.length <= 2
    ? list.map(i => i.name).join(' and ')
    : `${list[0].name}, ${list[1].name} and ${list.length - 2} more`;

export function MapFinding({
  findings,
  since,
  onShow,
  onPreview,
  onSimulate,
  onSpotlight,
  where,
  leftInset = 0,
  rightInset = 0,
  wrapRef,
}: MapFindingProps) {
  const { failing, best } = findings;
  const cost = best ? costOf(best.item) : '';
  return (
    <div
      ref={wrapRef}
      className="civ-sim-wrap civ-finding-wrap"
      data-occludes-map
      style={{ paddingLeft: 12 + leftInset, paddingRight: 12 + rightInset }}
    >
      {failing.length > 0 ? (
        <div role="status" className="civ-finding civ-finding--bad">
          <span className="civ-finding-dot" aria-hidden="true">
            !
          </span>
          <span>
            <strong>{names(failing)}</strong> {failing.length === 1 ? 'is' : 'are'} configured but
            failing {failing.length === 1 ? 'its check' : 'their checks'}.
            {where
              ? ` ${failing.length === 1 ? 'It is' : 'The first is'} off-screen ${where}.`
              : ''}
          </span>
          <button type="button" className="civ-finding-btn" onClick={() => onShow(failing[0].id)}>
            Show
          </button>
        </div>
      ) : best ? (
        <div role="status" className="civ-finding">
          <span>
            Best next step: <strong>{best.item.name}</strong>
            {cost ? ` · ${cost} of setup` : ''}
            {best.reaches ? ` · reaches ${best.reaches} more` : ''}
          </span>
          <button type="button" className="civ-finding-btn" onClick={() => onPreview(best.item.id)}>
            Preview
          </button>
        </div>
      ) : null}
      <RangeLine
        findings={findings}
        since={since}
        onSimulate={onSimulate}
        onSpotlight={onSpotlight}
      />
    </div>
  );
}
