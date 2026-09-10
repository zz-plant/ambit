import type { CSSProperties } from 'react';

interface GuideProps {
  /** Undefined on narrow screens, where the guide is not inset by the panels. */
  style?: CSSProperties;
  onDismiss: () => void;
  onReadMore: () => void;
}

/** The three-step first-run card, shown once over the map. */
export default function GettingStartedGuide({ style, onDismiss, onReadMore }: GuideProps) {
  return (
    <div className="app-guide" style={style}>
      <div className="app-guide-head">
        <strong>Reading the map</strong>
        <button type="button" className="app-guide-close" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
      <ol className="app-guide-steps">
        <li>
          <strong>Click a node</strong> for what depends on it, whether its check passes, and a
          simulation: what stops working without it.
        </li>
        <li>
          <strong>Click a faded one</strong> — those are not reached — and the simulation runs the
          other way: everything it would unlock.
        </li>
        <li>
          <strong>Click a key in the legend</strong> to highlight just that kind.{' '}
          <strong>Share</strong> copies a link that opens the view you are looking at.
        </li>
      </ol>
      <button type="button" className="app-guide-more" onClick={onReadMore}>
        Every term, defined →
      </button>
    </div>
  );
}
