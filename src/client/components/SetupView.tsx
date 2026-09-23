import { useEffect, useMemo, useState } from 'react';
import { useAmbitStore } from '../store/ambitStore';
import type { Item } from '../utils/configImporter';
import { isConfigEntry, statusLabel, typeLabel } from '../utils/labels';
import { typeColor, typeSymbol } from '../utils/typeColors';
import { eraOf, isEntry } from './civ/layout';
import { InfrastructurePanel, RepoDriftPanel } from './EnvironmentPanels';
import { Term } from './Term';

/**
 * My Setup: what this machine has, as the list it is.
 *
 * It used to be a second map, the machine's entries drawn as nodes in domain
 * columns with nearly every edge running to the runtime, which is a list drawn
 * as a star. The map is the tree; this is the setup, one row per entry with
 * the facts a config file and the engine have about it, and the tree nodes
 * each one proves, which is the join between the two views. Repositories and
 * infrastructure are the other two things a machine has, so they are tabs
 * here instead of in a side panel.
 */
type Tab = 'entries' | 'repos' | 'infra' | 'briefing';

/** Kinds in the order a person asks about them, with the glossary key where one exists. */
const KINDS: { type: string; label: string; term?: string }[] = [
  { type: 'runtime', label: 'Runtime' },
  { type: 'framework', label: 'Framework' },
  { type: 'mcp-server', label: 'Tool servers', term: 'tool-server' },
  { type: 'agent', label: 'Agents' },
  { type: 'skill', label: 'Skills' },
  { type: 'provider', label: 'AI providers' },
  { type: 'model', label: 'Models' },
  { type: 'tool', label: 'Commands' },
  { type: 'config', label: 'Configuration' },
];

type Evidence = { text: string; tone: 'ok' | 'error' | 'muted'; failing?: Item[] };

const FAILING = ['degraded', 'broken'];
const PASSED = ['reliable', 'verified'];

/**
 * What the engine has demonstrated about an entry, as a few words and a colour.
 *
 * An entry read out of a config carries no lifecycle of its own; the checks run
 * against the tree nodes it provides. So an entry answers for those: failing if
 * any of them fails, passed when every one it provides has passed, and never
 * checked otherwise. The column used to be blank for every config entry, beside
 * a status column that read "Enabled" twenty-eight times.
 */
function evidenceOf(item: Item, proves: Item[]): Evidence | null {
  if (item.status !== 'built') return null;
  const own = item.meta?.lifecycle as string | undefined;
  if (own && own !== 'unknown' && own !== 'detected') {
    if (PASSED.includes(own)) return { text: 'check passed', tone: 'ok' };
    if (FAILING.includes(own)) return { text: 'check failing', tone: 'error' };
    return { text: 'never checked', tone: 'muted' };
  }
  if (!proves.length) return null;
  const life = (n: Item) => String(n.meta?.lifecycle ?? '');
  const failing = proves.filter(n => FAILING.includes(life(n)));
  if (failing.length) return { text: 'check failing', tone: 'error', failing };
  if (proves.every(n => PASSED.includes(life(n)))) return { text: 'check passed', tone: 'ok' };
  return { text: 'never checked', tone: 'muted' };
}

/** "a", "a and b", "a, b and 3 more": names in a sentence, never a wall of them. */
const nameList = (names: string[]) =>
  names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;

interface SetupViewProps {
  /** Show a tree node on the map, selected. */
  onShow: (id: string) => void;
}

