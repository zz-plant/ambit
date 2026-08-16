import React, { useState } from 'react';
import { useToolchainStore } from '../store/toolchainStore';

export default function ToolchainPanel() {
  const items = useToolchainStore(s => s.items);
  const searchQuery = useToolchainStore(s => s.searchQuery);
  const setSearch = useToolchainStore(s => s.setSearch);
  const selectItem = useToolchainStore(s => s.selectItem);
  const selectedId = useToolchainStore(s => s.selectedItem);
  const setShowUplinkModal = useToolchainStore(s => s.setShowUplinkModal);

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    i.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const countByType: Record<string, number> = {};
  items.forEach(i => { countByType[i.type] = (countByType[i.type] || 0) + 1; });

  return (
    <div className="toolchain-panel">
      <div className="tp-tabs">
        <span className="tp-tab tp-tab--active">Capabilities ({items.length})</span>
      </div>

      <div style={{ padding: '6px', borderBottom: '1px solid var(--border)' }}>
        <button className="tp-btn" style={{ width: '100%', fontSize: '10px', padding: '6px' }} onClick={() => setShowUplinkModal(true)}>
          🔌 ADD MCP SERVER
        </button>
      </div>

      <div className="tp-toolbar">
        <input className="tp-search"
          placeholder="Search capabilities…"
          value={searchQuery}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Summary */}
      <div className="tp-summary">
        {Object.entries(countByType).map(([t, c]) => (
          <span key={t} className="tp-tag">{t} ×{c}</span>
        ))}
      </div>

      <div className="tp-list">
        {filtered.map(item => (
          <div key={item.id}
            className={`tp-item ${selectedId === item.id ? 'tp-item--sel' : ''}`}
            onClick={() => selectItem(item.id)}
          >
            <div className="tp-item-hdr">
              <span className="tp-item-name">{item.name}</span>
              <span className={`tp-badge tp-badge--${item.status}`}>{item.status}</span>
            </div>
            <div className="tp-item-meta">
              {item.type}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="tp-empty">No capabilities match</div>
        )}
      </div>
    </div>
  );
}