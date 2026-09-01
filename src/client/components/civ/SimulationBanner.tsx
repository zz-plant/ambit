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
}

export function SimulationBanner({
  simulationMode,
  simulatedNodeId,
  simulatedItem,
  simulatedCascadeIds,
  clearSimulation,
}: SimulationBannerProps) {
  if (simulationMode === 'none') return null;

  return (
    <div
      style={{
        position: 'sticky',
        top: 56,
        left: 16,
        zIndex: 20,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '12px',
        background:
          simulationMode === 'outage'
            ? 'linear-gradient(90deg, #ff2a55, #880022)'
            : 'linear-gradient(90deg, #00f0ff, #0088cc)',
        color: '#ffffff',
        padding: '8px 16px',
        borderRadius: 'var(--radius)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
        border: '1px solid rgba(255,255,255,0.2)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <span
        style={{
          fontWeight: 700,
          fontSize: '12px',
          letterSpacing: '0.4px',
          fontFamily: 'var(--font)',
        }}
      >
        {simulationMode === 'outage'
          ? `⚡ BLAST RADIUS SIMULATION: Outage of "${simulatedItem?.name || simulatedNodeId}" disables ${simulatedCascadeIds.size} downstream capabilities.`
          : `✨ FRONTIER SIMULATION: Unlocking "${simulatedItem?.name || simulatedNodeId}" makes +${simulatedCascadeIds.size} compound capabilities reachable.`}
      </span>
      <button
        type="button"
        style={{
          background: '#ffffff',
          color: simulationMode === 'outage' ? '#ff2a55' : '#0088cc',
          border: 'none',
          borderRadius: 'var(--radius-xs)',
          padding: '4px 10px',
          cursor: 'pointer',
          fontWeight: 800,
          fontFamily: 'var(--font)',
          fontSize: '11px',
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
        }}
        onClick={clearSimulation}
      >
        ✕ Exit Simulation
      </button>
    </div>
  );
}
