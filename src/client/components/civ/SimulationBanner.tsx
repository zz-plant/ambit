/**
 * The banner that says a simulation is running, and what it implies.
 *
 * Shown while an outage, an unlock or a gap is being previewed: how many
 * capabilities the change reaches, and the way back out. Lifted out of
 * CivTree.tsx, which held this, the zoom HUD, a legend, the era bands, the
 * edges, the nodes and a tooltip in one 1,067-line return.
 */
import type { Item } from '../../utils/configImporter';
import { readableSeconds } from './layout';

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
  const weakened = simulatedWeakenedIds?.size ?? 0;
  const plural = (count: number) => (count === 1 ? 'capability' : 'capabilities');
  // The gap's price: the setup time of everything in it, added up.
  const seconds = items
    .filter(i => simulatedCascadeIds.has(i.id))
    .reduce((t, i) => t + (Number(i.meta?.setupSeconds) || 0), 0);
  const text =
    simulationMode === 'outage'
      ? n
        ? `If ${name} went down, ${n} ${plural(n)} would stop working${
            weakened ? ` and ${weakened} would lose a provider` : ''
          }.`
        : weakened
          ? `If ${name} went down, nothing would stop working, but ${weakened} ${plural(weakened)} would lose a provider.`
          : `If ${name} went down, nothing else would stop working.`
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
        <span>{text}</span>
        <button type="button" className="civ-sim-banner-close" onClick={clearSimulation}>
          Done
        </button>
      </div>
    </div>
  );
}
