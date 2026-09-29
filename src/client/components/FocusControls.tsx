import { FOCUS_DEPTHS, FOCUS_DIRECTIONS, type FocusDepth, type FocusDirection } from '../linkState';

/** The words the direction is chosen in: the panel's own two lists, and the two together. */
const DIRECTION_LABEL: Record<FocusDirection, string> = {
  needs: 'Needs',
  both: 'Both',
  enables: 'Enables',
};

interface FocusControlsProps {
  /** Whether the map is collapsed to this node's neighbourhood. */
  on: boolean;
  depth: FocusDepth;
  direction: FocusDirection;
  /** How many of the map's nodes the collapse hides. */
  hidden: number;
  onToggle: () => void;
  onDepth: (depth: FocusDepth) => void;
  onDirection: (direction: FocusDirection) => void;
  /** Bring every node back. */
  onClear: () => void;
}

/**
 * Keeps only the selected node's neighbourhood on the map. Off unless asked
 * for: every link, the tour and the hero recording select nodes, so a default
 * that hid things would change all of them. Pressed, it offers which way to
 * look and how far, and a pill that says how many nodes are hidden and brings
 * them back. No hooks, so the wiring can be tested by calling it.
 */
export function FocusControls({
  on,
  depth,
  direction,
  hidden,
  onToggle,
  onDepth,
  onDirection,
  onClear,
}: FocusControlsProps) {
  return (
    <div className="sp-focus">
      <button
        type="button"
        className="sp-action-btn sp-action-btn--focus"
        aria-pressed={on}
        onClick={onToggle}
      >
        Focus on this node
      </button>
      {on && (
        <>
          <div className="sp-focus-row">
            <span className="sp-focus-label">Direction</span>
            <div className="sp-seg" role="toolbar" aria-label="Direction">
              {FOCUS_DIRECTIONS.map(d => (
                <button
                  key={d}
                  type="button"
                  className="sp-seg-btn"
                  aria-pressed={direction === d}
                  onClick={() => onDirection(d)}
                >
                  {DIRECTION_LABEL[d]}
                </button>
              ))}
            </div>
          </div>
          <div className="sp-focus-row">
            <span className="sp-focus-label">Depth</span>
            <div className="sp-seg" role="toolbar" aria-label="Depth in hops">
              {FOCUS_DEPTHS.map(n => (
                <button
                  key={n}
                  type="button"
                  className="sp-seg-btn"
                  aria-pressed={depth === n}
                  aria-label={`${n} ${n === 1 ? 'hop' : 'hops'}`}
                  onClick={() => onDepth(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          {hidden > 0 ? (
            <button type="button" className="sp-focus-pill" onClick={onClear}>
              <strong>{hidden}</strong> hidden · Show all
            </button>
          ) : (
            <p className="sp-focus-note">Nothing is hidden at this depth.</p>
          )}
        </>
      )}
    </div>
  );
}
