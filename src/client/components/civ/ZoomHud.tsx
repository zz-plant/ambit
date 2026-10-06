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
import { ZOOM_MIN } from './viewport';

export const LENSES: readonly [ActiveLens, string, string][] = [
  ['default', 'Standard', '1'],
  ['attention', 'Attention', '2'],
  ['authority', 'Authority', '3'],
];

interface ZoomHudProps {
  zoom: number;
  /** Sets the zoom outright: fit and actual size, which say where the map scrolls to. */
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  /** A step in or out, about the middle of the canvas. */
  zoomTo: (to: (zoom: number) => number) => void;
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
  /** Whether any reached node carries an authority mode the lens could paint. */
  authorityAvailable?: boolean;
  /** Pixels the capability list covers on the left, so the HUD stays clear of it. */
  leftInset?: number;
  /** Pixels the detail panel covers on the right. */
  rightInset?: number;
  /**
   * Why a data lens is off when the reason is not that nothing was recorded:
   * the map is a past observation, which records neither attention nor grants.
   */
  lensNote?: string;
  /** The map's own controls beside zoom: the key, the timeline, the image. */
  tools?: React.ReactNode;
  /** What one of those tools opened, laid under the controls. */
  popover?: React.ReactNode;
}

export function ZoomHud({
  zoom,
  setZoom,
  zoomTo,
  containerRef,
  contentWidth,
  contentHeight,
  activeLens,
  onSetLens,
  attentionAvailable,
  authorityAvailable = true,
  leftInset = 0,
  rightInset = 0,
  lensNote,
  tools,
  popover,
}: ZoomHudProps) {
  const fit = () => {
    const el = containerRef.current;
    if (!el) return;
    // The room the canvas actually has: the scroller less its padding (the
    // headline's, and the panel insets) and the canvas's own top margin (the
    // HUD's). Dividing the scroller's whole height left the legend under the
    // bottom edge, on screen and in the README's picture of the whole tree.
    const box = getComputedStyle(el);
    const svg = el.querySelector('svg');
    const px = (v: string | undefined) => Number.parseFloat(v ?? '') || 0;
    const width = el.clientWidth - px(box.paddingLeft) - px(box.paddingRight);
    const height =
      el.clientHeight -
      px(box.paddingTop) -
      px(box.paddingBottom) -
      px(svg ? getComputedStyle(svg).marginTop : undefined);
    const fitRatio = Math.min(width / contentWidth, height / contentHeight);
    setZoom(Math.max(ZOOM_MIN, Math.min(1.5, +(fitRatio * 0.97).toFixed(2))));
    el.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
  };

  return (
    <div className="civ-hud" style={{ paddingLeft: 12 + leftInset, paddingRight: 12 + rightInset }}>
      <div className="civ-hud-left">
        <div className="civ-hud-row">
          <div className="civ-zoom-hud" role="toolbar" aria-label="Zoom">
            <button
              type="button"
              className="civ-zoom-btn"
              onClick={() => zoomTo(z => +(z - 0.2).toFixed(2))}
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
              onClick={() => zoomTo(z => +(z + 0.2).toFixed(2))}
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
              aria-label="Fit the whole map"
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
          {tools && (
            <div className="civ-zoom-hud" role="toolbar" aria-label="Map">
              {tools}
            </div>
          )}
        </div>
        {popover}
      </div>

      <div className="civ-lens-hud" role="toolbar" aria-label="Lens">
        {LENSES.map(([lens, label, hotkey]) => {
          const unavailable =
            (lens === 'attention' && !attentionAvailable) ||
            (lens === 'authority' && !authorityAvailable);
          return (
            <button
              key={lens}
              type="button"
              className={`app-deck-tab ${activeLens === lens ? 'app-deck-tab--active' : ''}`}
              aria-pressed={activeLens === lens}
              disabled={unavailable}
              onClick={() => onSetLens(lens)}
              title={
                unavailable && lensNote
                  ? lensNote
                  : unavailable && lens === 'authority'
                    ? 'No reached capability carries an authority mode yet. Run ambit seed, and ambit authority lists what may act without asking.'
                    : unavailable
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
