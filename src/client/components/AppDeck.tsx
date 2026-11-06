import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { View } from '../linkState';
import type { Item } from '../utils/configImporter';
import { BrandMark } from './BrandMark';
import { isFailing, isNext, isProven } from './civ/layout';
import { ReachBar } from './figures';
import { termTitle } from './Term';
import { Icon } from './Icon';

/** The view's landmark, where the skip link and a finished tour send the keyboard. */
export const VIEW_ID = 'view';

/**
 * The map's nodes, counted over the nodes alone. Reached is split by the
 * evidence behind it: verified has a passing check, unproven is configured
 * with none or recovering, its last check passed after one that failed. A node
 * whose last check failed is configured and not working, so it is counted
 * apart and is not reached, as the era headers count it.
 */
export interface MapCounts {
  verified: number;
  unproven: number;
  failing: number;
  next: number;
  blocked: number;
  /**
   * Set when the map on screen is an observation that recorded no lifecycles.
   * Reached cannot be split by evidence then, so it is one count, and verified
   * and unproven are not drawn: a zero nobody measured is not a value.
   */
  reached?: number;
}

/**
 * The counts the pill shows, from the nodes the map draws. The failing node
 * was filed under unproven, so on the demo the pill said 13 verified and 3
 * unproven, 16 reached, over era headers that added up to 15 reached and 1
 * failing. `split` is false for an observation that recorded no lifecycles.
 */
export function mapCounts(nodes: Item[], split = true): MapCounts {
  const reached = nodes.filter(i => i.status === 'built');
  const counts: MapCounts = {
    verified: reached.filter(isProven).length,
    unproven: reached.filter(i => !isProven(i) && !isFailing(i)).length,
    failing: reached.filter(isFailing).length,
    next: nodes.filter(i => i.status !== 'built' && isNext(i)).length,
    blocked: nodes.filter(i => i.status !== 'built' && !isNext(i)).length,
  };
  if (!split) counts.reached = reached.length;
  return counts;
}

interface AppDeckProps {
  view: View;
  /** On the map: its nodes by state. Null on the other views, which count their own things. */
  counts: MapCounts | null;
  /** In My Setup: how many entries are enabled, of how many. */
  entries: { enabled: number; total: number } | null;
  /** Whether the live-update stream is attached. */
  connected: boolean;
  /** How many drafts wait on the Proposals tab, where the decision is made. */
  draftCount: number;
  /** The legend key lit on its own, if any; the header's segments light the same keys. */
  spotlight: string | null;
  onSpotlight: (group: string | null) => void;
  onSearch: () => void;
  onShowView: (view: View) => void;
  onShare: () => void;
  onShowDocs: () => void;
  /** The day of the observation the map is scrubbed to; the counts are that day's. */
  asOf?: string;
  /**
   * The demo only: say the map is a sample, replay its tour, and offer the
   * visitor's own setup. Absent on a real machine, which is nobody's sample.
   */
  sample?: { onReplay?: () => void; onMapYours: () => void };
  /** A config read in the tab: say the map is the visitor's, and reopen what it adds up to. */
  yours?: { onOpen: () => void };
}

/**
 * The header's count, on the map.
 *
 * It used to read "42 of 60 reached", counting the machine's entries in with
 * the tree's nodes and leading with the one state the glossary calls least
 * informative. Then it read "16 reached", which counted a capability whose
 * check was failing the same as one whose check passed. Then five counts in a
 * row, which wrapped at 1440px and gave the largest number to what is blocked.
 * It says what a person acts on now: verified, anything failing, and the next
 * steps. Unproven and blocked are the rest of the map, written out in the
 * pill's tooltip; the strip under the map lights blocked. Each segment is the
 * same control as its key in that strip.
 */
const SEGMENTS: [keyof MapCounts, string][] = [
  ['verified', 'Verified'],
  ['failing', 'Failing'],
  ['next', 'Next step'],
];

/**
 * The glossary entry each segment's tooltip defines it by. A glossary popover
 * is a button and a segment is one already, so the definition rides on the
 * tooltip: a failing node is the other face of verified, and a next step is
 * one of the three states.
 */
