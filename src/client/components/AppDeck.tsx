import type { View } from '../linkState';
import { ReachBar } from './figures';
import { Term } from './Term';

/** The three states of the map, counted over its nodes alone. */
export interface MapCounts {
  reached: number;
  next: number;
  blocked: number;
}

interface AppDeckProps {
  view: View;
  /** On the map: its nodes by state. Null on the other views, which count their own things. */
  counts: MapCounts | null;
  /** In My Setup: how many entries are enabled, of how many. */
  entries: { enabled: number; total: number } | null;
  /** Whether the live-update stream is attached. */
  connected: boolean;
  draftCount: number;
  /** The legend key lit on its own, if any; the header's segments light the same keys. */
  spotlight: string | null;
  onSpotlight: (group: string | null) => void;
  onSearch: () => void;
  onShowView: (view: View) => void;
  onShare: () => void;
  onShowProposals: () => void;
  onShowDocs: () => void;
}

/**
 * The header's count, on the map.
 *
 * It used to read "42 of 60 reached", counting the machine's entries in with
 * the tree's nodes and leading with the one state the glossary calls least
 * informative. The three segments count nodes alone, in the legend's order,
 * and each one is the same control as its legend key.
 */
const SEGMENTS: [keyof MapCounts, string][] = [
  ['reached', 'Reached'],
  ['next', 'Next step'],
  ['blocked', 'Blocked'],
];

/** The top bar: search, brand, the count for this view, the view tabs, share, proposals, docs. */
export default function AppDeck(p: AppDeckProps) {
  const tab = (on: boolean) => `app-deck-tab ${on ? 'app-deck-tab--active' : ''}`;
  const total = p.counts ? p.counts.reached + p.counts.next + p.counts.blocked : 0;
  return (
    <header className="app-deck">
      <div className="app-deck-left">
        <button
          type="button"
          className="app-deck-btn"
          onClick={p.onSearch}
          title="Find a capability on the map or in your setup (/)"
        >
          Search
          <kbd className="app-deck-key">/</kbd>
        </button>
        <div className="app-brand-group">
          <span className="app-brand">Ambit</span>
        </div>
        {p.counts && (
          <div className="app-status-pill" title="The map by state">
            <ReachBar reached={p.counts.reached} next={p.counts.next} total={total} />
            {SEGMENTS.map(([key, group]) => (
              <button
                key={key}
                type="button"
                className={`app-status-seg app-status-seg--${key} ${p.spotlight === group ? 'is-active' : ''}`}
                aria-pressed={p.spotlight === group}
                onClick={() => p.onSpotlight(p.spotlight === group ? null : group)}
                title={
                  p.spotlight === group ? 'Show every node again' : `Highlight ${group} on the map`
                }
              >
                <span className="app-status-n">{p.counts![key]}</span>
                {key === 'reached' ? <Term name="state">reached</Term> : group.toLowerCase()}
              </button>
            ))}
          </div>
        )}
        {p.entries && (
          <div className="app-status-pill">
            <span className="app-status-n">
              {p.entries.enabled} of {p.entries.total} enabled
            </span>
          </div>
        )}
        {p.connected && (
          <span
            className="app-live"
            title="Live: this map redraws itself when the graph is rebuilt — a seed, an adapter, another session"
          >
            <span className="app-live-dot" aria-hidden="true" />
            Live
          </span>
        )}
      </div>

      <div className="app-deck-center">
        <nav className="app-deck-nav" aria-label="View">
          <button
            type="button"
            className={tab(p.view === 'tree')}
            onClick={() => p.onShowView('tree')}
            title="The curated capability tree, with your position on it"
          >
            Map
          </button>
          <button
            type="button"
            className={tab(p.view === 'config')}
            onClick={() => p.onShowView('config')}
            title="The servers, agents and models found on this machine, and what each one provides"
          >
            My Setup
          </button>
          <button
            type="button"
            className={tab(p.view === 'loop')}
            onClick={() => p.onShowView('loop')}
            title="Where human attention goes, and what would pay back fastest"
          >
            Time &amp; cost
          </button>
        </nav>
      </div>

      <div className="app-deck-right">
        <button
          type="button"
          className="app-deck-btn"
          onClick={p.onShare}
          title="Copy a link that opens exactly this view — graph, node and lens"
        >
          Share
        </button>
        <button
          type="button"
          className={`app-deck-btn ${p.draftCount > 0 ? 'app-deck-btn--alert' : ''}`}
          onClick={p.onShowProposals}
          title="Changes an agent wants to make, waiting for your approval (g)"
        >
          Proposals
          {p.draftCount > 0 && <span className="app-deck-count">{p.draftCount}</span>}
        </button>
        <button
          type="button"
          className="app-deck-btn"
          onClick={p.onShowDocs}
          title="Every term on the map, defined (?)"
        >
          Docs
        </button>
      </div>
    </header>
  );
}
