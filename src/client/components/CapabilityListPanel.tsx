import { useState } from 'react';
import { useToolchainStore } from '../store/toolchainStore';
import { typeLabel, statusLabel } from '../utils/labels';

const FILTER_TYPES = [
  { key: 'all', label: 'All' },
  { key: 'framework', label: 'Frameworks' },
  { key: 'mcp-server', label: 'Servers' },
  { key: 'agent', label: 'Agents' },
  { key: 'skill', label: 'Skills' },
  { key: 'possibility', label: 'Combos' },
] as const;

export function CapabilityListPanel() {
  const items = useToolchainStore(s => s.items);
  const searchQuery = useToolchainStore(s => s.searchQuery);
  const setSearch = useToolchainStore(s => s.setSearch);
  const selectItem = useToolchainStore(s => s.selectItem);
  const selectedId = useToolchainStore(s => s.selectedItem);
  const [typeFilter, setTypeFilter] = useState<string>('all');

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
      <div className="tp-tabs">
        <span className="tp-tab tp-tab--active">Capabilities ({items.length})</span>
      </div>

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

      {/* Type Filter Chips */}
      <div className="tp-filter-chips">
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
                  {statusLabel(item.status)}
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
    </div>
  );
}

export { CapabilityListPanel as ToolchainPanel };
export default CapabilityListPanel;
