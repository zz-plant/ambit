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
          <svg
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="2" y1="6" x2="10" y2="6" />
          </svg>
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
          <svg
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="2" y1="6" x2="10" y2="6" />
            <line x1="6" y1="2" x2="6" y2="10" />
          </svg>
        </button>
        <button
          type="button"
          className="civ-zoom-btn"
          onClick={fit}
          title="Fit the whole map"
          aria-label="Fit graph to view"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M1.5 4.5 V1.5 H4.5 M7.5 1.5 H10.5 V4.5 M10.5 7.5 V10.5 H7.5 M4.5 10.5 H1.5 V7.5" />
          </svg>
          <span className="civ-zoom-btn-label">Fit</span>
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
