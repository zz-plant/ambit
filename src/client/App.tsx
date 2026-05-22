import React, { useEffect, useState } from 'react';
import Constellation from './components/Constellation';
import StarPanel from './components/StarPanel';
import DiagnosticsPanel from './components/ConsultantPanel';
import RepoScanPanel from './components/RepoScanPanel';
import ToolchainPanel from './components/ToolchainPanel';
import InfrastructurePanel from './components/InfrastructurePanel';
import { useToolchainStore } from './store/toolchainStore';

type Tab = 'contacts' | 'edge' | 'diagnostics' | 'scan';

function UplinkModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const addMcpServer = useToolchainStore(s => s.addMcpServer);
  const loading = useToolchainStore(s => s.loading);

  const [name, setName] = useState('');
  const [type, setType] = useState<'local' | 'remote'>('local');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [envStr, setEnvStr] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    const config: any = { type, enabled: true };

    if (type === 'remote') {
      if (!url.trim()) {
        setError('URL is required for remote server');
        return;
      }
      config.url = url.trim();
    } else {
      if (!command.trim()) {
        setError('Command is required for local server');
        return;
      }
      config.command = command.trim().split(/\s+/);
    }

    if (envStr.trim()) {
      const env: Record<string, string> = {};
      const lines = envStr.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split('=');
        if (parts.length < 2) {
          setError(`Invalid environment variable line: "${line}". Must be KEY=VALUE`);
          return;
        }
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        env[key] = value;
      }
      config.env = env;
    }

    const ok = await addMcpServer(name.trim(), config);
    if (ok) {
      setName('');
      setType('local');
      setUrl('');
      setCommand('');
      setEnvStr('');
      onClose();
    } else {
      setError('Uplink failed. Check console or server logs.');
    }
  };

  return (
    <div className="uplink-modal-overlay">
      <div className="uplink-modal">
        <div className="sp-hdr">
          <span className="sp-sig" style={{ color: 'var(--accent)' }}>🔌</span>
          <div className="sp-title-group">
            <div className="sp-designation">ESTABLISH UPLINK</div>
            <div className="sp-class">REGISTER NEW MCP SERVER</div>
          </div>
          <button className="sp-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
          {error && <div style={{ color: 'var(--error)', fontSize: '11px', border: '1px solid var(--error)', padding: '6px', background: 'rgba(255, 51, 68, 0.1)', borderRadius: 'var(--radius)' }}>{error}</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>SERVER IDENTIFIER</label>
            <input
              type="text"
              placeholder="e.g. github-mcp"
              value={name}
              onChange={e => setName(e.target.value)}
              className="tp-search"
              required
            />
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              className="tp-btn-sm"
              style={{ flex: 1, borderColor: type === 'local' ? 'var(--accent)' : 'var(--border)', color: type === 'local' ? 'var(--accent)' : 'var(--text-muted)' }}
              onClick={() => setType('local')}
            >
              LOCAL
            </button>
            <button
              type="button"
              className="tp-btn-sm"
              style={{ flex: 1, borderColor: type === 'remote' ? 'var(--accent)' : 'var(--border)', color: type === 'remote' ? 'var(--accent)' : 'var(--text-muted)' }}
              onClick={() => setType('remote')}
            >
              REMOTE (SSE)
            </button>
          </div>

          {type === 'remote' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <label style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>ENDPOINT URL</label>
              <input
                type="url"
                placeholder="http://localhost:3000/sse"
                value={url}
                onChange={e => setUrl(e.target.value)}
                className="tp-search"
                required
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <label style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>COMMAND / ARGUMENTS</label>
              <input
                type="text"
                placeholder="e.g. npx -y @modelcontextprotocol/server-github"
                value={command}
                onChange={e => setCommand(e.target.value)}
                className="tp-search"
                required
              />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>ENVIRONMENT VARIABLES (KEY=VALUE, one per line)</label>
            <textarea
              placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=your_token_here"
              value={envStr}
              onChange={e => setEnvStr(e.target.value)}
              className="tp-search"
              style={{ minHeight: '60px', fontFamily: 'var(--font)', resize: 'vertical' }}
            />
          </div>

          <button type="submit" className="tp-btn" style={{ width: '100%', marginTop: '10px' }} disabled={loading}>
            {loading ? 'UPLINKING...' : 'ESTABLISH CONNECTION'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const items = useToolchainStore(s => s.items);
  const connections = useToolchainStore(s => s.connections);
  const showStarPanel = useToolchainStore(s => s.showStarPanel);
  const selectedId = useToolchainStore(s => s.selectedItem);
  const selectItem = useToolchainStore(s => s.selectItem);
  const loading = useToolchainStore(s => s.loading);
  const error = useToolchainStore(s => s.error);
  const loadConfig = useToolchainStore(s => s.loadConfig);

  const layoutMode = useToolchainStore(s => s.layoutMode);
  const setLayoutMode = useToolchainStore(s => s.setLayoutMode);
  const showUplinkModal = useToolchainStore(s => s.showUplinkModal);
  const setShowUplinkModal = useToolchainStore(s => s.setShowUplinkModal);

  const [leftTab, setLeftTab] = useState<Tab>('contacts');
  const [leftOpen, setLeftOpen] = useState(true);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  return (
    <div className="app">
      <div className="app-scene">
        {loading && !items.length && (
          <div className="app-loading">
            <div className="app-loading-ring" />
            <p>Acquiring sensor lock…</p>
          </div>
        )}
        {error && (
          <div className="app-error">
            <p>{error}</p>
            <button className="tp-btn" onClick={() => loadConfig()}>RECONNECT</button>
          </div>
        )}
        <Constellation />
      </div>

      {showStarPanel && selectedId && (
        <div className="app-panel-overlay">
          <StarPanel />
        </div>
      )}

      <aside className={`app-console ${leftOpen ? 'app-console--open' : ''}`}>
        <div className="app-console-tabs">
          <button className={`app-console-tab ${leftTab === 'contacts' ? 'active' : ''}`}
            onClick={() => setLeftTab('contacts')}>CONTACTS</button>
          <button className={`app-console-tab ${leftTab === 'edge' ? 'active' : ''}`}
            onClick={() => setLeftTab('edge')}>EDGE</button>
          <button className={`app-console-tab ${leftTab === 'diagnostics' ? 'active' : ''}`}
            onClick={() => setLeftTab('diagnostics')}>DIAGNOSTICS</button>
          <button className={`app-console-tab ${leftTab === 'scan' ? 'active' : ''}`}
            onClick={() => setLeftTab('scan')}>SCAN</button>
        </div>
        {leftTab === 'contacts' ? <ToolchainPanel /> : leftTab === 'edge' ? <InfrastructurePanel /> : leftTab === 'diagnostics' ? <DiagnosticsPanel /> : <RepoScanPanel />}
      </aside>

      <div className="app-hud">
        <button className="app-hud-btn" onClick={() => setLeftOpen(o => !o)} title="Toggle console">
          {leftOpen ? '◀' : '▶'}
        </button>
        <button className="app-hud-btn" onClick={loadConfig} title="Refresh scan">
          ↺
        </button>
        {selectedId && (
          <button className="app-hud-btn" onClick={() => selectItem(null)} title="Deselect">
            ✕
          </button>
        )}

        {/* Layout Modes */}
        <div style={{ display: 'flex', gap: '1px', border: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '1px', marginLeft: '8px' }}>
          {(['constellation', 'orbital', 'flat'] as const).map(m => (
            <button
              key={m}
              className={`app-hud-btn`}
              style={{
                width: 'auto',
                padding: '0 8px',
                border: 'none',
                background: layoutMode === m ? 'var(--accent)' : 'transparent',
                color: layoutMode === m ? 'var(--bg-deep)' : 'var(--text-muted)',
                fontWeight: layoutMode === m ? 700 : 'normal',
                fontSize: '9px',
                height: '22px'
              }}
              onClick={() => setLayoutMode(m)}
              title={`${m.toUpperCase()} layout`}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <UplinkModal isOpen={showUplinkModal} onClose={() => setShowUplinkModal(false)} />

      <footer className="app-footer">
        <span className="app-footer-title">◈ SENSOR ARRAY</span>
        <span className="app-footer-info">
          {items.length} contacts · {connections.length} data links
        </span>
        <span className="app-footer-hint">ORBIT · SELECT · DIAGNOSE</span>
      </footer>
    </div>
  );
}
