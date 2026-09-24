/**
 * The map's headline: the size of the range and how it moved, then one
 * sentence on what is broken or what to reach next.
 *
 * Sits where the simulation banner sits, and gives way to it, since a running
 * simulation is its own sentence. Hidden while a node is selected: the panel
 * is then the thing being read.
 */
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
  leftInset?: number;
  rightInset?: number;
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
      <span>
        <strong>{verified}</strong> verified
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
  leftInset = 0,
  rightInset = 0,
}: MapFindingProps) {
  const { failing, best } = findings;
  const cost = best ? costOf(best.item) : '';
  return (
    <div
      className="civ-sim-wrap civ-finding-wrap"
      style={{ paddingLeft: 12 + leftInset, paddingRight: 12 + rightInset }}
    >
      <RangeLine
        findings={findings}
        since={since}
        onSimulate={onSimulate}
        onSpotlight={onSpotlight}
      />
      {failing.length > 0 ? (
        <div role="status" className="civ-finding civ-finding--bad">
          <span className="civ-finding-dot" aria-hidden="true">
            !
          </span>
          <span>
            <strong>{names(failing)}</strong> {failing.length === 1 ? 'is' : 'are'} configured but
            failing {failing.length === 1 ? 'its check' : 'their checks'}.
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
    </div>
  );
}
