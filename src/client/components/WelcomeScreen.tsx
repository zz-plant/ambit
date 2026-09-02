interface WelcomeProps {
  onExploreDemo: () => void;
  onViewLoop: () => void;
  onShowDocs: () => void;
}

/** What an empty graph shows: the pitch, the diagram, and the ways in. */
export default function WelcomeScreen({ onExploreDemo, onViewLoop, onShowDocs }: WelcomeProps) {
  return (
    <div className="app-welcome">
      <div className="app-welcome-hero">
        <div className="app-welcome-title">Ambit</div>
        <div className="app-welcome-tagline">
          Map your agent environment as a capability tech tree.
          <br />
          Audit blast radius, discover emergent combos, and govern changes safely.
        </div>
        <div className="app-welcome-diagram">
          <HeroDiagram />
        </div>
        <div className="app-welcome-actions">
          <button type="button" className="app-welcome-btn" onClick={onExploreDemo}>
            Explore Interactive Demo
          </button>
          <button
            type="button"
            className="app-welcome-btn app-welcome-btn-outline"
            onClick={onViewLoop}
          >
            View Economic Loop
          </button>
          <button
            type="button"
            className="app-welcome-btn app-welcome-btn-outline"
            onClick={onShowDocs}
          >
            Documentation
          </button>
          <a
            href="https://github.com/zz-plant/ambit"
            target="_blank"
            rel="noopener"
            className="app-welcome-btn app-welcome-btn-outline"
          >
            GitHub
          </a>
        </div>
        <div className="app-welcome-code">
          <code>node src/engine/engine.ts seed &amp;&amp; node src/engine/engine.ts status</code>
        </div>
        <div className="app-welcome-modes">
          <span>
            <em>LOAD DEMO</em> — a sample capability graph to click around
          </span>
          <span>
            <em>SEE THE LOOP</em> — where time goes, what to build next, what it paid back
          </span>
          <span>The real thing: Node 22, no dependencies — one command</span>
        </div>
      </div>
    </div>
  );
}

/** Config in, capability graph out: four nodes and the edges between them. */
function HeroDiagram() {
  const node = (cx: number, cy: number, r: number, stroke: string, fill: string, label: string) => (
    <>
      <circle cx={cx} cy={cy} r={r} fill="#1e293b" stroke={stroke} strokeWidth={2} />
      <text
        x={cx}
        y={cy + 4}
        textAnchor="middle"
        fill={fill}
        fontSize={r > 15 ? 11 : 10}
        fontWeight={r > 17 ? 700 : 600}
      >
        {label}
      </text>
    </>
  );
  const edge = (x1: number, y1: number, x2: number, y2: number, stroke: string) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={1.5} opacity={0.6} />
  );
  return (
    <svg width="340" height="110" viewBox="0 0 340 110">
      <title>How Ambit reads your setup: config in, capability graph out</title>
      <defs>
        <linearGradient id="heroGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4f46e5" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <rect
        x={0}
        y={0}
        width={340}
        height={110}
        rx={12}
        fill="#111827"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1}
      />
      {edge(60, 55, 150, 35, '#3b82f6')}
      {edge(150, 35, 260, 55, '#6366f1')}
      {edge(60, 55, 150, 75, '#10b981')}
      {edge(150, 75, 260, 55, '#10b981')}
      {node(60, 55, 16, '#3b82f6', '#93c5fd', 'LLM')}
      {node(150, 35, 14, '#6366f1', '#c7d2fe', 'MCP')}
      {node(150, 75, 14, '#10b981', '#a7f3d0', 'Tool')}
      {node(260, 55, 18, '#0ea5e9', '#7dd3fc', 'Goal')}
    </svg>
  );
}
