import React from 'react';
import { useToolchainStore } from '../store/toolchainStore';
import { typeLabel, statusLabel, metaKeyLabel } from '../utils/labels';

const TYPE_COLORS: Record<string, string> = {
  framework: '#6366f1',
  'mcp-server': '#f59e0b',
  agent: '#ec4899',
  provider: '#0284c7',
  model: '#3b82f6',
  command: '#64748b',
  skill: '#10b981',
  config: '#d97706',
  possibility: '#8b5cf6',
  device: '#14b8a6',
  service: '#6366f1',
  api: '#f59e0b',
  network: '#0ea5e9',
  workflow: '#8b5cf6',
};

export function NodeDetailPanel() {
  const items = useToolchainStore(s => s.items);
  const connections = useToolchainStore(s => s.connections);
  const selectedId = useToolchainStore(s => s.selectedItem);
  const selectItem = useToolchainStore(s => s.selectItem);
  const simulatedNodeId = useToolchainStore(s => s.simulatedNodeId);
  const startOutage = useToolchainStore(s => s.startOutageSimulation);
  const startAcquisition = useToolchainStore(s => s.startAcquisitionSimulation);
  const clearSim = useToolchainStore(s => s.clearSimulation);

  const item = items.find(i => i.id === selectedId);
  const [copiedCmd, setCopiedCmd] = React.useState<string | null>(null);

  if (!item) return null;

  const typeColor = TYPE_COLORS[item.type] || '#64748b';

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

  const downstreamEnables = connections.filter(c => c.from === item.id).map(c => items.find(i => i.id === c.to)).filter((i): i is NonNullable<typeof i> => Boolean(i));
  const isKeystone = downstreamEnables.length >= 3 || item.type === 'framework' || item.id === 'opencode-core';

  return (
    <div className="star-panel">
      <div className="sp-hdr">
        <span className="sp-sig" style={{ color: typeColor }}>
          {item.type === 'framework' ? '★' : item.type === 'mcp-server' ? '◈' : item.type === 'agent' ? '◆' : item.type === 'skill' ? '◇' : '●'}
        </span>
        <div className="sp-title-group">
          <div className="sp-designation">{item.name}</div>
          <div className="sp-class">
            {typeLabel(item.type)} · <span style={{ color: item.status === 'built' ? 'var(--ok)' : item.status === 'specified' ? 'var(--warn)' : 'var(--error)' }}>{statusLabel(item.status)}</span>
          </div>
        </div>
        <button className="sp-close" onClick={() => selectItem(null)}>✕</button>
      </div>

      {isKeystone && (
        <div style={{ padding: '8px 12px', border: '1px solid rgba(245, 158, 11, 0.3)', background: 'rgba(245, 158, 11, 0.08)', borderRadius: 'var(--radius)', marginTop: '4px', marginBottom: '8px', fontSize: '11.5px', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>★</span>
          <span><strong>Keystone Component:</strong> High-leverage foundation enabling {downstreamEnables.length} downstream branches.</span>
        </div>
      )}

      {evidence && (
        <div style={{ padding: '8px 10px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', marginTop: '4px', marginBottom: '8px', fontSize: '11.5px', color: evidence.color }}>
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
                style={{ width: '100%', background: 'var(--accent)', color: '#fff', fontWeight: 600 }}
                onClick={clearSim}
              >
                ✕ Exit Simulation
              </button>
            ) : item.status === 'built' ? (
              <button
                type="button"
                className="sp-action-btn"
                style={{ width: '100%', border: '1px solid var(--error)', color: 'var(--error)', fontSize: '11.5px' }}
                onClick={() => startOutage(item.id)}
              >
                Simulate Outage (Blast Radius)
              </button>
            ) : (
              <button
                type="button"
                className="sp-action-btn"
                style={{ width: '100%', border: '1px solid var(--ok)', color: 'var(--ok)', fontSize: '11.5px' }}
                onClick={() => startAcquisition(item.id)}
              >
                Simulate Acquisition (Unlock)
              </button>
            )}
          </div>
        );
      })()}

      {item.description && (
        <div className="sp-desc" style={{ marginBottom: '8px' }}>{item.description}</div>
      )}

      {advisories.length > 0 && (
        <div className="sp-adv" style={{ marginTop: '8px' }}>
          <div className="sp-section-label">Notes</div>
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

      {/* CLI Quick-Action Commands with 1-Click Copy */}
      <div className="sp-cli-actions">
        <div className="sp-section-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Commands</span>
          {copiedCmd && <span style={{ color: 'var(--ok)', textTransform: 'none' }}>✓ Copied {copiedCmd}!</span>}
        </div>
        <div className="sp-cli-row">
          <code className="sp-cli-cmd">ambit impact {item.id}</code>
          <button
            type="button"
            className="sp-cli-copy-btn"
            onClick={() => {
              navigator.clipboard?.writeText(`ambit impact ${item.id}`);
              setCopiedCmd('impact');
              setTimeout(() => setCopiedCmd(null), 2000);
            }}
          >
            Copy
          </button>
        </div>
        <div className="sp-cli-row">
          <code className="sp-cli-cmd">ambit verify {item.id}</code>
          <button
            type="button"
            className="sp-cli-copy-btn"
            onClick={() => {
              navigator.clipboard?.writeText(`ambit verify ${item.id}`);
              setCopiedCmd('verify');
              setTimeout(() => setCopiedCmd(null), 2000);
            }}
          >
            Copy
          </button>
        </div>
      </div>

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
