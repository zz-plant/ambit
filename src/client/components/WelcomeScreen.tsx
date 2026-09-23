import { useState } from 'react';
import { useConfigImport } from '../hooks/useConfigImport';
import { useCopied } from '../hooks/useCopied';
import { mergeGraphs } from '../store/ambitStore';
import { COLD_OPEN_PLAIN, coldOpen, demoConfigGraph, demoTreeGraph } from '../store/demo';
import { INSTALL, TAGLINE } from '../utils/copy';
import { BrandMark } from './BrandMark';
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
 * How many things the sample's agents do every day stop with the demo's
 * opening outage, on the graph the demo seeds and by the walk the map draws,
 * so the number here is the one the tour then shows.
 */
function coldOpenStopped(): number {
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  return coldOpen(items, connections)?.stopped.length ?? 0;
}

/**
 * What an empty graph shows: a question the visitor already has, one thing to
 * watch, and a place to put their own config.
 *
 * It opened on the product's name and a sentence about joint capability,
 * which is accurate and which nobody has felt. It now opens on the afternoon
 * everyone has had, when one piece of an agent setup stopped and it was not
 * clear what else stopped with it. Under that, one number from the sample
 * setup, counting only what was working, with a button that shows it happening: the product's claim,
 * demonstrated in a click. The two charts that sat here were example data a
 * visitor had to read a caption to understand, and they are gone.
 *
 * Then the visitor's own config, pasted or dropped, and last what a visitor
 * who is already convinced needs: the install line and the docs. Rendered
 * without the app chrome, so the first screen is not an empty search result.
 */
export default function WelcomeScreen({ onExploreDemo, onViewLoop }: WelcomeProps) {
  const { readFile, error: dropError } = useConfigImport();
  const [dropping, setDropping] = useState(false);
  const [copied, copy] = useCopied();
  const stopped = coldOpenStopped();

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
          When one piece of your agent setup breaks, what breaks with it?
        </h1>
        <p className="app-welcome-tagline">{TAGLINE}</p>
        <p className="app-welcome-lede">
          It reads the configs of {RUNTIMES.slice(0, -1).join(', ')} and {RUNTIMES.at(-1)} into one
          map: what works, what breaks if a piece goes away, and what is worth setting up next.
        </p>

        <button type="button" className="app-welcome-fact" onClick={onExploreDemo}>
          <span className="app-welcome-fact-figure">{stopped}</span>
          <span className="app-welcome-fact-text">
            things a sample developer&apos;s agents do every day stop when {COLD_OPEN_PLAIN} go
            down. <strong>Watch it happen →</strong>
          </span>
        </button>

        <div className="app-welcome-yours">
          <h2>Or map your own, in this tab</h2>
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
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="app-welcome-local">
          That installs the CLI and the MCP server, and maps every runtime on the machine onto the
          full tree.
        </p>
        <nav className="app-welcome-more" aria-label="Read more">
          <button type="button" className="app-welcome-link" onClick={onViewLoop}>
            Time &amp; cost
          </button>
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
