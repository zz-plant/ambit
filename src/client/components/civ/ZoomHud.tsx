/**
 * The controls pinned over the canvas: zoom on the left, lenses on the right.
 *
 * The lenses used to sit in the top bar beside the view tabs, which put three
 * axes of state — which graph, which view, which colouring — in one 50px row.
 * A lens changes how the map is painted and nothing else, so it lives with
 * the map.
 */
import type React from 'react';
import type { ActiveLens } from '../../linkState';

export const LENSES: readonly [ActiveLens, string, string][] = [
  ['default', 'Standard', '1'],
  ['attention', 'Attention', '2'],
];

interface ZoomHudProps {
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The scene's extent, which "fit to view" divides the viewport by. */
  contentWidth: number;
  contentHeight: number;
  activeLens: ActiveLens;
  onSetLens: (lens: ActiveLens) => void;
  /**
   * Whether the ledger has recorded anything the attention lens could colour.
   * A lens with nothing behind it is offered as a disabled button that says
   * why, instead of a map that goes grey with a note over it.
   */
  attentionAvailable: boolean;
  /** Pixels the capability list covers on the left, so the HUD stays clear of it. */
  leftInset?: number;
  /** Pixels the detail panel covers on the right. */
  rightInset?: number;
}

export function ZoomHud({
  zoom,
  setZoom,
  containerRef,
  contentWidth,
  contentHeight,
  activeLens,
  onSetLens,
  attentionAvailable,
  leftInset = 0,
  rightInset = 0,
}: ZoomHudProps) {
  const fit = () => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fitRatio = Math.min(rect.width / contentWidth, rect.height / contentHeight);
    setZoom(Math.max(0.4, Math.min(1.5, +(fitRatio * 0.95).toFixed(2))));
    el.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
  };

  return (
    <div className="civ-hud" style={{ paddingLeft: 12 + leftInset, paddingRight: 12 + rightInset }}>
      <div className="civ-zoom-hud" role="toolbar" aria-label="Zoom">
        <button
          type="button"
          className="civ-zoom-btn"
          onClick={() => setZoom(z => Math.max(0.4, +(z - 0.2).toFixed(2)))}
          title="Zoom out (−)"
          aria-label="Zoom out"
        >
          −
        </button>
        {/* The reading is the reset: one control where a badge and a 1:1
            button stood, since the number is what you press to get it back. */}
        <button
          type="button"
          className="civ-zoom-badge"
          onClick={() => {
            setZoom(1);
            containerRef.current?.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
          }}
          title="Actual size (0)"
          aria-label={`Zoom ${Math.round(zoom * 100)}%. Actual size`}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="civ-zoom-btn"
          onClick={() => setZoom(z => Math.min(2.5, +(z + 0.2).toFixed(2)))}
          title="Zoom in (+)"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="civ-zoom-btn"
          onClick={fit}
          title="Fit the whole map"
          aria-label="Fit graph to view"
        >
          Fit
        </button>
      </div>

      <div className="civ-lens-hud" role="toolbar" aria-label="Lens">
        {LENSES.map(([lens, label, hotkey]) => {
          const unavailable = lens === 'attention' && !attentionAvailable;
          return (
            <button
              key={lens}
              type="button"
              className={`app-deck-tab ${activeLens === lens ? 'app-deck-tab--active' : ''}`}
              aria-pressed={activeLens === lens}
              disabled={unavailable}
              onClick={() => onSetLens(lens)}
              title={
                unavailable
                  ? 'Nothing recorded yet. This lens shades each capability by how often you had to step in; copy plugins/ambit-tracker.js into ~/.config/opencode/plugins/ and it fills from your own sessions.'
                  : `${label} lens (${hotkey})`
              }
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
