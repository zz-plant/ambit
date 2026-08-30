import React from 'react';
import { useToolchainStore } from '../store/toolchainStore';
import { typeLabel, statusLabel, metaKeyLabel } from '../utils/labels';

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

export function NodeDetailPanel() {
  const items = useToolchainStore(s => s.items);
  const connections = useToolchainStore(s => s.connections);
  const selectedId = useToolchainStore(s => s.selectedItem);
  const selectItem = useToolchainStore(s => s.selectItem);
  const toggleMcpEnabled = useToolchainStore(s => s.toggleMcpEnabled);
  const updateItemOnServer = useToolchainStore(s => s.updateItemOnServer);
  const loading = useToolchainStore(s => s.loading);
  const simulationMode = useToolchainStore(s => s.simulationMode);
  const simulatedNodeId = useToolchainStore(s => s.simulatedNodeId);
  const startOutage = useToolchainStore(s => s.startOutageSimulation);
  const startAcquisition = useToolchainStore(s => s.startAcquisitionSimulation);
  const clearSim = useToolchainStore(s => s.clearSimulation);

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

  // The evidence strip: what this capability's check has demonstrated, if
  // anything. Reached and verified are different claims, and the panel is
  // where the difference gets its words.
  const lifecycle = item.meta?.lifecycle as string | undefined;
  const lastChecked = item.meta?.lastChecked as string | undefined;
  const agoLabel = (ts?: string) => {
    if (!ts) return undefined;
    const ms = Date.now() - new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z').getTime();
    if (!(ms >= 0)) return undefined;
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / (60 * 24))}d ago`;
  };
  const evidence =
    item.status !== 'built' || !lifecycle ? undefined :
    lifecycle === 'reliable' ? { color: 'var(--ok)', text: `✓ Check passing consistently${lastChecked ? ` · last run ${agoLabel(lastChecked)}` : ''}` } :
    lifecycle === 'verified' ? { color: 'var(--ok)', text: `✓ Check passed${lastChecked ? ` ${agoLabel(lastChecked)}` : ''}` } :
    lifecycle === 'degraded' || lifecycle === 'broken' ? { color: 'var(--error)', text: `! Check failing${lastChecked ? ` · last run ${agoLabel(lastChecked)}` : ''}` } :
    lifecycle === 'configured' ? { color: 'var(--text-muted)', text: 'Configured — never verified. Nothing has demonstrated this works.' } :
    undefined;

  const connCount = connections.filter(c => c.from === item.id || c.to === item.id).length;
  const degrees = items.map(i => connections.filter(c => c.from === i.id || c.to === i.id).length);
  const sortedByDegree = [...items].sort((a, b) => {
    const da = connections.filter(c => c.from === a.id || c.to === a.id).length;
    const db = connections.filter(c => c.from === b.id || c.to === b.id).length;
    return db - da;
  });
  const rank = sortedByDegree.findIndex(i => i.id === item.id) + 1;

  const neighborIds = new Set<string>();
  connections.forEach(c => {
    if (c.from === item.id) neighborIds.add(c.to);
    if (c.to === item.id) neighborIds.add(c.from);
  });
  const neighbors = items.filter(i => neighborIds.has(i.id));

  const advisories: { icon: string; label: string }[] = [];
  if (item.status === 'deprecated') advisories.push({ icon: '!', label: 'Deprecated — scheduled for removal' });
  if (item.status === 'specified') advisories.push({ icon: '~', label: 'Not reached yet' });
  if (neighbors.length === 0 && item.id !== 'opencode-core') advisories.push({ icon: 'x', label: 'Nothing depends on this' });

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
            {typeLabel(item.type)} · <span style={{ color: item.status === 'built' ? 'var(--ok)' : item.status === 'specified' ? 'var(--warn)' : 'var(--error)' }}>{statusLabel(item.status)}</span>
          </div>
        </div>
        <button className="sp-close" onClick={() => selectItem(null)}>✕</button>
      </div>

      {evidence && (
        <div style={{ padding: '6px 8px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', marginTop: '4px', marginBottom: '8px', fontSize: '11px', color: evidence.color }}>
          {evidence.text}
        </div>
      )}

      {/* Simulation Controls: Blast Radius & What-If Frontier Simulator */}
      {(() => {
        const isSimulated = simulatedNodeId === item.id;

        return (
          <div style={{ margin: '8px 0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {isSimulated ? (
              <button
                type="button"
                className="sp-action-btn"
                style={{ width: '100%', background: 'var(--accent, #e76f51)', color: '#fff', fontWeight: 600 }}
                onClick={clearSim}
              >
                ✕ Exit Simulation
              </button>
            ) : item.status === 'built' ? (
              <button
                type="button"
                className="sp-action-btn"
                style={{ width: '100%', border: '1px solid var(--error, #e63946)', color: 'var(--error, #e63946)', fontSize: '11px' }}
                onClick={() => startOutage(item.id)}
              >
                ⚡ Simulate Outage (Blast Radius)
              </button>
            ) : (
              <button
                type="button"
                className="sp-action-btn"
                style={{ width: '100%', border: '1px solid var(--ok, #2a9d8f)', color: 'var(--ok, #2a9d8f)', fontSize: '11px' }}
                onClick={() => startAcquisition(item.id)}
              >
                ✨ Simulate Unlocking (What-If)
              </button>
            )}
          </div>
        );
      })()}

      {item.type === 'mcp-server' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', marginTop: '4px', marginBottom: '8px' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.status === 'built' ? 'Turned on' : 'Turned off'}</span>
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
            {loading ? 'Working…' : item.status === 'built' ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      )}

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', marginBottom: '8px' }}>
          <label style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>Description</label>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            style={{ background: 'var(--bg-deep)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'var(--font)', fontSize: '11px', padding: '4px', resize: 'vertical', minHeight: '40px' }}
          />
          {item.type === 'agent' && (
            <>
              <label style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>Model</label>
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
              {loading ? 'Saving…' : 'Save'}
            </button>
            <button className="tp-btn-sm" style={{ flex: 1 }} onClick={() => setEditing(false)} disabled={loading}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        (item.type === 'agent' || item.type === 'command') && (
          <button className="tp-btn-sm" style={{ width: '100%', marginBottom: '8px' }} onClick={() => setEditing(true)}>
            ✏️ Edit details
          </button>
        )
      )}

      {item.description && !editing && (
        <div className="sp-desc" style={{ marginBottom: '8px' }}>{item.description}</div>
      )}

      <div className="sp-telemetry">
        <div className="sp-tel-box">
          <span className="sp-tel-val">{connCount}</span>
          <span className="sp-tel-lbl">connections</span>
        </div>
        <div className="sp-tel-box">
          <span className="sp-tel-val">#{rank}</span>
          <span className="sp-tel-lbl">most connected</span>
        </div>
      </div>

      {advisories.length > 0 && (
        <div className="sp-adv" style={{ marginTop: '8px' }}>
          <div className="sp-section-label">Worth knowing</div>
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
          <div className="sp-section-label">Connected to ({neighbors.length})</div>
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
          <div className="sp-section-label">Details</div>
          {Object.entries(item.meta).filter(([k]) => k !== 'lifecycle' && k !== 'lastChecked').map(([k, v]) => (
            <div key={k} className="sp-attr-row">
              <span className="sp-attr-key">{metaKeyLabel(k)}</span>
              <span className="sp-attr-val" title={String(v)}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { NodeDetailPanel as StarPanel };
export default NodeDetailPanel;
