import React from 'react';
import { useToolchainStore } from '../store/toolchainStore';

const TYPE_COLORS: Record<string, string> = {
  framework: '#00d4ff',
  'mcp-server': '#ff8c00',
  agent: '#00ff88',
  provider: '#ffd600',
  model: '#4488ff',
  command: '#8899aa',
  skill: '#ff44ff',
  config: '#ccaa88',
  possibility: '#ff5fb7',
  device: '#00ffaa',
  service: '#7c9cff',
  api: '#ffcc66',
  network: '#66e0ff',
  workflow: '#d16bff',
};

function sysBar(value: number, max: number, color: string, label: string) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="sp-sys-row">
      <span className="sp-sys-label">{label}</span>
      <div className="sp-sys-bar-bg">
        <div className="sp-sys-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="sp-sys-value">{value}/{max}</span>
    </div>
  );
}

export default function StarPanel() {
  const items = useToolchainStore(s => s.items);
  const connections = useToolchainStore(s => s.connections);
  const selectedId = useToolchainStore(s => s.selectedItem);
  const selectItem = useToolchainStore(s => s.selectItem);
  const toggleMcpEnabled = useToolchainStore(s => s.toggleMcpEnabled);
  const updateItemOnServer = useToolchainStore(s => s.updateItemOnServer);
  const loading = useToolchainStore(s => s.loading);

  const item = items.find(i => i.id === selectedId);

  const [desc, setDesc] = React.useState('');
  const [model, setModel] = React.useState('');
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    if (item) {
      setDesc(item.description || '');
      setModel((item.meta?.model as string) || '');
      setEditing(false);
    }
  }, [item?.id]);

  if (!item) return null;

  const typeColor = TYPE_COLORS[item.type] || '#6a8aaa';

  const connCount = connections.filter(c => c.from === item.id || c.to === item.id).length;
  const degrees = items.map(i => connections.filter(c => c.from === i.id || c.to === i.id).length);
  const maxDegree = Math.max(1, ...degrees);
  const sortedByDegree = [...items].sort((a, b) => {
    const da = connections.filter(c => c.from === a.id || c.to === a.id).length;
    const db = connections.filter(c => c.from === b.id || c.to === b.id).length;
    return db - da;
  });
  const rank = sortedByDegree.findIndex(i => i.id === item.id) + 1;
  const influence = items.length > 1 ? Math.round((1 - (rank - 1) / (items.length - 1)) * 100) : 100;

  const neighborIds = new Set<string>();
  connections.forEach(c => {
    if (c.from === item.id) neighborIds.add(c.to);
    if (c.to === item.id) neighborIds.add(c.from);
  });
  const neighbors = items.filter(i => neighborIds.has(i.id));

  const advisories: { icon: string; label: string }[] = [];
  if (item.status === 'deprecated') advisories.push({ icon: '!', label: 'DECOMM' });
  if (item.status === 'specified') advisories.push({ icon: '~', label: 'PENDING' });
  if (neighbors.length === 0 && item.id !== 'opencode-core') advisories.push({ icon: 'x', label: 'ISOLATED' });

  const handleSave = async () => {
    if (!item) return;
    const updates: any = {};
    if (item.type === 'agent') {
      updates.description = desc;
      updates.model = model;
    } else if (item.type === 'command') {
      updates.description = desc;
    }
    await updateItemOnServer(item.id, item.type, updates);
    setEditing(false);
  };

  return (
    <div className="star-panel">
      <div className="sp-hdr">
        <span className="sp-sig" style={{ color: typeColor }}>
          {item.type === 'framework' ? '◈' : item.type === 'mcp-server' ? '◉' : item.type === 'agent' ? '◆' : item.type === 'provider' ? '⬡' : item.type === 'model' ? '◇' : item.type === 'skill' ? '⚡' : item.type === 'config' ? '☰' : item.type === 'possibility' ? '✦' : item.type === 'device' ? '▣' : item.type === 'service' ? '◌' : item.type === 'api' ? '◇' : item.type === 'network' ? '◎' : item.type === 'workflow' ? '✦' : '▣'}
        </span>
        <div className="sp-title-group">
          <div className="sp-designation">{item.name}</div>
          <div className="sp-class">
            {item.type} · <span style={{ color: item.status === 'built' ? 'var(--ok)' : item.status === 'specified' ? 'var(--warn)' : 'var(--error)' }}>{item.status}</span>
          </div>
        </div>
        <button className="sp-close" onClick={() => selectItem(null)}>✕</button>
      </div>

      {item.type === 'mcp-server' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', marginTop: '4px', marginBottom: '8px' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>STATUS: {item.status === 'built' ? 'ENABLED' : 'DISABLED'}</span>
          <button
            className="tp-btn"
            style={{ fontSize: '10px', padding: '4px 8px' }}
            disabled={loading}
            onClick={async () => {
              const name = item.id.replace(/^mcp:/, '');
              const nextState = item.status !== 'built';
              await toggleMcpEnabled(name, nextState);
            }}
          >
            {loading ? 'MUTATING...' : item.status === 'built' ? 'DISABLE' : 'ENABLE'}
          </button>
        </div>
      )}

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', marginBottom: '8px' }}>
          <label style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>DESCRIPTION</label>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            style={{ background: 'var(--bg-deep)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'var(--font)', fontSize: '11px', padding: '4px', resize: 'vertical', minHeight: '40px' }}
          />
          {item.type === 'agent' && (
            <>
              <label style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>MODEL</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={{ background: 'var(--bg-deep)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'var(--font)', fontSize: '11px', padding: '4px' }}
              />
            </>
          )}
          <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
            <button className="tp-btn-sm" style={{ flex: 1 }} onClick={handleSave} disabled={loading}>
              {loading ? 'SAVING...' : 'SAVE'}
            </button>
            <button className="tp-btn-sm" style={{ flex: 1 }} onClick={() => setEditing(false)} disabled={loading}>
              CANCEL
            </button>
          </div>
        </div>
      ) : (
        (item.type === 'agent' || item.type === 'command') && (
          <button className="tp-btn-sm" style={{ width: '100%', marginBottom: '8px' }} onClick={() => setEditing(true)}>
            ✏️ EDIT METADATA
          </button>
        )
      )}

      {item.description && !editing && (
        <div className="sp-desc" style={{ marginBottom: '8px' }}>{item.description}</div>
      )}

      <div className="sp-telemetry">
        <div className="sp-tel-box">
          <span className="sp-tel-val">{connCount}</span>
          <span className="sp-tel-lbl">links</span>
        </div>
        <div className="sp-tel-box">
          <span className="sp-tel-val">#{rank}</span>
          <span className="sp-tel-lbl">rank</span>
        </div>
        <div className="sp-tel-box">
          <span className="sp-tel-val">{influence}%</span>
          <span className="sp-tel-lbl">influence</span>
        </div>
      </div>

      <div className="sp-sys" style={{ marginTop: '8px' }}>
        {sysBar(
          item.status === 'built' ? 100 : item.status === 'specified' ? 50 : 10,
          100,
          item.status === 'built' ? '#00ff88' : item.status === 'specified' ? '#ff8c00' : '#ff3344',
          'SYS'
        )}
        {sysBar(connCount, maxDegree, '#00d4ff', 'NET')}
        {sysBar(Math.min(100, (item.description?.length || 0) * 2), 100, '#4488ff', 'DAT')}
      </div>

      {advisories.length > 0 && (
        <div className="sp-adv" style={{ marginTop: '8px' }}>
          <div className="sp-section-label">Advisories</div>
          <div className="sp-adv-list">
            {advisories.map((a, i) => (
              <div key={i} className="sp-adv-item">
                <span style={{ color: typeColor }}>{a.icon}</span>
                <span>{a.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {neighbors.length > 0 && (
        <div className="sp-links" style={{ marginTop: '8px' }}>
          <div className="sp-section-label">Data Links ({neighbors.length})</div>
          <div className="sp-link-list">
            {neighbors.map(n => {
              const conn = connections.find(c =>
                (c.from === item.id && c.to === n.id) || (c.from === n.id && c.to === item.id)
              );
              return (
                <div key={n.id} className="sp-link" onClick={() => selectItem(n.id)}>
                  <span className="sp-link-dot" style={{ background: TYPE_COLORS[n.type] || '#6a8aaa' }} />
                  <span className="sp-link-name">{n.name}</span>
                  {conn && <span className="sp-link-type">{conn.type}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {Object.keys(item.meta).length > 0 && (
        <div className="sp-attrs" style={{ marginTop: '8px' }}>
          <div className="sp-section-label">Attributes</div>
          {Object.entries(item.meta).map(([k, v]) => (
            <div key={k} className="sp-attr-row">
              <span className="sp-attr-key">{k.replace(/([A-Z])/g, '_$1').toUpperCase()}</span>
              <span className="sp-attr-val" title={String(v)}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
