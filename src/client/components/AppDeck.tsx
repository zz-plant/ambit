import type { Source, View } from '../linkState';
import { ReachBar } from './figures';
import { Term } from './Term';

interface AppDeckProps {
  reached: number;
  /** Capabilities whose prerequisites are met and nothing yet provides. */
  next: number;
  total: number;
  view: View;
  source: Source;
  /** Whether the live-update stream is attached. */
  connected: boolean;
  draftCount: number;
  leftOpen: boolean;
  onToggleSidebar: () => void;
  onShare: () => void;
  onShowTree: () => void;
  onShowSetup: () => void;
  onShowLoop: () => void;
  onShowProposals: () => void;
  onShowDocs: () => void;
}

/** The top bar: list toggle, brand, reach count, the view tabs, share, proposals, docs. */
export default function AppDeck(p: AppDeckProps) {
  const tab = (on: boolean) => `app-deck-tab ${on ? 'app-deck-tab--active' : ''}`;
  return (
    <header className="app-deck">
      <div className="app-deck-left">
        <button
          type="button"
          className="app-deck-btn"
          onClick={p.onToggleSidebar}
          aria-pressed={p.leftOpen}
          title="Show or hide the capabilities panel (\\)"
        >
          <span aria-hidden="true" style={{ fontSize: '12px' }}>
            {p.leftOpen ? '◧' : '◫'}
          </span>
          <span>Capabilities</span>
        </button>
        <div className="app-brand-group">
          <span className="app-brand">Ambit</span>
        </div>
        {/* The same fraction the words state, drawn first. The green dot that
            stood here encoded nothing; a bar on the graph's own total does. */}
        <div
          className="app-status-pill"
          title={`${p.reached} reached · ${p.next} next step · ${p.total - p.reached - p.next} blocked`}
        >
          <ReachBar reached={p.reached} next={p.next} total={p.total} />
          <span className="app-status-n">
            {p.reached} of {p.total} <Term name="state">reached</Term>
          </span>
        </div>
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
            className={tab(p.view === 'graph' && p.source === 'tree')}
            onClick={p.onShowTree}
            title="The curated capability tree, with your position on it"
          >
            Tech Tree
          </button>
          <button
            type="button"
            className={tab(p.view === 'graph' && p.source === 'config')}
            onClick={p.onShowSetup}
            title="The servers, agents and models found on this machine"
          >
            My Setup
          </button>
          <button
            type="button"
            className={tab(p.view === 'loop')}
            onClick={p.onShowLoop}
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
          title="Copy a link that opens exactly this view — graph, node, lens and filter"
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