const DEFINED_BY: Partial<Record<keyof MapCounts, string>> = {
  verified: 'evidence',
  failing: 'evidence',
  reached: 'state',
  next: 'state',
};

/** The same count for an observation with no lifecycles, where reached is not split. */
const UNSPLIT: [keyof MapCounts, string][] = [
  ['reached', 'Reached'],
  ['next', 'Next step'],
];

/** A segment's word for its count: "1 next step", "12 next steps". */
const noun = (group: string, n: number) =>
  group === 'Next step' && n !== 1 ? 'next steps' : group.toLowerCase();

/** Every count the pill leaves out, for its tooltip. */
function breakdown(c: MapCounts): string {
  const parts =
    c.reached !== undefined
      ? [`${c.reached} reached`]
      : [
          `${c.verified} verified`,
          `${c.unproven} unproven`,
          ...(c.failing ? [`${c.failing} failing`] : []),
        ];
  return [...parts, `${c.next} ${noun('Next step', c.next)}`, `${c.blocked} blocked`].join(', ');
}

/** Each view's tab. A long label has a `short` word for 1024px to 1270px, where it would not fit. */
const VIEW_TABS: { view: View; label: string; short?: string; title: string; icon: ReactNode }[] = [
  {
    view: 'map',
    label: 'Map',
    title: 'The curated capability tree, with your position on it',
    icon: (
      <>
        <circle cx="4" cy="12" r="2" />
        <circle cx="12" cy="4" r="2" />
        <circle cx="12" cy="12" r="2" />
        <path d="M5.5 10.5 L10.5 5.5 M6 12 H10" />
      </>
    ),
  },
  {
    view: 'setup',
    label: 'My Setup',
    short: 'Setup',
    title: 'The servers, agents and models found on this machine, and what each one provides',
    icon: (
      <>
        <rect x="2" y="3" width="12" height="3" rx="1" />
        <rect x="2" y="10" width="12" height="3" rx="1" />
        <circle cx="5" cy="4.5" r="0.75" fill="currentColor" />
        <circle cx="11" cy="11.5" r="0.75" fill="currentColor" />
      </>
    ),
  },
  {
    view: 'cost',
    label: 'Time & cost',
    short: 'Cost',
    title:
      'What your agents cost in tokens, what they save you in time, what may run without asking, and what would pay back fastest',
    icon: (
      <>
        <path d="M2 12 L6 8 L9 11 L14 4" />
        <circle cx="14" cy="4" r="1.5" fill="currentColor" />
      </>
    ),
  },
  {
    view: 'audit',
    label: 'Audit',
    title: 'Who approved what, and what ran',
    icon: (
      <>
        <path d="M6 4 H14 M6 8 H14 M6 12 H14" />
        <circle cx="2.5" cy="4" r="0.75" fill="currentColor" />
        <circle cx="2.5" cy="8" r="0.75" fill="currentColor" />
        <circle cx="2.5" cy="12" r="0.75" fill="currentColor" />
      </>
    ),
  },
  {
    view: 'proposals',
    label: 'Proposals',
    title: 'What an agent wants to change, waiting on your decision (g)',
    icon: (
      <>
        <path d="M3 2 H10 L13 5 V14 H3 Z" />
        <path d="M9 2 V5 H13" />
      </>
    ),
  },
];

/** Whether a row of chips has wrapped: its last item sits lower than its first. */
function wraps(row: HTMLElement): boolean {
  const kids = [...row.children].filter(k => (k as HTMLElement).offsetHeight > 0) as HTMLElement[];
  return kids.length > 1 && kids[kids.length - 1].offsetTop > kids[0].offsetTop + 2;
}

