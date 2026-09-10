import React from 'react';
import { useAmbitStore } from '../store/ambitStore';
import {
  typeLabel,
  statusLabel,
  metaKeyLabel,
  isConfigEntry,
  isRuntimeNode,
} from '../utils/labels';
import { Term } from './Term';
import { typeColor, typeSymbol } from '../utils/typeColors';

export function NodeDetailPanel() {
  const items = useAmbitStore(s => s.items);
  const connections = useAmbitStore(s => s.connections);
  const selectedId = useAmbitStore(s => s.selectedItem);
  const selectItem = useAmbitStore(s => s.selectItem);
  const simulatedNodeId = useAmbitStore(s => s.simulatedNodeId);
  const startOutage = useAmbitStore(s => s.startOutageSimulation);
  const startAcquisition = useAmbitStore(s => s.startAcquisitionSimulation);
  const clearSim = useAmbitStore(s => s.clearSimulation);
  const backend = useAmbitStore(s => s.backend);
  const toggleMcpEnabled = useAmbitStore(s => s.toggleMcpEnabled);

  const item = items.find(i => i.id === selectedId);
  const [copiedCmd, setCopiedCmd] = React.useState<string | null>(null);
  const [toggling, setToggling] = React.useState(false);
  const [toggleError, setToggleError] = React.useState<string | null>(null);

  if (!item) return null;

  const color = typeColor(item.type);

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
  // Gate on the label, not the timestamp: a `lastChecked` the writing and
  // reading clocks disagree about is truthy and names no interval.
  const checkedAgo = agoLabel(lastChecked);
  const evidence =
    item.status !== 'built' || !lifecycle
      ? undefined
      : lifecycle === 'reliable'
        ? {
            color: 'var(--ok)',
            text: `✓ Check passing consistently${checkedAgo ? ` · last run ${checkedAgo}` : ''}`,
          }
        : lifecycle === 'verified'
          ? {
              color: 'var(--ok)',
              text: `✓ Check passed${checkedAgo ? ` ${checkedAgo}` : ''}`,
            }
          : lifecycle === 'degraded' || lifecycle === 'broken'
            ? {
                color: 'var(--error)',
                text: `! Check failing${checkedAgo ? ` · last run ${checkedAgo}` : ''}`,
              }
            : lifecycle === 'configured'
              ? {
                  color: 'var(--text-muted)',
                  text: 'Configured — never verified. Nothing has demonstrated this works.',
                }
              : undefined;

  const neighborIds = new Set<string>();
  connections.forEach(c => {
    if (c.from === item.id) neighborIds.add(c.to);
    if (c.to === item.id) neighborIds.add(c.from);
  });
  const neighbors = items.filter(i => neighborIds.has(i.id));

  const advisories: { icon: string; label: string }[] = [];
  if (item.status === 'deprecated')
    advisories.push({ icon: '!', label: 'Deprecated — scheduled for removal' });
  if (item.status === 'specified') advisories.push({ icon: '~', label: 'Not reached yet' });
  if (neighbors.length === 0 && !isRuntimeNode(item))
    advisories.push({ icon: 'x', label: 'Nothing depends on this' });

  // Only a config entry names something the config apply route can edit.
  const enabled = item.status === 'built';

  const downstreamEnables = connections
    .filter(c => c.from === item.id)
    .map(c => items.find(i => i.id === c.to))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const isKeystone = downstreamEnables.length >= 3 || isRuntimeNode(item);

  // Details lists only facts that exist. A local MCP server has no url, and a row
  // reading "Url undefined" is noise. false and 0 are real values, so they stay.
  const isStated = (v: unknown) =>
    v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  const details = Object.entries(item.meta).filter(
    ([k, v]) => k !== 'lifecycle' && k !== 'lastChecked' && isStated(v)
  );

  return (
    <div className="star-panel">
      <div className="sp-hdr">
        <span className="sp-sig" style={{ color }} aria-hidden="true">
          {typeSymbol(item.type)}
        </span>
        <div className="sp-title-group">
          <div className="sp-designation">{item.name}</div>
          <div className="sp-class">
            {typeLabel(item.type)} ·{' '}
            <span
              style={{
                color:
                  item.status === 'built'
                    ? 'var(--ok)'
                    : item.status === 'specified'
                      ? 'var(--warn)'
                      : 'var(--error)',
              }}
            >
              {statusLabel(item.status, item)}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="sp-close"
          onClick={() => selectItem(null)}
          aria-label="Close details"
        >
          ✕
        </button>
      </div>

      {isKeystone && (
        <div
          style={{
            padding: '8px 12px',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            background: 'rgba(245, 158, 11, 0.08)',
            borderRadius: 'var(--radius)',
            marginTop: '4px',
            marginBottom: '8px',
            fontSize: '11.5px',
            color: 'var(--warn)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span aria-hidden="true">★</span>
          <span>
            <strong>
              <Term name="keystone" />.
            </strong>{' '}
            {downstreamEnables.length} other{' '}
            {downstreamEnables.length === 1 ? 'capability depends' : 'capabilities depend'} on this
            one.
          </span>
        </div>
      )}

      {evidence && (
        <div
          style={{
            padding: '8px 10px',
            border: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius)',
            marginTop: '4px',
            marginBottom: '8px',
            fontSize: '11.5px',
            color: evidence.color,
          }}
        >
          {evidence.text}
        </div>
      )}

      {/*
        The one edit the browser may make to a real config, and only to an
        entry that is already there: `enabled: true|false`. Creating an entry
        stays a hand edit, because an MCP entry carries a command the runtime
        executes — see the security posture in AGENTS.md. Offered only where it
        means something: an entry read out of the config, with an engine behind
        the page to write it back.
      */}
      {backend === 'live' && item.type === 'mcp-server' && isConfigEntry(item) && (
        <div className="sp-toggle-row">
          <div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              className={`sp-switch ${enabled ? 'sp-switch--on' : ''}`}
              disabled={toggling}
              onClick={async () => {
                setToggling(true);
                setToggleError(null);
                const ok = await toggleMcpEnabled(item.name, !enabled);
                if (!ok) setToggleError('Could not write the config. Is it writable?');
                setToggling(false);
              }}
            >
              <span className="sp-switch-knob" aria-hidden="true" />
              {/* The label names what the switch controls; the knob and
                  aria-checked carry the state, which the header states once. */}
              <span className="sp-switch-label">Enabled in your config</span>
            </button>
          </div>
          <p className="sp-toggle-note">
            {toggleError ??
              (enabled
                ? 'Switching this off writes enabled: false to your agent config. Restart the runtime for it to take effect.'
                : 'Switched off in your agent config. Switch it back on here.')}
          </p>
        </div>
      )}

      {/* Simulation: an outage for a reached node, an unlock for one that is not. */}
      {(() => {
        const isSimulated = simulatedNodeId === item.id;

        return (
          <div style={{ margin: '8px 0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {isSimulated ? (
              <button
                type="button"
                className="sp-action-btn"
                style={{
                  width: '100%',
                  background: 'var(--accent)',
                  color: 'var(--on-accent)',
                  fontWeight: 600,
                }}
                onClick={clearSim}
              >
                Exit simulation
              </button>
            ) : item.status === 'built' ? (
              <button
                type="button"
                className="sp-action-btn"
                style={{
                  width: '100%',
                  border: '1px solid var(--error)',
                  color: 'var(--error)',
                  fontSize: '11.5px',
                }}
                onClick={() => startOutage(item.id)}
              >
                Simulate an outage
              </button>
            ) : (
              <button
                type="button"
                className="sp-action-btn"
                style={{
                  width: '100%',
                  border: '1px solid var(--ok)',
                  color: 'var(--ok)',
                  fontSize: '11.5px',
                }}
                onClick={() => startAcquisition(item.id)}
              >
                Simulate unlocking this
              </button>
            )}
          </div>
        );
      })()}

      {item.description && (
        <div className="sp-desc" style={{ marginBottom: '8px' }}>
          {item.description}
        </div>
      )}

      {advisories.length > 0 && (
        <div className="sp-adv" style={{ marginTop: '8px' }}>
          <div className="sp-section-label">Notes</div>
          <div className="sp-adv-list">
            {advisories.map((a, i) => (
              <div key={i} className="sp-adv-item">
                <span style={{ color }}>{a.icon}</span>
                <span>{a.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The same questions from the terminal, one click to copy. */}
      <div className="sp-cli-actions">
        <div
          className="sp-section-label"
          style={{ display: 'flex', justifyContent: 'space-between' }}
        >
          <span>Commands</span>
          {copiedCmd && <span style={{ color: 'var(--ok)', textTransform: 'none' }}>Copied</span>}
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
              const conn = connections.find(
                c => (c.from === item.id && c.to === n.id) || (c.from === n.id && c.to === item.id)
              );
              return (
                <button
                  type="button"
                  key={n.id}
                  className="sp-link"
                  onClick={() => selectItem(n.id)}
                >
                  <span className="sp-link-dot" style={{ background: typeColor(n.type) }} />
                  <span className="sp-link-name">{n.name}</span>
                  {conn && <span className="sp-link-type">{conn.type}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {details.length > 0 && (
        <div className="sp-attrs" style={{ marginTop: '8px' }}>
          <div className="sp-section-label">Details</div>
          {details.map(([k, v]) => (
            <div key={k} className="sp-attr-row">
              <span className="sp-attr-key">
                {k === 'maturity' ? <Term name="maturity" /> : metaKeyLabel(k)}
              </span>
              <span className="sp-attr-val" title={String(v)}>
                {String(v)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { NodeDetailPanel as StarPanel };
export default NodeDetailPanel;
