import { useRef, useState } from 'react';
import { useCopied } from '../hooks/useCopied';
import { useAmbitStore } from '../store/ambitStore';
import { BrandMark } from './BrandMark';
import { demoTreeGraph } from '../store/demo';
import { TAGLINE } from '../utils/copy';
import { demoSnapshot } from '../utils/demoSnapshot';
import { eraProgress } from './civ/layout';
import { EraStrip, HoursSparkline, NUM } from './figures';

interface WelcomeProps {
  onExploreDemo: () => void;
  onViewLoop: () => void;
}

/** What a dropped file may be, and how big one of those ever is. */
const MAX_CONFIG_BYTES = 2_000_000;

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

/** The one-line install the README leads with. */
const INSTALL = 'brew install zz-plant/tap/ambit && ambit';

/** The published docs, beside the app on the hosted site. */
const DOCS = `${import.meta.env.BASE_URL}docs/`;

/**
 * What an empty graph shows: what Ambit is, the ways in, and two real figures.
 *
 * The front door used to carry a cartoon — four circles labelled LLM, MCP,
 * Tool, Goal — for a product whose whole claim is that it measures things. It
 * now shows the two measurements the product makes, drawn from the same example
 * data the demo runs on and labelled as such: where a person's hours went over
 * a year, and how much of each era is reached.
 *
 * The order is the order of a visitor's questions. What is it, and does it read
 * the tool I use: the tagline never said, and the sentence under it names the
 * runtimes. Can I try it: the demo, and mapping their own config, sit directly
 * under that, above the figures, so on a phone the way in is on the first
 * screen and not under two charts. Then the evidence, and last what a visitor
 * who is already convinced needs: the install line and the docs, which the page
 * used to link nowhere. Rendered without the app chrome, so the first screen
 * is not an empty search result.
 */
export default function WelcomeScreen({ onExploreDemo, onViewLoop }: WelcomeProps) {
  const loadFromJSON = useAmbitStore(s => s.loadFromJSON);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [copied, copy] = useCopied();

  /**
   * Map a config the visitor hands over, in their own browser.
   *
   * The store could already draw a graph from JSON and nothing ever called it,
   * so the answer to "what does this look like for *my* setup" was "clone the
   * repository". Reading the file here needs no engine and no upload: it is
   * parsed in the tab and never sent anywhere.
   */
  const readConfigFile = async (file: File | undefined) => {
    if (!file) return;
    setDropError(null);
    if (file.size > MAX_CONFIG_BYTES) {
      setDropError('That file is far larger than an agent config. Nothing was read.');
      return;
    }
    const ok = loadFromJSON(await file.text());
    if (!ok) {
      setDropError(
        'That is not an agent config or an `ambit graph` export — nothing in it to map.'
      );
    }
  };

  const snapshot = demoSnapshot();
  const eras = eraProgress(demoTreeGraph().items);
  const reached = eras.reduce((n, e) => n + e.reached, 0);
  const total = eras.reduce((n, e) => n + e.total, 0);
  const series = snapshot.roi.monthly_hours;
  const first = series[0];
  const last = series[series.length - 1];

  return (
    // The whole page takes a dropped file, so there is no target to aim at;
    // the "Map your own config" button is the keyboard path.
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
        readConfigFile(e.dataTransfer.files[0]);
      }}
    >
      <div className="app-welcome-hero">
        <div className="app-welcome-emblem" aria-hidden="true">
          <BrandMark size={48} />
        </div>
        <h1 className="app-welcome-title">Ambit</h1>
        <p className="app-welcome-tagline">{TAGLINE}</p>
        <p className="app-welcome-lede">
          It reads the configs of {RUNTIMES.slice(0, -1).join(', ')} and {RUNTIMES.at(-1)} into one
          map: what works, what breaks if a piece goes away, and what is worth setting up next. The
          graph is a file on your machine.
        </p>

        <div className="app-welcome-actions">
          <button type="button" className="app-welcome-btn" onClick={onExploreDemo}>
            Open the demo
          </button>
          <button
            type="button"
            className="app-welcome-link"
            onClick={() => fileInput.current?.click()}
            title="Read an agent config in this tab and draw it. Nothing is uploaded."
          >
            Map your own config
          </button>
          <button
            type="button"
            className="app-welcome-link"
            onClick={onViewLoop}
            title="Time & cost: where human attention goes, and what would pay back fastest"
          >
            Time &amp; cost
          </button>
        </div>
        <p className="app-welcome-drophint">
          Or drop an <code>opencode.json</code>, or any agent config, anywhere on this page. It is
          read in this tab and never uploaded.
        </p>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="Choose an agent config file to map"
          className="visually-hidden"
          onChange={e => readConfigFile(e.target.files?.[0])}
        />
        {dropError && (
          <p className="app-welcome-droperr" role="alert">
            {dropError}
          </p>
        )}

        <div className="app-welcome-figures">
          <figure className="welcome-fig">
            <figcaption className="welcome-fig-caption">
              <span className="welcome-fig-title">Hours a person spent stepping in</span>
              <span className="welcome-fig-note" style={NUM}>
                {first.month} {first.hours}h → {last.month} {last.hours}h · each drop is a
                capability that landed
              </span>
            </figcaption>
            <HoursSparkline series={series} width={420} height={112} annotate />
          </figure>

          <figure className="welcome-fig">
            <figcaption className="welcome-fig-caption">
              <span className="welcome-fig-title">How much of each era is reached</span>
              <span className="welcome-fig-note" style={NUM}>
                {reached} of {total} on the tree · hollow is a next step
              </span>
            </figcaption>
            <EraStrip eras={eras} />
          </figure>
        </div>
        <p className="app-welcome-disclose">
          Both figures are example data, the same setup the demo opens on.
        </p>

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
          That installs the CLI and the MCP server. For the map of your own machine, clone the
          repository and run <code>./bootstrap.sh web</code>.
        </p>
        <nav className="app-welcome-more" aria-label="Read more">
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