/** The top bar: search, brand, the count for this view, the view tabs, share, docs. */
export default function AppDeck(p: AppDeckProps) {
  const tab = (on: boolean) => `app-deck-tab ${on ? 'app-deck-tab--active' : ''}`;
  // How much of the pill gives way so it stays on one line: nothing, then the
  // bar (which draws the same numbers), then its last count. It wrapped onto a
  // second line at 1280px, the size most screenshots are, with the second
  // line opening on a stray "·". What gives way is still in its tooltip.
  const pill = useRef<HTMLDivElement>(null);
  const [fold, setFold] = useState(0);
  useLayoutEffect(() => {
    if (pill.current && fold < 2 && wraps(pill.current)) setFold(fold + 1);
  });
  useEffect(() => {
    const unfold = () => setFold(0);
    window.addEventListener('resize', unfold);
    return () => window.removeEventListener('resize', unfold);
  }, []);
  const unsplit = p.counts?.reached !== undefined;
  const reached = p.counts ? (p.counts.reached ?? p.counts.verified + p.counts.unproven) : 0;
  // Nothing is known to fail where no lifecycle was recorded.
  const failing = p.counts && !unsplit ? p.counts.failing : 0;
  const total = p.counts ? reached + failing + p.counts.next + p.counts.blocked : 0;
  return (
    <header className={`app-deck${p.sample ? ' app-deck--sample' : ''}`}>
      {/* The first stop for a keyboard: past the header and the map's tools to
          the view itself. Handled here, since a fragment in the address would
          read as a navigation. */}
      <a
        className="app-skip"
        href={`#${VIEW_ID}`}
        onClick={e => {
          e.preventDefault();
          document.getElementById(VIEW_ID)?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="app-deck-left">
        <div className="app-brand-group">
          <BrandMark size={18} className="app-brand-mark" />
          <span className="app-brand">Ambit</span>
          {/* The tour said whose map this is; a visitor who skipped it, or came
              back, was left with no word that it is not their own. */}
          {p.sample &&
            (p.sample.onReplay ? (
              <button
                type="button"
                className="app-sample-tag"
                onClick={p.sample.onReplay}
                title="A sample developer's setup, drawn from their config files. Replay the tour"
              >
                Sample
              </button>
            ) : (
              <span className="app-sample-tag">Sample</span>
            ))}
          {p.yours && (
            <button
              type="button"
              className="app-sample-tag"
              onClick={p.yours.onOpen}
              title="Your setup, placed in this tab and sent nowhere. Show what one more step would open"
            >
              Yours
            </button>
          )}
        </div>
        <button
          type="button"
          className="app-deck-btn"
          onClick={p.onSearch}
          title="Find a capability on the map or in your setup (/)"
          aria-label="Search capabilities and actions (/)"
        >
          <Icon strokeWidth="1.8" className="app-deck-icon">
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11 L14.5 14.5" />
          </Icon>
          <span className="app-deck-btn-label">Search</span>
          <kbd className="app-deck-key">/</kbd>
        </button>
        {p.counts && (
          <div
            ref={pill}
            className="app-status-pill"
            title={`The map by state${p.asOf ? `, as of ${p.asOf}` : ''}: ${breakdown(p.counts)}`}
          >
            {fold < 1 && (
              <ReachBar
                proven={unsplit ? undefined : p.counts.verified}
                reached={reached}
                failing={failing}
                next={p.counts.next}
                total={total}
              />
            )}
            {/* Failing is a segment only when something is: a zero there
                would be a count of a problem nobody has. */}
            {(unsplit ? UNSPLIT : SEGMENTS.filter(([key]) => key !== 'failing' || failing > 0))
              .filter((_, i, all) => fold < 2 || i < all.length - 1)
              .map(([key, group]) => (
                <button
                  key={key}
                  type="button"
                  className={`app-status-seg app-status-seg--${key} ${p.spotlight === group ? 'is-active' : ''}`}
                  aria-pressed={p.spotlight === group}
                  onClick={() => p.onSpotlight(p.spotlight === group ? null : group)}
                  // The definition rides on the tooltip: a glossary popover is a
                  // button, and a button inside this one is invalid markup that
                  // React reported on every load.
                  title={
                    p.spotlight === group
                      ? 'Show every node again'
                      : `Highlight ${group} on the map. ${termTitle(DEFINED_BY[key] ?? 'state')}`
                  }
                >
                  <span className="app-status-n">{p.counts![key]}</span>
                  {noun(group, p.counts![key] ?? 0)}
                </button>
              ))}
            {p.asOf && <span className="app-status-asof">as of {p.asOf}</span>}
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
            title="Connected to your graph: the map redraws when a seed, a check or another session changes it"
          >
            <span className="app-live-dot" aria-hidden="true" />
            <span className="app-live-label">Live</span>
          </span>
        )}
      </div>

      <div className="app-deck-center">
        <nav className="app-deck-nav" aria-label="View">
          {VIEW_TABS.map(t => (
            <button
              key={t.view}
              type="button"
              className={tab(p.view === t.view)}
              aria-current={p.view === t.view ? 'page' : undefined}
              onClick={() => p.onShowView(t.view)}
              // The full name, for a phone, where the tab shows only its icon,
              // and for the short word it shows from 1024px to 1270px. Proposals
              // stays the word on screen, so a voice command finds it; the label
              // also hid the count, so the count is the description.
              aria-label={t.label}
              aria-describedby={
                t.view === 'proposals' && p.draftCount > 0 ? 'app-deck-drafts' : undefined
              }
              title={t.title}
            >
              <Icon strokeLinejoin="round" className="app-tab-icon">
                {t.icon}
              </Icon>
              {t.short ? (
                <>
                  <span className="app-deck-tab-label app-deck-tab-label--long">{t.label}</span>
                  <span className="app-deck-tab-label app-deck-tab-short">{t.short}</span>
                </>
              ) : (
                <span className="app-deck-tab-label">{t.label}</span>
              )}
              {/* The count carries the alert, as the header button it replaced
                  did: the tab is where the decision is made, so the waiting
                  number belongs there. */}
              {t.view === 'proposals' && p.draftCount > 0 && (
                <>
                  <span className="app-deck-count app-deck-count--tab" aria-hidden="true">
                    {p.draftCount}
                  </span>
                  <span id="app-deck-drafts" hidden>
                    {p.draftCount} waiting for your decision
                  </span>
                </>
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="app-deck-right">
        {/* The way out of the sample, on every screen of it. It lived on the
            tour's last card alone, so a visitor who skipped the tour had no
            way from the sample to their own setup. */}
        {p.sample && (
          <button
            type="button"
            className="app-deck-btn app-deck-btn--primary"
            onClick={p.sample.onMapYours}
            title="Paste a config, or install the CLI, and see your own setup on the map"
          >
            <Icon strokeWidth="1.8" strokeLinejoin="round" className="app-deck-icon">
              <path d="M8 2 V10 M4.5 6.5 L8 10 L11.5 6.5 M2.5 13.5 H13.5" />
            </Icon>
            Map yours
          </button>
        )}
        <button
          type="button"
          className="app-deck-btn app-deck-btn--share"
          onClick={p.onShare}
          title="Copy a link that opens exactly this view, with its graph, node and lens"
          aria-label="Share view link"
        >
          <Icon strokeLinejoin="round" className="app-deck-icon">
            <circle cx="4" cy="8" r="2" />
            <circle cx="12" cy="4" r="2" />
            <circle cx="12" cy="12" r="2" />
            <path d="M5.8 7.1 L10.2 4.9 M5.8 8.9 L10.2 11.1" />
          </Icon>
          <span className="app-deck-btn-label">Share</span>
        </button>
        <button
          type="button"
          className="app-deck-btn"
          onClick={p.onShowDocs}
          title="Every term on the map, defined, and what each view does (?)"
          aria-label="Help: every term, and what the map shows (?)"
        >
          <Icon strokeLinejoin="round" className="app-deck-icon">
            <path d="M2 3.5 C2 2.7 2.7 2 3.5 2 H7.5 V14 H3.5 C2.7 14 2 13.3 2 12.5 Z M14 3.5 C14 2.7 13.3 2 12.5 2 H8.5 V14 H12.5 C13.3 14 14 13.3 14 12.5 Z" />
          </Icon>
          <span className="app-deck-btn-label">Help</span>
        </button>
      </div>
    </header>
  );
}
