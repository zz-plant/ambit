import { useMemo, useState } from 'react';
import { useConfigImport } from '../hooks/useConfigImport';
import { useCopied } from '../hooks/useCopied';
import { mergeGraphs } from '../store/ambitStore';
import { demoConfigGraph, demoTreeGraph } from '../store/demo';
import { INSTALL } from '../utils/copy';
import { demoSnapshot } from '../utils/demoSnapshot';
import { BrandMark } from './BrandMark';
import { bandSpan, COL_W, columnCentre, isEntry, mapFindings, unlockCascade } from './civ/layout';
import { MapStill, stillLayout } from './civ/MapScene';
import ConfigIntake from './ConfigIntake';

interface WelcomeProps {
  onExploreDemo: () => void;
  onViewLoop: () => void;
  /** A config was read; the map it was placed on is the caller's to show. */
  onMapped: () => void;
}

/**
 * The runtimes discovery reads, named on the front door. A visitor's first
 * question is whether this works with the tool they use, and the tagline alone
 * never said.
 */
export const RUNTIMES = [
  'Claude Code',
  'Cursor',
  'OpenCode',
  'Windsurf',
  'Gemini CLI',
  'Claude Desktop',
  'Codex CLI',
];

/**
 * How many runtimes discovery reads in all, so the lede's "and N more" is
 * counted. The page cannot import the engine's readers; welcome.test.tsx holds
 * this to them, since the hand-written "four more" outlived a fifth.
 */
export const RUNTIMES_READ = 16;

/** The published docs, beside the app on the hosted site. */
const DOCS = `${import.meta.env.BASE_URL}docs/`;

/**
 * The sample setup's best next step, how much it would open, and where the
 * setup stands before and after it, on the graph the demo seeds and by the
 * walk the map draws, so the number here is the one the tour's first step
 * then shows. "More than what?" had no answer: a bare delta left the reader
 * to guess at a denominator, so the card carries the baseline it is a delta
 * from. With it, a still of the columns it lights, for a wide screen: the
 * front door was all words, and a screenshot of it showed no product.
 */
function demoNextStep() {
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  const { best } = mapFindings(
    items,
    connections,
    demoSnapshot().next.map(n => n.id)
  );
  if (!best) return null;
  const tree = items.filter(i => !isEntry(i));
  const layout = stillLayout(items, connections);
  const cascade = unlockCascade(items, connections, best.item.id);
  const lit = [best.item.id, ...cascade].flatMap(id => layout.positions.get(id) ?? []);
  const column = (x: number) => Math.round((x - columnCentre(0)) / COL_W);
  const first = Math.min(...lit.map(p => column(p.x)));
  const last = Math.max(...lit.map(p => column(p.x)));
  const left = bandSpan(first).left - 24;
  return {
    name: best.item.name,
    reaches: best.reaches,
    /** Reached, and the tree's size: the two halves of the baseline. */
    reached: tree.filter(i => i.status === 'built').length,
    total: tree.length,
    still: {
      items,
      connections,
      layout,
      simulation: { mode: 'acquisition', rootId: best.item.id, cascade },
      crop: { x: left, y: 0, width: bandSpan(last).right + 24 - left, height: layout.height },
    },
  };
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
export default function WelcomeScreen({ onExploreDemo, onViewLoop, onMapped }: WelcomeProps) {
  const { readFile, error: dropError } = useConfigImport(onMapped);
  const [dropping, setDropping] = useState(false);
  const [copied, copy] = useCopied();
  const next = useMemo(demoNextStep, []);

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
          Ambit reads the configs of {RUNTIMES_READ} agent runtimes, including {RUNTIMES[0]},{' '}
          {RUNTIMES[1]}, {RUNTIMES[2]} and {RUNTIMES[3]}, and draws what they add up to as one map:
          what works, which next step would open the most, and what stops if a piece goes away. That
          reach is your <em>ambit</em>.
        </p>

        {next && (
          <button type="button" className="app-welcome-fact" onClick={onExploreDemo}>
            <span className="app-welcome-fact-figure">{next.reaches}</span>
            <span className="app-welcome-fact-text">
              more capabilities a sample developer&apos;s agents would reach once {next.name} is set
              up: {next.reached} of {next.total} today, {next.reached + next.reaches} after.
              <strong className="app-welcome-fact-go">Watch it open →</strong>
            </span>
          </button>
        )}

        <div className="app-welcome-yours">
          <h2>Or map your own config</h2>
          <ConfigIntake onMapped={onMapped} />
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
          No install needed: npx fetches it for the run, and it maps every runtime on this machine.
          To keep the command, install with Homebrew or <code>npm install -g ambit-cli</code>.
        </p>
        <nav className="app-welcome-more" aria-label="Read more">
          <button type="button" className="app-welcome-link" onClick={onViewLoop}>
            Time &amp; authority
          </button>
          <a href={`${DOCS}guide/`}>Get started</a>
          <a href={`${DOCS}faq/`}>What stays on your machine</a>
          <a href={`${DOCS}loadout/`}>From configs to work done</a>
          <a href={`${DOCS}mcp-outage/`}>What breaks if a server goes</a>
          <a href={`${DOCS}compare/`}>Ambit and MCP gateways</a>
          <a href="https://github.com/zz-plant/ambit" rel="noopener">
            Source on GitHub
          </a>
        </nav>
      </div>
      {/* On a wide screen, the step the fact names, already lit: the button
          beside it plays it on the live map. Hidden on a narrow one, where
          the hero is the whole width. */}
      {next && (
        <button
          type="button"
          className="app-welcome-still"
          onClick={onExploreDemo}
          aria-label={`Watch ${next.name} open on the sample map`}
        >
          <MapStill {...next.still} />
        </button>
      )}
    </main>
  );
}