export function SetupView({ onShow }: SetupViewProps) {
  const items = useAmbitStore(s => s.items);
  const connections = useAmbitStore(s => s.connections);
  const searchQuery = useAmbitStore(s => s.searchQuery);
  const setSearch = useAmbitStore(s => s.setSearch);
  const selectItem = useAmbitStore(s => s.selectItem);
  const selectedId = useAmbitStore(s => s.selectedItem);
  const backend = useAmbitStore(s => s.backend);
  const repos = useAmbitStore(s => s.repos);
  const infrastructure = useAmbitStore(s => s.infrastructure);
  const loadRepos = useAmbitStore(s => s.loadRepos);
  const loadInfrastructure = useAmbitStore(s => s.loadInfrastructure);
  const briefing = useAmbitStore(s => s.briefing);
  const loadBriefing = useAmbitStore(s => s.loadBriefing);
  const [kind, setKind] = useState<string>('all');
  const [tab, setTab] = useState<Tab>('entries');

  // Fetched when the tab is first opened, not on mount: the scans walk the
  // disk, the briefing applies any threshold whose evidence now holds, and
  // most sessions never ask.
  useEffect(() => {
    if (tab === 'repos' && !repos) loadRepos();
    if (tab === 'infra' && !infrastructure) loadInfrastructure();
    if (tab === 'briefing') loadBriefing();
  }, [tab, repos, infrastructure, loadRepos, loadInfrastructure, loadBriefing]);

  const entries = useMemo(() => items.filter(isEntry), [items]);
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  // Which tree nodes each entry proves: the edges from an entry into an era.
  const provides = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const c of connections) {
      const target = byId.get(c.to);
      if (!target || eraOf(target) === undefined) continue;
      if (!map.has(c.from)) map.set(c.from, []);
      map.get(c.from)!.push(target);
    }
    return map;
  }, [connections, byId]);

  const q = searchQuery.trim().toLowerCase();
  const shown = entries.filter(i => {
    const matchesSearch =
      !q ||
      i.name.toLowerCase().includes(q) ||
      i.type.toLowerCase().includes(q) ||
      i.description?.toLowerCase().includes(q);
    return matchesSearch && (kind === 'all' || i.type === kind);
  });

  const kindsPresent = KINDS.filter(k => entries.some(i => i.type === k.type));
  const groups = kindsPresent
    .map(k => ({ ...k, rows: shown.filter(i => i.type === k.type) }))
    .filter(g => g.rows.length > 0);
  const other = shown.filter(i => !KINDS.some(k => k.type === i.type));
  const enabled = entries.filter(i => i.status === 'built').length;

  // What the list has to say, before anyone reads a row: what is failing, and
  // what is enabled but puts nothing on the map, which is either dead weight or
  // a gap in the tree. It opened on "28 of 28 entries enabled", the one fact in
  // the view that carried no news.
  const live = entries.filter(i => i.status === 'built');
  const failingEntries = live.filter(
    i => evidenceOf(i, provides.get(i.id) || [])?.tone === 'error'
  );
  const idle = live.filter(i => i.type === 'mcp-server' && (provides.get(i.id) || []).length === 0);

  return (
    <div className="setup">
      <div className="setup-inner">
        <div className="setup-head">
          <div>
            <h2 className="setup-title">My Setup</h2>
            {(failingEntries.length > 0 || idle.length > 0) && tab === 'entries' && (
              <ul className="setup-findings">
                {failingEntries.length > 0 && (
                  <li className="setup-finding setup-finding--bad">
                    <strong>{nameList(failingEntries.map(i => i.name))}</strong>{' '}
                    {failingEntries.length === 1 ? 'provides' : 'provide'} something whose check is
                    failing.
                  </li>
                )}
                {idle.length > 0 && (
                  <li className="setup-finding setup-finding--warn">
                    <strong>{nameList(idle.map(i => i.name))}</strong>{' '}
                    {idle.length === 1 ? 'is' : 'are'} enabled but{' '}
                    {idle.length === 1 ? 'provides' : 'provide'} nothing on the map.
                  </li>
                )}
              </ul>
            )}
            <p className="setup-subtitle">
              {enabled} of {entries.length} entries enabled. Each row is one thing your agent
              configs declare, with what the engine has proved about it and the capabilities it
              provides.
            </p>
          </div>
          {backend === 'live' && (
            <div className="setup-tabs" role="tablist" aria-label="What this machine has">
              {(
                [
                  [
                    'entries',
                    'Entries',
                    <svg
                      key="e"
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      className="setup-tab-icon"
                      aria-hidden="true"
                    >
                      <rect x="2" y="3" width="12" height="3" rx="1" />
                      <rect x="2" y="10" width="12" height="3" rx="1" />
                      <circle cx="5" cy="4.5" r="0.75" fill="currentColor" />
                      <circle cx="11" cy="11.5" r="0.75" fill="currentColor" />
                    </svg>,
                  ],
                  [
                    'repos',
                    repos ? `Repos (${repos.repos.length})` : 'Repos',
                    <svg
                      key="r"
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      className="setup-tab-icon"
                      aria-hidden="true"
                    >
                      <circle cx="4" cy="4" r="2" />
                      <circle cx="4" cy="12" r="2" />
                      <circle cx="12" cy="7" r="2" />
                      <path d="M4 6 V10 M4 6 C4 9 12 5 12 7" />
                    </svg>,
                  ],
                  [
                    'infra',
                    'Infra',
                    <svg
                      key="i"
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      className="setup-tab-icon"
                      aria-hidden="true"
                    >
                      <rect x="2" y="3" width="12" height="4" rx="1" />
                      <rect x="2" y="9" width="12" height="4" rx="1" />
                      <circle cx="4" cy="5" r="0.5" fill="currentColor" />
                      <circle cx="4" cy="11" r="0.5" fill="currentColor" />
                    </svg>,
                  ],
                  [
                    'briefing',
                    'Briefing',
                    <svg
                      key="b"
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      className="setup-tab-icon"
                      aria-hidden="true"
                    >
                      <path d="M3 2.5 H13 V13.5 H3 Z" />
                      <path d="M5 5.5 H11 M5 8 H10 M5 10.5 H8" />
                    </svg>,
                  ],
                ] as [Tab, string, React.ReactNode][]
              ).map(([key, label, icon]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={`setup-tab ${tab === key ? 'setup-tab--active' : ''}`}
                  onClick={() => setTab(key)}
                  title={
                    key === 'repos'
                      ? "How each repository's agent config differs from your global one"
                      : key === 'infra'
                        ? 'The devices and services in your manifest, probed just now'
                        : key === 'briefing'
                          ? 'What an agent is told about this machine when it connects'
                          : undefined
                  }
                >
                  {icon}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {tab === 'repos' && <RepoDriftPanel scan={repos} />}
        {tab === 'infra' && <InfrastructurePanel scan={infrastructure} />}
        {tab === 'briefing' && (
          // What the agent believes about this machine, inspectable by the
          // person it believes it about. Served at connect as the MCP resource
          // ambit://briefing; this is the same prose.
          <div className="setup-briefing">
            <p className="tp-note">
              What an agent is told when it connects, before its first tool call: what works, what
              is broken, what waits on you, what blocked work lately, and what to reach next. Capped
              near {briefing?.budget ?? 1200} tokens and trimmed from the bottom, so the order is
              the order of usefulness.
            </p>
            {briefing ? (
              <pre className="setup-briefing-text">{briefing.text}</pre>
            ) : (
              <div className="tp-empty tp-empty--note">Composing the briefing…</div>
            )}
          </div>
        )}
        {tab === 'entries' && (
          <>
            <div className="setup-controls">
              <div className="tp-search-wrap">
                <input
                  id="tp-search-input"
                  className="tp-search"
                  placeholder="Filter entries"
                  aria-label="Filter entries"
                  value={searchQuery}
                  onChange={e => setSearch(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="tp-search-clear"
                    onClick={() => setSearch('')}
                    aria-label="Clear the filter"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="tp-filter-chips" role="toolbar" aria-label="Kind">
                <button
                  type="button"
                  className={`tp-filter-chip ${kind === 'all' ? 'tp-filter-chip--active' : ''}`}
                  onClick={() => setKind('all')}
                >
                  All
                </button>
                {kindsPresent.map(k => (
                  <button
                    key={k.type}
                    type="button"
                    className={`tp-filter-chip ${kind === k.type ? 'tp-filter-chip--active' : ''}`}
                    onClick={() => setKind(k.type)}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>

            {(q || kind !== 'all') && (
              <p className="tp-match-count">
                Showing {shown.length} of {entries.length}
              </p>
            )}

            {[
              ...groups,
              ...(other.length ? [{ type: 'other', label: 'Other', rows: other }] : []),
            ].map(g => (
              <section key={g.type} className="setup-group" aria-label={g.label}>
                <h3 className="setup-group-title">
                  {'term' in g && g.term ? <Term name={g.term}>{g.label}</Term> : g.label}
                  <span className="setup-group-n">{g.rows.length}</span>
                </h3>
                <div className="setup-rows">
                  {g.rows.map(item => {
                    const proves = provides.get(item.id) || [];
                    const evidence = evidenceOf(item, proves);
                    const provesNothing =
                      item.type === 'mcp-server' && item.status === 'built' && !proves.length;
                    const selected = selectedId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`setup-row ${selected ? 'setup-row--sel' : ''}`}
                      >
                        <button
                          type="button"
                          className="setup-row-name"
                          onClick={() => selectItem(item.id)}
                          aria-pressed={selected}
                        >
                          <span
                            className="setup-row-glyph"
                            style={{ color: typeColor(item.type) }}
                            aria-hidden="true"
                          >
                            {typeSymbol(item.type)}
                          </span>
                          <span>{item.name}</span>
                          {!isConfigEntry(item) && (
                            <span className="setup-row-kind">{typeLabel(item.type)}</span>
                          )}
                        </button>
                        {/* Only the exception is written: "Enabled" on every row
                            was a column of the same word. */}
                        {item.status === 'built' ? (
                          <span className="tp-badge" />
                        ) : (
                          <span className={`tp-badge tp-badge--${item.status}`}>
                            {statusLabel(item.status, item)}
                          </span>
                        )}
                        <span
                          className={`setup-row-evidence is-${evidence?.tone ?? 'none'}`}
                          title={
                            evidence?.failing
                              ? `Failing: ${evidence.failing.map(n => n.name).join(', ')}`
                              : undefined
                          }
                        >
                          {evidence?.text ?? ''}
                        </span>
                        <span className="setup-row-provides">
                          {provesNothing && (
                            <span className="setup-row-idle">Provides nothing on the map</span>
                          )}
                          {proves.map(node => (
                            <button
                              key={node.id}
                              type="button"
                              className="setup-chip"
                              onClick={() => onShow(node.id)}
                              title={`Show ${node.name} on the map`}
                            >
                              {node.name}
                            </button>
                          ))}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            {shown.length === 0 && (
              <div className="tp-empty">
                <div className="tp-empty-graphic" aria-hidden="true">
                  <svg
                    width="40"
                    height="40"
                    viewBox="0 0 48 48"
                    fill="none"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <circle cx="20" cy="20" r="11" strokeWidth="2" strokeDasharray="3 2" />
                    <path d="M28 28 L40 40" strokeWidth="2.5" strokeLinecap="round" />
                    <path d="M16 20 H24" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                  </svg>
                </div>
                <div>{q ? 'No entries match the filter' : 'Nothing of this kind is set up'}</div>
                <button
                  type="button"
                  className="tp-btn-sm"
                  style={{ marginTop: '8px' }}
                  onClick={() => {
                    setSearch('');
                    setKind('all');
                  }}
                >
                  Show everything
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default SetupView;
