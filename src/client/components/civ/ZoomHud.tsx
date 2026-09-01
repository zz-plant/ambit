/**
 * The floating zoom and pan controls over the canvas.
 *
 * Lifted out of CivTree.tsx, which held the HUD, a simulation banner, a
 * legend, the era bands, the edges, the nodes and a tooltip in one 1,067-line
 * return. Each of those is a thing you can look at on its own.
 */
import type React from 'react';

interface ZoomHudProps {
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The scene's extent, which "fit to view" divides the viewport by. */
  contentWidth: number;
  contentHeight: number;
}

export function ZoomHud({
  zoom,
  setZoom,
  containerRef,
  contentWidth,
  contentHeight,
}: ZoomHudProps) {
  return (
    <div className="civ-zoom-hud" role="toolbar" aria-label="Canvas zoom and pan controls">
      <button
        type="button"
        className="civ-zoom-btn"
        onClick={() => setZoom(z => Math.min(2.5, +(z + 0.2).toFixed(2)))}
        title="Zoom In (Hotkey: +)"
        aria-label="Zoom in"
      >
        +
      </button>
      <span className="civ-zoom-badge">{Math.round(zoom * 100)}%</span>
      <button
        type="button"
        className="civ-zoom-btn"
        onClick={() => setZoom(z => Math.max(0.4, +(z - 0.2).toFixed(2)))}
        title="Zoom Out (Hotkey: -)"
        aria-label="Zoom out"
      >
        −
      </button>
      <div className="civ-zoom-divider" />
      <button
        type="button"
        className="civ-zoom-btn"
        onClick={() => {
          setZoom(1);
          if (containerRef.current) {
            containerRef.current.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
          }
        }}
        title="Reset to 100% (Hotkey: 0)"
        aria-label="Reset zoom to 100%"
      >
        1:1
      </button>
      <button
        type="button"
        className="civ-zoom-btn"
        onClick={() => {
          if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const fitRatio = Math.min(rect.width / contentWidth, rect.height / contentHeight);
            setZoom(Math.max(0.4, Math.min(1.5, +(fitRatio * 0.95).toFixed(2))));
            containerRef.current.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
          }
        }}
        title="Fit Graph to View"
        aria-label="Fit graph to view"
      >
        ⊡
      </button>
    </div>
  );
}
