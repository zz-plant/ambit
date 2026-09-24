/**
 * The banner that says a simulation is running, and what it implies.
 *
 * Shown while an outage, an unlock or a gap is being previewed: how many
 * capabilities the change reaches, and the way back out. Lifted out of
 * CivTree.tsx, which held this, the zoom HUD, a legend, the era bands, the
 * edges, the nodes and a tooltip in one 1,067-line return.
 */
import type { Item } from '../../utils/configImporter';
import { outageImpact, outageSentence, readableSeconds } from './layout';

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
  clearSimulation: () => void;
  /** Pixels the capability list covers on the left, so the banner starts past it. */
  leftInset?: number;
  /** Pixels the detail panel covers on the right, so the banner stops short of it. */
  rightInset?: number;
}

export function SimulationBanner({
  simulationMode,
  simulatedNodeId,
  simulatedItem,
  simulatedCascadeIds,
  simulatedWeakenedIds,
  items = [],
  clearSimulation,
  leftInset = 0,
  rightInset = 0,
}: SimulationBannerProps) {
  if (simulationMode === 'none') return null;

  const name = simulatedItem?.name || simulatedNodeId;
  const n = simulatedCascadeIds.size;
  const plural = (count: number) => (count === 1 ? 'capability' : 'capabilities');
  // The gap's price: the setup time of everything in it, added up.
  const seconds = items
    .filter(i => simulatedCascadeIds.has(i.id))
    .reduce((t, i) => t + (Number(i.meta?.setupSeconds) || 0), 0);
  // An outage says only what was working stops; the rest of the red is named
  // for what it was. `outageSentence` is the detail panel's sentence too.
  const outage =
    simulationMode === 'outage'
      ? outageSentence(
          name ?? '',
          outageImpact(items, { stops: simulatedCascadeIds, weakened: simulatedWeakenedIds })
        )
      : null;
  const text = outage
    ? outage.before + outage.count + outage.after
    : simulationMode === 'gap'
      ? `Reaching ${name} needs ${n} more ${plural(n)} first${
          seconds ? `, about ${readableSeconds(seconds)} of setup` : ''
        }.`
      : `Adding ${name} would make ${n} more ${plural(n)} reachable.`;

  return (
    <div
      className="civ-sim-wrap"
      style={{ paddingLeft: 12 + leftInset, paddingRight: 12 + rightInset }}
    >
      <div role="status" className={`civ-sim-banner civ-sim-banner--${simulationMode}`}>
        {simulationMode === 'outage' ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            className="civ-sim-icon"
            aria-hidden="true"
          >
            <path d="M8 2 L14 13 H2 Z" />
            <line x1="8" y1="6" x2="8" y2="9" />
            <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
          </svg>
        ) : simulationMode === 'gap' ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            className="civ-sim-icon"
            aria-hidden="true"
          >
            <circle cx="4" cy="8" r="2.5" />
            <circle cx="12" cy="8" r="2.5" />
            <line x1="6.5" y1="8" x2="9.5" y2="8" strokeDasharray="2 1.5" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            className="civ-sim-icon"
            aria-hidden="true"
          >
            <path d="M4 8 V5 C4 3 5.5 1.5 8 1.5 C10.5 1.5 12 3 12 5 V8" />
            <rect x="3" y="7" width="10" height="7.5" rx="2" />
            <circle cx="8" cy="10.5" r="1" fill="currentColor" />
          </svg>
        )}
        <span>{text}</span>
        <button type="button" className="civ-sim-banner-close" onClick={clearSimulation}>
          Done
        </button>
      </div>
    </div>
  );
}
