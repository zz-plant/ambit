import { ActorMark } from './ActorMark';
import { useEffect, useMemo, useState } from 'react';
import { useCopied } from '../hooks/useCopied';
import { useAmbitStore } from '../store/ambitStore';
import { trailOf, verifyCommand } from '../utils/checkHistory';
import type { Item } from '../utils/configImporter';
import { canSwitchMcp, flipMcp } from '../utils/configSwitch';
import { INSTALL } from '../utils/copy';
import { isConfigEntry, statusLabel, typeLabel } from '../utils/labels';
import { typeColor, typeSymbol } from '../utils/typeColors';
import { eraOf, isEntry } from './civ/layout';
import { InfrastructurePanel, RepoDriftPanel, UnmappedPanel } from './EnvironmentPanels';
import { HistoryStrip } from './figures';
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
type Tab = 'entries' | 'repos' | 'infra' | 'briefing' | 'unmapped';

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
  const unmapped = useAmbitStore(s => s.unmapped);
  const loadUnmapped = useAmbitStore(s => s.loadUnmapped);
  const configMcp = useAmbitStore(s => s.configMcp);
  const toggleMcpEnabled = useAmbitStore(s => s.toggleMcpEnabled);
  const [kind, setKind] = useState<string>('all');
  const [tab, setTab] = useState<Tab>('entries');
  const [copied, copy] = useCopied();
  // Which server is being written, if any. One write at a time: the route reads
  // the config, changes it and writes it back, and two in flight would each
  // start from a config that lacks the other's change.
  const [switching, setSwitching] = useState<string | null>(null);
  // Said in the row that was clicked, where the person is looking, and not at
  // the top of a list that may have scrolled away.
  const [switchError, setSwitchError] = useState<{ name: string; message: string } | null>(null);

  const flip = async (item: Item) => {
    if (switching !== null) return;
    setSwitching(item.name);
    setSwitchError(null);
    try {
      const message = await flipMcp(item, toggleMcpEnabled);
      if (message) setSwitchError({ name: item.name, message });
    } finally {
      setSwitching(null);
    }
  };

  // Fetched when the tab is first opened, not on mount: the scans walk the
  // disk, the briefing applies any threshold whose evidence now holds, and
  // most sessions never ask.
  useEffect(() => {
    if (tab === 'repos' && !repos) loadRepos();
    if (tab === 'infra' && !infrastructure) loadInfrastructure();
    if (tab === 'briefing') loadBriefing();
    if (tab === 'unmapped') loadUnmapped();
  }, [tab, repos, infrastructure, loadRepos, loadInfrastructure, loadBriefing, loadUnmapped]);

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
  // Whether any row can be switched, so the note about what a switch does is
  // written only where there is a switch to explain.
  const anySwitch = entries.some(i => canSwitchMcp(i, backend, configMcp));

  // What the list has to say, before anyone reads a row: what is failing, and
  // what is enabled but puts nothing on the map, which is either dead weight or
  // a gap in the tree. It opened on "28 of 28 entries enabled", the one fact in
  // the view that carried no news.
  const live = entries.filter(i => i.status === 'built');
  const failingEntries = live.filter(
    i => evidenceOf(i, provides.get(i.id) || [])?.tone === 'error'
  );
  // With no tree in the graph, nothing has been placed yet, so nothing can
  // be said to provide nothing. That is a config read in the browser: the
  // entries are real, and placing them on the tree is the engine's job. Every
  // row used to say "Provides nothing on the map" in warning colour to a
  // visitor who had just pasted their own setup.
  const placed = items.some(i => !isEntry(i));
  const idle = placed
    ? live.filter(i => i.type === 'mcp-server' && (provides.get(i.id) || []).length === 0)
    : [];

  return (
    <div className="setup">
      <div className="setup-inner">
        <div className="setup-head">
          <div>
            <h2 className="setup-title">My Setup</h2>
            {!placed && entries.length > 0 && tab === 'entries' && (
              <div className="setup-unplaced">
                <p>
                  <strong>
                    Read in this tab: {entries.length} {entries.length === 1 ? 'entry' : 'entries'}.
                  </strong>{' '}
                  Placing them on the map, with what each one makes possible and what breaks without
                  it, takes the engine, which reads every runtime on the machine:
                </p>
                <code>{INSTALL}</code>
              </div>
            )}
            <p className="setup-subtitle">
              {enabled} of {entries.length} entries enabled. One row per server, agent, model or
              command your configs declare, with its latest check and what it adds to the map.
            </p>
            {anySwitch && tab === 'entries' && (
              <p className="setup-subtitle setup-switch-note">
                A tool server's switch writes <code>enabled</code> to your agent config and keeps
                the file it replaces as a <code>.bak</code>. Restart the runtime for it to take
                effect.
              </p>
            )}
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
                  [
                    'unmapped',
                    'Not on the map',
                    <svg
                      key="u"
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
                      <circle cx="8" cy="8" r="5.5" strokeDasharray="2.5 2" />
                      <path d="M8 5.5 V10.5 M5.5 8 H10.5" />
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
                          : key === 'unmapped'
                            ? 'What the agents used that no node on the map accounts for'
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
        {tab === 'infra' && (
          <InfrastructurePanel scan={infrastructure} onProbe={loadInfrastructure} />
        )}
        {tab === 'unmapped' && <UnmappedPanel report={unmapped} />}
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
              // A message, and drawn as one: Ambit's, to the agent, at connect.
              // The sender and the addressee are the two marks; the text is
              // exactly what the agent receives.
              <div className="setup-briefing-message">
                <p className="setup-briefing-route">
                  <ActorMark id="ambit" size={20} decorative />
                  <span>
                    Ambit <span aria-hidden="true">→</span>{' '}
                    <ActorMark id="agent" size={16} decorative /> the agent, when it connects
                  </span>
                </p>
                <pre className="setup-briefing-text bubble bubble--from">{briefing.text}</pre>
              </div>
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
                    // One strip, and it has to be about what the row calls
                    // failing: when nodes are failing, only they are candidates.
                    const trail = trailOf(item, evidence?.failing ?? proves);
                    const failing = evidence?.tone === 'error';
                    const verifyCmd = verifyCommand(trail?.node ?? evidence?.failing?.[0] ?? item);
                    const provesNothing =
                      placed &&
                      item.type === 'mcp-server' &&
                      item.status === 'built' &&
                      !proves.length;
                    const switchable = canSwitchMcp(item, backend, configMcp);
                    const on = item.status === 'built';
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
                            was a column of the same word. A tool server the
                            config names has a switch instead, which says the
                            same thing by where its knob is and can change it. */}
                        {switchable ? (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={on}
                            className={`setup-switch ${on ? 'setup-switch--on' : ''}`}
                            // Not `disabled`: that would drop the keyboard's place in
                            // the list on every write.
                            aria-disabled={switching !== null ? true : undefined}
                            aria-label={`Enabled in your config: ${item.name}`}
                            title={`Switching this ${on ? 'off' : 'on'} writes enabled: ${!on} to your agent config. Restart the runtime for it to take effect.`}
                            onClick={() => flip(item)}
                          >
                            <span className="setup-switch-knob" aria-hidden="true" />
                          </button>
                        ) : item.status === 'built' ? (
                          <span className="tp-badge" />
                        ) : (
                          <span className={`tp-badge tp-badge--${item.status}`}>
                            {statusLabel(item.status, item)}
                          </span>
                        )}
                        <span className="setup-row-check">
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
                          {trail && <HistoryStrip runs={trail.runs} of={trail.node.name} />}
                          {/* Where a link to the reason will go. Until the page
                              can show why, the way to find out is the command,
                              and the page cannot run a check. */}
                          {failing && (
                            <button
                              type="button"
                              className="tp-inline-btn setup-row-verify"
                              onClick={() => copy(item.id, verifyCmd)}
                              aria-label={`Copy command ${verifyCmd}`}
                              title={`Paste it in a terminal to run the check again and read why it failed: ${verifyCmd}`}
                            >
                              {copied === item.id ? 'Copied ✓' : 'Copy ambit verify'}
                            </button>
                          )}
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
                        {switchError?.name === item.name && (
                          <span className="setup-row-error" role="alert">
                            {switchError.message}
                          </span>
                        )}
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
