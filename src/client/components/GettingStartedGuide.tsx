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
        <strong>Getting Started</strong>
        <button type="button" className="app-guide-close" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
      <ol className="app-guide-steps">
        <li>
          <strong>Click any node</strong> to inspect dependencies, verified evidence, and blast
          radius.
        </li>
        <li>
          <strong>Outlined nodes</strong> are reachable next steps on your frontier — their
          description explains what is needed.
        </li>
        <li>
          <strong>Tech Tree</strong> visualizes evolutionary prerequisites;{' '}
          <strong>My Setup</strong> inspects discovered local tools and agents.
        </li>
      </ol>
      <button type="button" className="app-guide-more" onClick={onReadMore}>
        Read the concept guide →
      </button>
    </div>
  );
}
