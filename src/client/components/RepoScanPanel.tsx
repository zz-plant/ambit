import React, { useEffect, useState } from 'react';

interface RepoInfo {
  name: string;
  drift: number;
  driftItems: number;
  uniqueMcps: string[];
  missingMcps: string[];
  uniqueAgents: string[];
  uniqueCommands: string[];
  defaultAgent: string | null;
}

interface ScanResult {
  globalStats: { mcps: number; agents: number; commands: number; providers: number; totalRepos: number };
  repos: RepoInfo[];
}

function driftColor(d: number): string {
  if (d <= 10) return '#00ff88';
  if (d <= 30) return '#ffd600';
  if (d <= 60) return '#ff8c00';
  return '#ff3344';
}

function RepoRow({ repo }: { repo: RepoInfo }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = repo.uniqueMcps.length > 0 || repo.missingMcps.length > 0 || repo.uniqueAgents.length > 0;

  return (
    <div className={`rr ${expanded ? 'rr--open' : ''}`}>
      <div className="rr-hdr" onClick={() => setExpanded(o => !o)}>
        <div className="rr-name-group">
          <span className="rr-name">{repo.name}</span>
          {repo.defaultAgent && <span className="rr-tag">{repo.defaultAgent}</span>}
        </div>
        <div className="rr-drift-wrap">
          <div className="rr-drift-bar">
            <div className="rr-drift-fill" style={{ width: `${repo.drift}%`, background: driftColor(repo.drift) }} />
          </div>
          <span className="rr-drift-num" style={{ color: driftColor(repo.drift) }}>{repo.drift}%</span>
        </div>
        <span className="rr-expand">{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && hasDetail && (
        <div className="rr-detail">
          {repo.missingMcps.length > 0 && (
            <div className="rr-section">
              <span className="rr-section-label" style={{ color: '#ff8c00' }}>MISSING ({repo.missingMcps.length})</span>
              <div className="rr-tags">
                {repo.missingMcps.map(m => (
                  <span key={m} className="rr-tag rr-tag--warn">{m}</span>
                ))}
              </div>
            </div>
          )}
          {repo.uniqueMcps.length > 0 && (
            <div className="rr-section">
              <span className="rr-section-label" style={{ color: '#00d4ff' }}>UNIQUE ({repo.uniqueMcps.length})</span>
              <div className="rr-tags">
                {repo.uniqueMcps.map(m => (
                  <span key={m} className="rr-tag rr-tag--unique">{m}</span>
                ))}
              </div>
            </div>
          )}
          {repo.uniqueAgents.length > 0 && (
            <div className="rr-section">
              <span className="rr-section-label" style={{ color: '#00ff88' }}>AGENTS ({repo.uniqueAgents.length})</span>
              <div className="rr-tags">
                {repo.uniqueAgents.map(a => (
                  <span key={a} className="rr-tag rr-tag--agent">{a}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RepoScanPanel() {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runScan = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/repos/scan');
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setScan(data);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  };

  useEffect(() => { runScan(); }, []);

  if (error) {
    return (
      <div className="diag-panel">
        <div className="dp-hdr"><h3>◈ SECTOR SCAN</h3></div>
        <div className="dp-empty">
          <p style={{ color: 'var(--error)', marginBottom: 8 }}>{error}</p>
          <button className="tp-btn" onClick={runScan}>RETRY</button>
        </div>
      </div>
    );
  }

  if (loading && !scan) {
    return (
      <div className="diag-panel">
        <div className="dp-hdr"><h3>◈ SECTOR SCAN</h3></div>
        <div className="dp-empty">
          <div className="app-loading-ring" style={{ margin: '0 auto 8px' }} />
          <p style={{ color: 'var(--text-muted)' }}>Scanning sectors…</p>
        </div>
      </div>
    );
  }

  const highDrift = scan?.repos.filter(r => r.drift > 30).length || 0;
  const totalRepos = scan?.repos.length || 0;

  return (
    <div className="diag-panel">
      <div className="dp-hdr">
        <h3>◈ SECTOR SCAN</h3>
        <button className="dp-run-all" onClick={runScan} disabled={loading}>
          {loading ? 'SCANNING…' : 'RESCAN'}
        </button>
      </div>

      {scan && (
        <>
          <div className="rr-summary">
            <div className="rr-summary-box">
              <span className="rr-summary-val">{scan.globalStats.totalRepos}</span>
              <span className="rr-summary-lbl">SECTORS</span>
            </div>
            <div className="rr-summary-box">
              <span className="rr-summary-val" style={{ color: highDrift > 0 ? '#ff8c00' : '#00ff88' }}>{highDrift}</span>
              <span className="rr-summary-lbl">DRIFT &gt;30%</span>
            </div>
            <div className="rr-summary-box">
              <span className="rr-summary-val">{scan.globalStats.mcps + scan.globalStats.agents}</span>
              <span className="rr-summary-lbl">GLOBAL ASSETS</span>
            </div>
          </div>

          <div className="rr-ref">
            <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>Global config serves as reference. Drift = items differing from global.</span>
          </div>

          <div className="rr-list">
            {scan.repos.map(repo => (
              <RepoRow key={repo.name} repo={repo} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
