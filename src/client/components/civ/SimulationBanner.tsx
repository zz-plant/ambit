/**
 * The banner that says a simulation is running, and what it implies.
 *
 * Shown while an outage or an acquisition is being previewed: how many
 * capabilities the change reaches, and the way back out. Lifted out of
 * CivTree.tsx, which held this, the zoom HUD, a legend, the era bands, the
 * edges, the nodes and a tooltip in one 1,067-line return.
 */
import type { Item } from '../../utils/configImporter';

interface SimulationBannerProps {
  simulationMode: string;
  simulatedNodeId: string | null;
  simulatedItem: Item | undefined;
  /** A Set, not a list — the count is what the banner reports. */
  simulatedCascadeIds: Set<string>;
  clearSimulation: () => void;
  /** Pixels the detail panel covers on the right, so the banner stops short of it. */
  rightInset?: number;
}

export function SimulationBanner({
  simulationMode,
  simulatedNodeId,
  simulatedItem,
  simulatedCascadeIds,
  clearSimulation,
  rightInset = 0,
}: SimulationBannerProps) {
  if (simulationMode === 'none') return null;

  const name = simulatedItem?.name || simulatedNodeId;
  const n = simulatedCascadeIds.size;
  const outage = simulationMode === 'outage';
  const plural = n === 1 ? 'capability' : 'capabilities';

  return (
    <div className="civ-sim-wrap" style={{ paddingRight: 12 + rightInset }}>
      <div
        role="status"
        className={`civ-sim-banner ${outage ? 'civ-sim-banner--outage' : 'civ-sim-banner--acquisition'}`}
      >
        <span>
          {outage
            ? `If ${name} went down, ${n} downstream ${plural} would stop working.`
            : `Adding ${name} would make ${n} more ${plural} reachable.`}
        </span>
        <button type="button" className="civ-sim-banner-close" onClick={clearSimulation}>
          Done
        </button>
      </div>
    </div>
  );
}
