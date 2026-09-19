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
          aria-label="Search capabilities"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            className="app-deck-icon"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11 L14.5 14.5" />
          </svg>
          <span className="app-deck-btn-label">Search</span>
          <kbd className="app-deck-key">/</kbd>
        </button>
        <div className="app-brand-group">
          <svg
            width="18"
            height="18"
            viewBox="0 0 64 64"
            fill="none"
            className="app-brand-mark"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="ambit-brand-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#0284c7" />
              </linearGradient>
            </defs>
            <rect width="64" height="64" rx="14" fill="url(#ambit-brand-grad)" />
            <g stroke="#ffffff" strokeLinecap="round">
              <path d="M14 50 L32 14 L50 50" strokeWidth="8.5" />
              <path d="M21 40 H43" strokeWidth="7.5" />
            </g>
            <circle cx="32" cy="14" r="7.5" fill="#ffffff" />
            <circle cx="14" cy="50" r="6.5" fill="#ffffff" />
            <circle cx="50" cy="50" r="6.5" fill="#ffffff" />
          </svg>
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
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="app-tab-icon"
              aria-hidden="true"
            >
              <circle cx="4" cy="12" r="2" />
              <circle cx="12" cy="4" r="2" />
              <circle cx="12" cy="12" r="2" />
              <path d="M5.5 10.5 L10.5 5.5 M6 12 H10" />
            </svg>
            <span>Map</span>
          </button>
          <button
            type="button"
            className={tab(p.view === 'config')}
            onClick={() => p.onShowView('config')}
            title="The servers, agents and models found on this machine, and what each one provides"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="app-tab-icon"
              aria-hidden="true"
            >
              <rect x="2" y="3" width="12" height="3" rx="1" />
              <rect x="2" y="10" width="12" height="3" rx="1" />
              <circle cx="5" cy="4.5" r="0.75" fill="currentColor" />
              <circle cx="11" cy="11.5" r="0.75" fill="currentColor" />
            </svg>
            <span>My Setup</span>
          </button>
          <button
            type="button"
            className={tab(p.view === 'loop')}
            onClick={() => p.onShowView('loop')}
            title="Where human attention goes, and what would pay back fastest"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="app-tab-icon"
              aria-hidden="true"
            >
              <path d="M2 12 L6 8 L9 11 L14 4" />
              <circle cx="14" cy="4" r="1.5" fill="currentColor" />
            </svg>
            <span>Time &amp; cost</span>
          </button>
        </nav>
      </div>

      <div className="app-deck-right">
        <button
          type="button"
          className="app-deck-btn"
          onClick={p.onShare}
          title="Copy a link that opens exactly this view — graph, node and lens"
          aria-label="Share view link"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="app-deck-icon"
            aria-hidden="true"
          >
            <circle cx="4" cy="8" r="2" />
            <circle cx="12" cy="4" r="2" />
            <circle cx="12" cy="12" r="2" />
            <path d="M5.8 7.1 L10.2 4.9 M5.8 8.9 L10.2 11.1" />
          </svg>
          <span className="app-deck-btn-label">Share</span>
        </button>
        <button
          type="button"
          className={`app-deck-btn ${p.draftCount > 0 ? 'app-deck-btn--alert' : ''}`}
          onClick={p.onShowProposals}
          title="Changes an agent wants to make, waiting for your approval (g)"
          aria-label={p.draftCount > 0 ? `Proposals (${p.draftCount} waiting)` : 'Proposals'}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="app-deck-icon"
            aria-hidden="true"
          >
            <path d="M3 2 H10 L13 5 V14 H3 Z" />
            <path d="M9 2 V5 H13" />
          </svg>
          <span className="app-deck-btn-label">Proposals</span>
          {p.draftCount > 0 && <span className="app-deck-count">{p.draftCount}</span>}
        </button>
        <button
          type="button"
          className="app-deck-btn"
          onClick={p.onShowDocs}
          title="Every term on the map, defined (?)"
          aria-label="Documentation and glossary"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="app-deck-icon"
            aria-hidden="true"
          >
            <path d="M2 3.5 C2 2.7 2.7 2 3.5 2 H7.5 V14 H3.5 C2.7 14 2 13.3 2 12.5 Z M14 3.5 C14 2.7 13.3 2 12.5 2 H8.5 V14 H12.5 C13.3 14 14 13.3 14 12.5 Z" />
          </svg>
          <span className="app-deck-btn-label">Docs</span>
        </button>
      </div>
    </header>
  );
}
