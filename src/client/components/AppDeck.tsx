import type { Source, View } from '../linkState';
import type { ActiveLens } from '../store/ambitStore';

const LENSES = [
  ['default', 'Standard', '1'],
  ['attention', 'Attention', '2'],
  ['credentials', 'SPOFs', '3'],
] as const;

interface AppDeckProps {
  active: number;
  total: number;
  view: View;
  source: Source;
  /** Whether the store holds demo data; the loop tab only exists there. */
  demo: boolean;
  draftCount: number;
  activeLens: ActiveLens;
  leftOpen: boolean;
  onToggleSidebar: () => void;
  onShowTree: () => void;
  onShowSetup: () => void;
  onShowLoop: () => void;
  onShowProposals: () => void;
  onSetLens: (lens: ActiveLens) => void;
  onShowDocs: () => void;
}

/** The top bar: sidebar toggle, brand, reach count, the view tabs, the lenses. */
export default function AppDeck(p: AppDeckProps) {
  const tab = (on: boolean) => `app-deck-tab ${on ? 'app-deck-tab--active' : ''}`;
  return (
    <header className="app-deck">
      <div className="app-deck-left">
        <button
          type="button"
          className="app-deck-btn"
          onClick={p.onToggleSidebar}
          title="Toggle capabilities sidebar (Hotkey: \)"
        >
          <span style={{ fontSize: '12px' }}>{p.leftOpen ? '◧' : '◫'}</span>
          <span>Sidebar</span>
        </button>
        <div className="app-brand-group">
          <span className="app-brand">Ambit</span>
        </div>
        <div className="app-status-pill">
          <span className="app-status-dot" />
          <span>
            {p.active} / {p.total} active
          </span>
        </div>
      </div>

      <div className="app-deck-center">
        <nav className="app-deck-nav" aria-label="Primary Navigation">
          <button
            type="button"
            className={tab(p.view === 'graph' && p.source === 'tree')}
            onClick={p.onShowTree}
            title="The capability tech tree — prerequisites, frontier, and compound paths"
          >
            Tech Tree
          </button>
          <button
            type="button"
            className={tab(p.view === 'graph' && p.source === 'config')}
            onClick={p.onShowSetup}
            title="My Setup — discovered local runtimes, tools, and agents"
          >
            My Setup
          </button>
          {p.demo && (
            <button
              type="button"
              className={tab(p.view === 'loop')}
              onClick={p.onShowLoop}
              title="The Economic Loop — attention telemetry, ROI tracking, and ranked investments"
            >
              Economic Loop
            </button>
          )}
          <button
            type="button"
            className={`app-deck-btn ${p.draftCount > 0 ? 'app-deck-btn--alert' : ''}`}
            onClick={p.onShowProposals}
            title="Review and sign environment configuration proposals"
          >
            Proposals {p.draftCount > 0 && `(${p.draftCount})`}
          </button>
        </nav>
      </div>

      <div className="app-deck-right">
        {p.view === 'graph' && (
          <div className="app-deck-nav">
            {LENSES.map(([lens, label, hotkey]) => (
              <button
                key={lens}
                type="button"
                className={tab(p.activeLens === lens)}
                onClick={() => p.onSetLens(lens)}
                title={`Shortcut: Press ${hotkey}`}
              >
                {label}{' '}
                <span style={{ opacity: 0.5, fontSize: '10px', marginLeft: '4px' }}>
                  [{hotkey}]
                </span>
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="app-deck-btn"
          onClick={p.onShowDocs}
          title="Documentation & Concepts (Hotkey: ?)"
        >
          Docs
        </button>
      </div>
    </header>
  );
}
