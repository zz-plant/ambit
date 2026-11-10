/**
 * The banner that says a simulation is running, and what it implies.
 *
 * Shown while an outage, an unlock or a gap is being previewed: how many
 * capabilities the change reaches, and the way back out. An outage adds a
 * track under the sentence: play it, drag it or step it with the arrow keys,
 * a hop at a time, with what each hop takes named beside it. Lifted out of
 * CivTree.tsx, which held this, the zoom HUD, a legend, the era bands, the
 * edges, the nodes and a tooltip in one 1,067-line return.
 */
import type { Item } from '../../utils/configImporter';
import { hopSentence, type OutageHop, simulationSentence } from './layout';
import { Icon } from '../Icon';

/**
 * An outage being stepped: its hops, where the playhead stands, and the
 * sentence it ends on. Absent for an unlock or a gap, which have no track.
 */
export interface OutageTrack {
  hops: OutageHop[];
  hop: number;
  playing: boolean;
  scrub: (hop: number) => void;
  play: (on: boolean) => void;
  /** Whether the capability that went down could survive losing a provider. */
  remedy: string | null;
}

interface SimulationBannerProps {
  simulationMode: string;
  simulatedNodeId: string | null;
  simulatedItem: Item | undefined;
  /** A Set, not a list — the count is what the banner reports. */
  simulatedCascadeIds: Set<string>;
  /** In an outage, what keeps another provider and only loses one. */
  simulatedWeakenedIds?: Set<string>;
  /** The graph, so the gap can be priced. */
  items?: Item[];
  /**
   * How many of the nodes a simulation lights are hidden by a focus. The counts
   * in the sentence are the whole cascade whatever the map shows, and this says
   * how much of it is out of sight.
   */
  hiddenByFocus?: number;
  outage?: OutageTrack;
  clearSimulation: () => void;
  /** Pixels the capability list covers on the left, so the banner starts past it. */
  leftInset?: number;
  /** Pixels the detail panel covers on the right, so the banner stops short of it. */
  rightInset?: number;
  /** The banner itself, for the map to measure and start below. */
  bannerRef?: (el: HTMLDivElement | null) => void;
}

export function SimulationBanner({
  simulationMode,
  simulatedNodeId,
  simulatedItem,
  simulatedCascadeIds,
  simulatedWeakenedIds,
  items = [],
  hiddenByFocus = 0,
  outage,
  clearSimulation,
  leftInset = 0,
  rightInset = 0,
  bannerRef,
}: SimulationBannerProps) {
  if (simulationMode === 'none') return null;

  const text = simulationSentence(
    simulationMode,
    simulatedItem?.name || simulatedNodeId || '',
    simulatedCascadeIds,
    simulatedWeakenedIds,
    items
  );

  const name = simulatedItem?.name || simulatedNodeId || '';
  // A cascade one hop deep still has two stops: the outage, and what it takes.
  const last = outage ? outage.hops.length - 1 : 0;
  const track = outage && simulationMode === 'outage' && last > 0 ? outage : null;
  const remedy = simulationMode === 'outage' ? outage?.remedy : null;
  const said = track ? hopSentence(name, track.hops[track.hop], track.hop) : '';
  const step = track ? (track.hop === 0 ? 'Start' : `Step ${track.hop} of ${last}`) : '';

  // With a track, the way out sits at the end of it, and the sentence takes
  // the banner's whole width: on a phone the two side by side ran eight lines.
  const end = (
    <button type="button" className="civ-sim-banner-close" onClick={clearSimulation}>
      End simulation
    </button>
  );

  return (
    <div
      className="civ-sim-wrap"
      style={{ paddingLeft: 12 + leftInset, paddingRight: 12 + rightInset }}
    >
      <div
        ref={bannerRef}
        className={`civ-sim-banner civ-sim-banner--${simulationMode}${track ? ' civ-sim-banner--tracked' : ''}`}
      >
        <div className="civ-sim-line">
          {simulationMode === 'outage' ? (
            <Icon size={14} className="civ-sim-icon">
              <path d="M8 2 L14 13 H2 Z" />
              <line x1="8" y1="6" x2="8" y2="9" />
              <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
            </Icon>
          ) : simulationMode === 'gap' ? (
            <Icon size={14} className="civ-sim-icon">
              <circle cx="4" cy="8" r="2.5" />
              <circle cx="12" cy="8" r="2.5" />
              <line x1="6.5" y1="8" x2="9.5" y2="8" strokeDasharray="2 1.5" />
            </Icon>
          ) : (
            <Icon size={14} className="civ-sim-icon">
              <path d="M4 8 V5 C4 3 5.5 1.5 8 1.5 C10.5 1.5 12 3 12 5 V8" />
              <rect x="3" y="7" width="10" height="7.5" rx="2" />
              <circle cx="8" cy="10.5" r="1" fill="currentColor" />
            </Icon>
          )}
          {/* The whole answer is in the page from the first frame, so it is
            announced once; the remedy is only lit when the play reaches it. */}
          <span role="status">
            {text}
            {hiddenByFocus > 0 ? ` The focus hides ${hiddenByFocus} of them.` : ''}
            {remedy && (
              <span className={`civ-sim-remedy${!track || track.hop >= last ? ' is-on' : ''}`}>
                {' '}
                {remedy}
              </span>
            )}
          </span>
          {!track && end}
        </div>
        {track && (
          <div className="civ-sim-track">
            <button
              type="button"
              className={`civ-timeline-play${track.playing ? ' is-on' : ''}`}
              aria-label="Play the outage"
              aria-pressed={track.playing}
              title={
                track.playing
                  ? 'Pause'
                  : track.hop >= last
                    ? 'Play the outage again from the start'
                    : 'Play the outage from here'
              }
              onClick={() => track.play(!track.playing)}
            >
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
                {track.playing ? (
                  <path d="M2.5 2h2.5v8H2.5zM7 2h2.5v8H7z" />
                ) : (
                  <path d="M3 1.5v9L10.5 6z" />
                )}
              </svg>
            </button>
            <div className="civ-timeline-track civ-sim-scrub">
              <ol className="civ-timeline-ticks" aria-hidden="true">
                {track.hops.map((_, i) => (
                  <li
                    key={i}
                    className={`civ-timeline-tick${i <= track.hop ? ' civ-sim-tick' : ''}`}
                    style={{ left: `${(i / last) * 100}%` }}
                  />
                ))}
              </ol>
              <input
                type="range"
                className="civ-timeline-range"
                min={0}
                max={last}
                step={1}
                value={track.hop}
                aria-label="Step through the outage"
                aria-valuetext={`${step}: ${said}`}
                onChange={e => track.scrub(Number(e.target.value))}
              />
            </div>
            <span className="civ-sim-readout" aria-hidden="true" title={said}>
              <span className="civ-sim-step">{step}</span>
              {said}
            </span>
            {end}
          </div>
        )}
      </div>
    </div>
  );
}
