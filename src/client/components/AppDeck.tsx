import type { Source, View } from '../linkState';

interface AppDeckProps {
  reached: number;
  total: number;
  view: View;
  source: Source;
  /** Whether the store holds demo data; the time-and-cost tab only exists there. */
  demo: boolean;
  draftCount: number;
  leftOpen: boolean;
  onToggleSidebar: () => void;
  onShowTree: () => void;
  onShowSetup: () => void;
  onShowLoop: () => void;
  onShowProposals: () => void;
  onShowDocs: () => void;
}

/** The top bar: list toggle, brand, reach count, the view tabs, proposals, docs. */
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
          title="Show or hide the capability list (\\)"
        >
          <span aria-hidden="true" style={{ fontSize: '12px' }}>
            {p.leftOpen ? '◧' : '◫'}
          </span>
          <span>List</span>
        </button>
        <div className="app-brand-group">
          <span className="app-brand">Ambit</span>
        </div>
        <div className="app-status-pill" title="Capabilities something in this setup provides">
          <span className="app-status-dot" />
          <span>
            {p.reached} of {p.total} reached
          </span>
        </div>
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
          {p.demo && (
            <button
              type="button"
              className={tab(p.view === 'loop')}
              onClick={p.onShowLoop}
              title="Where human attention goes, and what would pay back fastest"
            >
              Time &amp; cost
            </button>
          )}
        </nav>
      </div>

      <div className="app-deck-right">
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
