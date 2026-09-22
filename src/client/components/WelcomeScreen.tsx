import { useRef, useState } from 'react';
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
  onShowDocs: (tab?: 'concepts' | 'reading' | 'doing' | 'hotkeys') => void;
}

/** What a dropped file may be, and how big one of those ever is. */
const MAX_CONFIG_BYTES = 2_000_000;

/**
 * What an empty graph shows: the pitch, two real figures, and one way in.
 *
 * The front door used to carry a cartoon — four circles labelled LLM, MCP,
 * Tool, Goal — for a product whose whole claim is that it measures things. It
 * now shows the two measurements the product makes, drawn from the same example
 * data the demo runs on and labelled as such: where a person's hours went over
 * a year, and how much of each era is reached. A visitor sees the sensibility
 * before they see a button.
 *
 * Rendered without the app chrome — no capability list, no status pill — so
 * the first screen is not an empty search result. One button; the rest are
 * links, because four equal buttons gave a visitor four decisions before they
 * had seen anything.
 */
export default function WelcomeScreen({ onExploreDemo, onViewLoop, onShowDocs }: WelcomeProps) {
  const loadFromJSON = useAmbitStore(s => s.loadFromJSON);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

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
    <main className="app-welcome">
      <div className="app-welcome-hero">
        <div className="app-welcome-emblem" aria-hidden="true">
          <BrandMark size={48} />
        </div>
        <h1 className="app-welcome-title">Ambit</h1>
        <p className="app-welcome-tagline">{TAGLINE}</p>

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

        <div className="app-welcome-actions">
          <button type="button" className="app-welcome-btn" onClick={onExploreDemo}>
            Open the demo
          </button>
          <button
            type="button"
            className="app-welcome-link"
            onClick={onViewLoop}
            title="Time & cost: where human attention goes, and what would pay back fastest"
          >
            Time &amp; cost
          </button>
          <button
            type="button"
            className="app-welcome-link"
            onClick={() => onShowDocs('reading')}
            title="How to read the map: eras, circles, and prerequisites"
          >
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
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop zone; the button inside it is the keyboard path */}
        <div
          className={`app-welcome-drop ${dropping ? 'is-over' : ''}`}
          onDragOver={e => {
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={e => {
            e.preventDefault();
            setDropping(false);
            readConfigFile(e.dataTransfer.files[0]);
          }}
        >
          <div className="app-welcome-drop-icon" aria-hidden="true">
            <svg
              width="32"
              height="32"
              viewBox="0 0 36 36"
              fill="none"
              stroke="currentColor"
              aria-hidden="true"
            >
              <rect
                x="5"
                y="7"
                width="16"
                height="22"
                rx="3"
                strokeWidth="1.6"
                strokeDasharray="3 2"
              />
              <path d="M9 13 H17 M9 17 H14" strokeWidth="1.6" strokeLinecap="round" />
              <path
                d="M22 18 H29 M29 18 L26 15 M29 18 L26 21"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="30" cy="18" r="2" fill="currentColor" />
            </svg>
          </div>
          <div className="app-welcome-drop-text">
            <p>
              Both figures are example data.{' '}
              <button
                type="button"
                className="app-welcome-link"
                onClick={() => fileInput.current?.click()}
              >
                Map your own config
              </button>{' '}
              — drop an <code>opencode.json</code> here, or any agent config. It is read in this tab
              and never uploaded.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="visually-hidden"
              onChange={e => readConfigFile(e.target.files?.[0])}
            />
            {dropError && <p className="app-welcome-droperr">{dropError}</p>}
            <p className="app-welcome-local">
              For the full picture — verification, proposals, the ledger — clone the repository and
              run <code>./bootstrap.sh web</code>.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
