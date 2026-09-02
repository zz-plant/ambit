/**
 * The controls pinned over the canvas: zoom on the left, lenses on the right.
 *
 * The lenses used to sit in the top bar beside the view tabs, which put three
 * axes of state — which graph, which view, which colouring — in one 50px row.
 * A lens changes how the map is painted and nothing else, so it lives with
 * the map.
 */
import type React from 'react';
import type { ActiveLens } from '../../store/ambitStore';

export const LENSES: readonly [ActiveLens, string, string][] = [
  ['default', 'Standard', '1'],
  ['attention', 'Attention', '2'],
  ['credentials', 'Shared credentials', '3'],
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
    <div className="civ-hud" style={{ paddingRight: 12 + rightInset }}>
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
        <span className="civ-zoom-badge">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="civ-zoom-btn"
          onClick={() => setZoom(z => Math.min(2.5, +(z + 0.2).toFixed(2)))}
          title="Zoom in (+)"
          aria-label="Zoom in"
        >
          +
        </button>
        <div className="civ-zoom-divider" />
        <button
          type="button"
          className="civ-zoom-btn"
          onClick={() => {
            setZoom(1);
            containerRef.current?.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
          }}
          title="Actual size (0)"
        >
          1:1
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
        {LENSES.map(([lens, label, hotkey]) => (
          <button
            key={lens}
            type="button"
            className={`app-deck-tab ${activeLens === lens ? 'app-deck-tab--active' : ''}`}
            aria-pressed={activeLens === lens}
            onClick={() => onSetLens(lens)}
            title={`${label} lens (${hotkey})`}
          >
            {label}
            <span className="civ-lens-key" aria-hidden="true">
              {hotkey}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
