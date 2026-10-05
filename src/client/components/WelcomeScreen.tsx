import { useState } from 'react';
import { useConfigImport } from '../hooks/useConfigImport';
import { useCopied } from '../hooks/useCopied';
import { mergeGraphs } from '../store/ambitStore';
import { demoConfigGraph, demoTreeGraph } from '../store/demo';
import { INSTALL } from '../utils/copy';
import { BrandMark } from './BrandMark';
import { mapFindings } from './civ/layout';
import ConfigIntake from './ConfigIntake';

interface WelcomeProps {
  onExploreDemo: () => void;
  onViewLoop: () => void;
}

/**
 * The runtimes discovery reads, named on the front door. A visitor's first
 * question is whether this works with the tool they use, and the tagline alone
 * never said.
 */
const RUNTIMES = [
  'Claude Code',
  'Cursor',
  'OpenCode',
  'Windsurf',
  'Gemini CLI',
  'Claude Desktop',
  'Codex CLI',
];

/** The published docs, beside the app on the hosted site. */
const DOCS = `${import.meta.env.BASE_URL}docs/`;

/**
 * The sample setup's best next step and how much it would open, on the graph
 * the demo seeds and by the walk the map draws, so the number here is the one
 * the tour's first step then shows.
 */
function demoNextStep(): { name: string; reaches: number } | null {
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  const { best } = mapFindings(items, connections);
  return best ? { name: best.item.name, reaches: best.reaches } : null;
}

/**
 * What an empty graph shows: a question the visitor already has, one thing to
 * watch, and a place to put their own config.
 *
 * It opened on the product's name and a sentence about joint capability,
 * which is accurate and which nobody has felt; then on an outage, which sold
 * the guardrail as the product. It now opens on what the product is for: what
 * you and your agents can do, and what one more step would open, with the
 * word *ambit* defined where a visitor first meets it. Under that, one number
 * from the sample setup, how much its best next step would open, with a
 * button that shows it happening. What breaks if a piece goes is in the lede
 * and the tour, after it, as the half that makes widening safe.
 *
 * Then the visitor's own config, pasted or dropped, and last what a visitor
 * who is already convinced needs: the install line and the docs. Rendered
 * without the app chrome, so the first screen is not an empty search result.
 */
export default function WelcomeScreen({ onExploreDemo, onViewLoop }: WelcomeProps) {
  const { readFile, error: dropError } = useConfigImport();
  const [dropping, setDropping] = useState(false);
  const [copied, copy] = useCopied();
  const next = demoNextStep();

  return (
    // The whole page takes a dropped file, so there is no target to aim at;
    // the paste box and its file button are the keyboard path.
    <main
      className={`app-welcome ${dropping ? 'is-over' : ''}`}
      onDragOver={e => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={e => {
        // Moving onto a child fires this too; only leaving the page counts.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={e => {
        e.preventDefault();
        setDropping(false);
        readFile(e.dataTransfer.files[0]);
      }}
    >
      <div className="app-welcome-hero">
        <div className="app-welcome-brand">
          <BrandMark size={28} />
          <span>Ambit</span>
        </div>
        <h1 className="app-welcome-title">
          What can you and your agents do, and what would one more step open up?
        </h1>
        <p className="app-welcome-lede">
          That reach is your <em>ambit</em>. Ambit reads the configs of {RUNTIMES.join(', ')} and
          four more, and draws it as one map: what works, which next step would open the most, and
          what stops if a piece goes away.
        </p>

        {next && (
          <button type="button" className="app-welcome-fact" onClick={onExploreDemo}>
            <span className="app-welcome-fact-figure">{next.reaches}</span>
            <span className="app-welcome-fact-text">
              more things a sample developer&apos;s agents could do once {next.name} is set up.
              <strong className="app-welcome-fact-go">Watch it open →</strong>
            </span>
          </button>
        )}

        <div className="app-welcome-yours">
          <h2>Or map your own config</h2>
          <ConfigIntake />
          {dropError && (
            <p className="intake-error" role="alert">
              {dropError}
            </p>
          )}
        </div>

        <div className="app-welcome-install">
          <code className="app-welcome-cmd">{INSTALL}</code>
          <button
            type="button"
            className="app-welcome-copy"
            onClick={() => copy('install', INSTALL)}
            aria-label="Copy the install command"
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
        <p className="app-welcome-local">
          Runs the CLI with nothing installed, and maps every runtime on the machine. Homebrew and{' '}
          <code>npm install -g ambit-cli</code> keep it.
        </p>
        <nav className="app-welcome-more" aria-label="Read more">
          <button type="button" className="app-welcome-link" onClick={onViewLoop}>
            Time &amp; cost
          </button>
          <a href={`${DOCS}loadout/`}>Your loadout, from A to B</a>
          <a href={`${DOCS}guide/`}>Guide</a>
          <a href={`${DOCS}faq/`}>What it reads, and what leaves your machine</a>
          <a href="https://github.com/zz-plant/ambit" rel="noopener">
            Source on GitHub
          </a>
        </nav>
      </div>
    </main>
  );
}
