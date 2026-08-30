import React, { useState } from 'react';
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
  const setShowUplinkModal = useToolchainStore(s => s.setShowUplinkModal);
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const filtered = items.filter(i => {
    const matchesSearch =
      i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (i.description && i.description.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesType = typeFilter === 'all' || i.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const countByType: Record<string, number> = {};
  items.forEach(i => { countByType[i.type] = (countByType[i.type] || 0) + 1; });

  return (
    <div className="toolchain-panel">
      <div className="tp-tabs">
        <span className="tp-tab tp-tab--active">Capabilities ({items.length})</span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font)', fontWeight: 600 }}>NAV: [J / K] · [/] FIND</span>
      </div>

      <div style={{ padding: '6px', borderBottom: '1px solid var(--border)' }}>
        <button className="tp-btn" style={{ width: '100%', fontSize: '10px', padding: '6px' }} onClick={() => setShowUplinkModal(true)}>
          🔌 Connect a tool server
        </button>
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

      {/* Match count and active filters summary */}
      <div className="tp-match-count">
        <span>Showing {filtered.length} of {items.length}</span>
        {searchQuery && (
          <span style={{ color: 'var(--accent)' }}>filtered</span>
        )}
      </div>

      <div className="tp-list">
        {filtered.map(item => {
          const isBuilt = item.status === 'built';
          const lifecycle = item.meta?.lifecycle as string | undefined;
          const isFailing = lifecycle === 'degraded' || lifecycle === 'broken';

          return (
            <div key={item.id}
              className={`tp-item ${selectedId === item.id ? 'tp-item--sel' : ''}`}
              onClick={() => selectItem(item.id)}
            >
              <div className="tp-item-hdr">
                <span className="tp-item-name">{item.name}</span>
                <span className={`tp-badge tp-badge--${item.status}`}>{statusLabel(item.status)}</span>
              </div>
              <div className="tp-item-meta" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{typeLabel(item.type)}</span>
                {/* Segmented LED VU Meter */}
                <div className="vu-meter" title={`Integrity: ${isFailing ? 'Failing' : isBuilt ? 'Verified' : 'Unreached'}`}>
                  <div className={`vu-bar ${isBuilt ? (isFailing ? 'vu-bar--error' : 'vu-bar--ok') : ''}`} />
                  <div className={`vu-bar ${isBuilt ? (isFailing ? 'vu-bar--error' : 'vu-bar--ok') : ''}`} />
                  <div className={`vu-bar ${isBuilt && !isFailing ? 'vu-bar--ok' : ''}`} />
                  <div className={`vu-bar ${isBuilt && lifecycle === 'reliable' ? 'vu-bar--ok' : ''}`} />
                </div>
              </div>
            </div>
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
                onClick={() => { setSearch(''); setTypeFilter('all'); }}
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

