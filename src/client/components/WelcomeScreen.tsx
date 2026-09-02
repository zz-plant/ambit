import { TAGLINE } from '../utils/copy';

interface WelcomeProps {
  onExploreDemo: () => void;
  onViewLoop: () => void;
  onShowDocs: () => void;
}

/**
 * What an empty graph shows: the pitch, the diagram, and one way in.
 *
 * Rendered without the app chrome — no capability list, no status pill — so
 * the first screen is not an empty search result. One button; the rest are
 * links, because four equal buttons gave a visitor four decisions before they
 * had seen anything.
 */
export default function WelcomeScreen({ onExploreDemo, onViewLoop, onShowDocs }: WelcomeProps) {
  return (
    <main className="app-welcome">
      <div className="app-welcome-hero">
        <h1 className="app-welcome-title">Ambit</h1>
        <p className="app-welcome-tagline">{TAGLINE}</p>
        <div className="app-welcome-diagram">
          <HeroDiagram />
        </div>
        <div className="app-welcome-actions">
          <button type="button" className="app-welcome-btn" onClick={onExploreDemo}>
            Open the demo
          </button>
          <button type="button" className="app-welcome-link" onClick={onViewLoop}>
            Where the time goes
          </button>
          <button type="button" className="app-welcome-link" onClick={onShowDocs}>
            How to read the map
          </button>
          <a
            href="https://github.com/zz-plant/ambit"
            target="_blank"
            rel="noopener"
            className="app-welcome-link"
          >
            GitHub
          </a>
        </div>
        <p className="app-welcome-local">
          The demo runs on example data. To map your own machine, clone the repository and run{' '}
          <code>./bootstrap.sh web</code>.
        </p>
      </div>
    </main>
  );
}

/** Config in, capability graph out: four nodes and the edges between them. */
function HeroDiagram() {
  const node = (cx: number, cy: number, r: number, stroke: string, label: string) => (
    <>
      <circle cx={cx} cy={cy} r={r} fill="var(--bg-elevated)" stroke={stroke} strokeWidth={2} />
      <text
        x={cx}
        y={cy + 4}
        textAnchor="middle"
        fill="var(--text-primary)"
        fontSize={r > 15 ? 11 : 10}
        fontWeight={600}
        fontFamily="var(--font-sans)"
      >
        {label}
      </text>
    </>
  );
  const edge = (x1: number, y1: number, x2: number, y2: number, stroke: string) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={1.5} opacity={0.7} />
  );
  return (
    <svg width="340" height="110" viewBox="0 0 340 110" aria-hidden="true">
      <title>How Ambit reads your setup: config in, capability graph out</title>
      <rect
        x={0.5}
        y={0.5}
        width={339}
        height={109}
        rx={12}
        fill="var(--bg-surface)"
        stroke="var(--border)"
        strokeWidth={1}
      />
      {edge(60, 55, 150, 35, 'var(--type-model)')}
      {edge(150, 35, 260, 55, 'var(--type-framework)')}
      {edge(60, 55, 150, 75, 'var(--type-skill)')}
      {edge(150, 75, 260, 55, 'var(--type-skill)')}
      {node(60, 55, 16, 'var(--type-model)', 'LLM')}
      {node(150, 35, 14, 'var(--type-framework)', 'MCP')}
      {node(150, 75, 14, 'var(--type-skill)', 'Tool')}
      {node(260, 55, 18, 'var(--type-network)', 'Goal')}
    </svg>
  );
}
