import React, { useState } from 'react';
import { useToolchainStore } from '../store/toolchainStore';

export default function ToolchainPanel() {
  const items = useToolchainStore(s => s.items);
  const connections = useToolchainStore(s => s.connections);
  const searchQuery = useToolchainStore(s => s.searchQuery);
  const setSearch = useToolchainStore(s => s.setSearch);
  const selectItem = useToolchainStore(s => s.selectItem);
  const selectedId = useToolchainStore(s => s.selectedItem);
  const snapshots = useToolchainStore(s => s.snapshots);
  const takeSnapshot = useToolchainStore(s => s.takeSnapshot);
  const restoreSnapshot = useToolchainStore(s => s.restoreSnapshot);
  const deleteSnapshot = useToolchainStore(s => s.deleteSnapshot);
  const setShowUplinkModal = useToolchainStore(s => s.setShowUplinkModal);

  const [tab, setTab] = useState<'items' | 'snapshots'>('items');

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    i.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const countByType: Record<string, number> = {};
  items.forEach(i => { countByType[i.type] = (countByType[i.type] || 0) + 1; });

  return (
    <div className="toolchain-panel">
      <div className="tp-tabs">
        <button className={`tp-tab ${tab === 'items' ? 'tp-tab--active' : ''}`}
          onClick={() => setTab('items')}>
          Stars ({items.length})
        </button>
        <button className={`tp-tab ${tab === 'snapshots' ? 'tp-tab--active' : ''}`}
          onClick={() => setTab('snapshots')}>
          Records ({snapshots.length})
        </button>
      </div>

      {tab === 'items' && (
        <>
          <div style={{ padding: '6px', borderBottom: '1px solid var(--border)' }}>
            <button className="tp-btn" style={{ width: '100%', fontSize: '10px', padding: '6px' }} onClick={() => setShowUplinkModal(true)}>
              🔌 ADD MCP SERVER
            </button>
          </div>

          <div className="tp-toolbar">
            <input className="tp-search"
              placeholder="Search stars…"
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
                  {item.type} · ({item.position.x.toFixed(1)}, {item.position.y.toFixed(1)}, {item.position.z.toFixed(1)})
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="tp-empty">No stars match</div>
            )}
          </div>
        </>
      )}

      {tab === 'snapshots' && (
        <div className="tp-snapshots">
          <button className="tp-btn" onClick={() => takeSnapshot()}>
            💾 Record Current
          </button>

          <div className="tp-list">
            {[...snapshots].reverse().map(snap => (
              <div key={snap.id} className="tp-snap">
                <div className="tp-snap-info" onClick={() => restoreSnapshot(snap.id)}>
                  <span className="tp-snap-label">{snap.label}</span>
                  <span className="tp-snap-meta">{snap.items.length} stars · {new Date(snap.timestamp).toLocaleDateString()}</span>
                </div>
                <div className="tp-snap-actions">
                  <button className="tp-btn-sm" onClick={() => restoreSnapshot(snap.id)} title="Restore">↩</button>
                  <button className="tp-btn-sm tp-btn--del" onClick={() => deleteSnapshot(snap.id)} title="Delete">✕</button>
                </div>
              </div>
            ))}
            {snapshots.length === 0 && (
              <div className="tp-empty">No records yet</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
