import { useEffect, useState } from 'react';
import { useAmbitStore } from '../store/ambitStore';
import { typeLabel, statusLabel } from '../utils/labels';
import { InfrastructurePanel, RepoDriftPanel } from './EnvironmentPanels';

/**
 * The panel's three questions, in the order a person asks them: what can this
 * machine do, how do my repositories differ from it, and what is actually up
 * right now. The last two are answered by endpoints that shipped with no
 * caller — `/api/repos/scan` and `/api/infrastructure/scan` — so the data was
 * being computed and thrown away.
 */
type Tab = 'capabilities' | 'repos' | 'infra';

const FILTER_TYPES = [
  { key: 'all', label: 'All' },
  { key: 'framework', label: 'Frameworks' },
  { key: 'mcp-server', label: 'Tool servers' },
  { key: 'agent', label: 'Agents' },
  { key: 'skill', label: 'Skills' },
  { key: 'possibility', label: 'Combos' },
] as const;

export function CapabilityListPanel() {
  const items = useAmbitStore(s => s.items);
  const searchQuery = useAmbitStore(s => s.searchQuery);
  const setSearch = useAmbitStore(s => s.setSearch);
  const selectItem = useAmbitStore(s => s.selectItem);
  const selectedId = useAmbitStore(s => s.selectedItem);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [tab, setTab] = useState<Tab>('capabilities');
  const backend = useAmbitStore(s => s.backend);
  const repos = useAmbitStore(s => s.repos);
  const infrastructure = useAmbitStore(s => s.infrastructure);
  const loadRepos = useAmbitStore(s => s.loadRepos);
  const loadInfrastructure = useAmbitStore(s => s.loadInfrastructure);

  // Fetched when the tab is first opened, not on mount: both walk the disk,
  // and most sessions never ask.
  useEffect(() => {
    if (tab === 'repos' && !repos) loadRepos();
    if (tab === 'infra' && !infrastructure) loadInfrastructure();
  }, [tab, repos, infrastructure, loadRepos, loadInfrastructure]);

  const filtered = items.filter(i => {
    const matchesSearch =
      i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === 'all' || i.type === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div className="toolchain-panel">
      <div className="tp-tabs" role="tablist" aria-label="Panel">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'capabilities'}
          className={`tp-tab ${tab === 'capabilities' ? 'tp-tab--active' : ''}`}
          onClick={() => setTab('capabilities')}
        >
          Capabilities ({items.length})
        </button>
        {backend === 'live' && (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'repos'}
              className={`tp-tab ${tab === 'repos' ? 'tp-tab--active' : ''}`}
              onClick={() => setTab('repos')}
              title="How each repository's agent config differs from your global one"
            >
              Repos{repos ? ` (${repos.repos.length})` : ''}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'infra'}
              className={`tp-tab ${tab === 'infra' ? 'tp-tab--active' : ''}`}
              onClick={() => setTab('infra')}
              title="The devices and services in your manifest, probed just now"
            >
              Infra
            </button>
          </>
        )}
      </div>

      {tab === 'repos' && <RepoDriftPanel scan={repos} />}
      {tab === 'infra' && <InfrastructurePanel scan={infrastructure} />}
      {tab === 'capabilities' && (
        <>
          <div className="tp-toolbar">
            <div className="tp-search-wrap">
              <input
                id="tp-search-input"
                className="tp-search"
                placeholder="Search capabilities… [ / ]"
                value={searchQuery}
                onChange={e => setSearch(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="tp-search-clear"
                  onClick={() => setSearch('')}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Which kinds this list shows. An identical-looking control over the
              map sits a few pixels away, so each one names what it acts on. */}
          <div className="tp-filter-chips" role="toolbar" aria-label="Filter the list">
            <span className="tp-filter-label">List</span>
            {FILTER_TYPES.map(f => (
              <button
                key={f.key}
                type="button"
                className={`tp-filter-chip ${typeFilter === f.key ? 'tp-filter-chip--active' : ''}`}
                onClick={() => setTypeFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {(searchQuery || typeFilter !== 'all') && (
            <div className="tp-match-count">
              <span>
                Showing {filtered.length} of {items.length}
              </span>
            </div>
          )}

          <div className="tp-list">
            {filtered.map(item => {
              return (
                <button
                  type="button"
                  key={item.id}
                  className={`tp-item ${selectedId === item.id ? 'tp-item--sel' : ''}`}
                  onClick={() => selectItem(item.id)}
                  aria-pressed={selectedId === item.id}
                >
                  <div className="tp-item-hdr">
                    <span className="tp-item-name">{item.name}</span>
                    <span className={`tp-badge tp-badge--${item.status}`}>
                      {statusLabel(item.status, item)}
                    </span>
                  </div>
                  <div className="tp-item-meta">{typeLabel(item.type)}</div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="tp-empty">
                <div>Nothing matches that search</div>
                {searchQuery && (
                  <button
                    type="button"
                    className="tp-btn-sm"
                    style={{ marginTop: '8px' }}
                    onClick={() => {
                      setSearch('');
                      setTypeFilter('all');
                    }}
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export { CapabilityListPanel as ToolchainPanel };
export default CapabilityListPanel;
