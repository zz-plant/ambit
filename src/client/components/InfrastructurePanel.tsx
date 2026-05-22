import React from 'react';
import { useToolchainStore, type InfrastructureScan } from '../store/toolchainStore';

function statusColor(status: string): string {
  if (status === 'online') return '#00ff88';
  if (status === 'degraded') return '#ff8c00';
  if (status === 'offline') return '#ff3344';
  return '#6a8aaa';
}

function severityColor(severity: string): string {
  if (severity === 'error') return '#ff3344';
  if (severity === 'warn') return '#ff8c00';
  return '#00d4ff';
}

function NodeRow({ node }: { node: InfrastructureScan['nodes'][number] }) {
  const selectItem = useToolchainStore(s => s.selectItem);
  const endpoint = typeof node.meta?.url === 'string' ? node.meta.url : undefined;
  const runtimeStatus = typeof node.meta?.runtimeStatus === 'string' ? node.meta.runtimeStatus : undefined;
  const mcpEnabled = node.meta?.mcpEnabled;

  return (
    <div className="infra-row" onClick={() => selectItem(node.id)}>
      <div className="infra-row-main">
        <span className="infra-dot" style={{ background: statusColor(node.status) }} />
        <div className="infra-name-group">
          <span className="infra-name">{node.name}</span>
          <span className="infra-desc">{node.description}</span>
        </div>
      </div>
      <div className="infra-row-meta">
        <span className="rr-tag">{node.kind}</span>
        <span className="rr-tag" style={{ color: statusColor(node.status), borderColor: statusColor(node.status) + '55' }}>
          {node.status}
        </span>
        {mcpEnabled !== undefined && (
          <span className={`rr-tag ${mcpEnabled ? 'rr-tag--agent' : 'rr-tag--warn'}`}>
            MCP {mcpEnabled ? 'on' : 'off'}
          </span>
        )}
        {runtimeStatus && <span className="infra-runtime">{runtimeStatus}</span>}
        {endpoint && <span className="infra-endpoint">{endpoint}</span>}
      </div>
    </div>
  );
}

export default function InfrastructurePanel() {
  const scan = useToolchainStore(s => s.infrastructureScan);
  const loadConfig = useToolchainStore(s => s.loadConfig);
  const loading = useToolchainStore(s => s.loading);

  const nodesByKind = React.useMemo(() => {
    const grouped: Record<string, InfrastructureScan['nodes']> = {};
    for (const node of scan?.nodes || []) {
      grouped[node.kind] = grouped[node.kind] || [];
      grouped[node.kind].push(node);
    }
    return grouped;
  }, [scan]);

  return (
    <div className="diag-panel">
      <div className="dp-hdr">
        <h3>◈ EDGE OPS</h3>
        <button className="dp-run-all" onClick={loadConfig} disabled={loading}>
          {loading ? 'SCANNING…' : 'RESCAN'}
        </button>
      </div>

      {!scan && (
        <div className="dp-empty">
          <p style={{ marginBottom: 8 }}>No infrastructure scan loaded.</p>
          <button className="tp-btn" onClick={loadConfig}>LOAD SCAN</button>
        </div>
      )}

      {scan && (
        <>
          <div className="rr-summary">
            <div className="rr-summary-box">
              <span className="rr-summary-val" style={{ color: '#00ff88' }}>{scan.summary.online}</span>
              <span className="rr-summary-lbl">ONLINE</span>
            </div>
            <div className="rr-summary-box">
              <span className="rr-summary-val" style={{ color: '#ff8c00' }}>{scan.summary.degraded}</span>
              <span className="rr-summary-lbl">DEGRADED</span>
            </div>
            <div className="rr-summary-box">
              <span className="rr-summary-val" style={{ color: '#ff3344' }}>{scan.summary.offline}</span>
              <span className="rr-summary-lbl">OFFLINE</span>
            </div>
          </div>

          <div className="rr-ref">
            <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
              Live scan from Pi status API, Docker over SSH, Tailscale, and inventory artifact.
            </span>
          </div>

          {scan.findings.length > 0 && (
            <div className="infra-findings">
              {scan.findings.map((finding, index) => (
                <div key={index} className="infra-finding" style={{ borderColor: severityColor(finding.severity) + '55' }}>
                  <span style={{ color: severityColor(finding.severity), fontWeight: 700 }}>{finding.severity.toUpperCase()}</span>
                  <span>{finding.message}</span>
                </div>
              ))}
            </div>
          )}

          <div className="infra-list">
            {Object.entries(nodesByKind).map(([kind, nodes]) => (
              <div key={kind} className="infra-group">
                <div className="rr-section-label" style={{ color: 'var(--accent)' }}>{kind.toUpperCase()} ({nodes.length})</div>
                {nodes.map(node => <NodeRow key={node.id} node={node} />)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
