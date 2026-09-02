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
          <strong>Click a node</strong> to see what it depends on, what depends on it, and whether
          its check passes.
        </li>
        <li>
          <strong>Outlined nodes</strong> are one step away: their prerequisites are met and nothing
          provides them yet.
        </li>
        <li>
          <strong>Tech Tree</strong> is the curated tree with your position on it.{' '}
          <strong>My Setup</strong> is what was found on this machine.
        </li>
      </ol>
      <button type="button" className="app-guide-more" onClick={onReadMore}>
        Every term, defined →
      </button>
    </div>
  );
}
