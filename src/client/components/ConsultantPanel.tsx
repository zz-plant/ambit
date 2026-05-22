import React from 'react';
import { useToolchainStore } from '../store/toolchainStore';

function scoreColor(s: number) {
  if (s >= 80) return '#00ff88';
  if (s >= 50) return '#ff8c00';
  return '#ff3344';
}

function categoryStyle(cat: string) {
  const colors: Record<string, string> = {
    'Gap': 'var(--accent)',
    'Level-up': '#ffd600',
    'Modernization': '#ff8c00',
    'Scale': '#4488ff',
    'Housekeeping': '#8899aa',
  };
  return { color: colors[cat] || 'var(--text-muted)' };
}

export default function DiagnosticsPanel() {
  const results = useToolchainStore(s => s.consultantResults);
  const runConsultant = useToolchainStore(s => s.runConsultant);
  const runAll = useToolchainStore(s => s.runAllConsultants);
  const defs = useToolchainStore(s => s.getConsultantDefs);
  const itemCount = useToolchainStore(s => s.items.length);
  const applyFindingAction = useToolchainStore(s => s.applyFindingAction);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const defList = defs();
  const hasResults = Object.keys(results).length > 0;

  const overall = hasResults
    ? Math.round(defList.reduce((s, d) => s + (results[d.id]?.score ?? 0), 0) / defList.length)
    : null;

  return (
    <div className="diag-panel">
      <div className="dp-hdr">
        <h3>◈ Diagnostics</h3>
        <button className="dp-run-all" onClick={runAll} title="Run all diagnostics">Run All</button>
      </div>

      {itemCount === 0 && (
        <div className="dp-empty">No contacts in sensor range</div>
      )}

      {overall !== null && (
        <div className="dp-scoreboard">
          <div className="dp-score-ring" style={{
            background: `conic-gradient(${scoreColor(overall)} ${overall * 3.6}deg, #101e30 0deg)`,
          }}>
            <div className="dp-score-inner">
              <span className="dp-score-num">{overall}</span>
              <span className="dp-score-lbl">rating</span>
            </div>
          </div>
          <div className="dp-breakdown">
            {defList.map(d => {
              const r = results[d.id];
              const s = r?.score ?? 0;
              return (
                <div key={d.id} className="dp-row" onClick={() => runConsultant(d.id)}>
                  <span className="dp-dot" style={{ background: scoreColor(s) }} />
                  <span className="dp-row-name">{d.icon} {d.label}</span>
                  <span className="dp-row-val" style={{ color: scoreColor(s) }}>{s}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="dp-list">
        {defList.map(def => {
          const result = results[def.id];
          const showAll = expanded[def.id] || false;
          const findings = result?.findings || [];

          return (
            <div key={def.id} className={`dp-card ${result ? 'dp-card--done' : ''}`}
              onClick={() => runConsultant(def.id)}
            >
              <div className="dp-card-hdr">
                <span className="dp-card-sig" style={{ color: def.color }}>{def.icon}</span>
                <div>
                  <div className="dp-card-name">{def.label}</div>
                  <div className="dp-card-desc">{def.description}</div>
                </div>
                {result && (
                  <span className="dp-card-score" style={{
                    color: scoreColor(result.score),
                    borderColor: scoreColor(result.score),
                  }}>{result.score}</span>
                )}
              </div>
              {findings.length > 0 && (
                <div className="dp-findings">
                  {(showAll ? findings : findings.slice(0, 5)).map((f, i) => {
                    const catMatch = f.message.match(/^\[(\w+)\]/);
                    const cat = catMatch ? catMatch[1] : null;
                    const displayMsg = catMatch ? f.message.slice(catMatch[0].length) : f.message;
                    return (
                      <div key={i} className="dp-finding" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' }}>
                        <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flex: 1, minWidth: 0 }}>
                          <span style={{ flexShrink: 0, fontSize: '8px', color: 'var(--text-muted)' }}>
                            {f.severity === 'error' ? '!' : f.severity === 'warn' ? '~' : 'i'}
                          </span>
                          {cat && (
                            <span style={{
                              fontSize: '7px', padding: '0 3px', letterSpacing: '0.3px',
                              border: '1px solid ' + (categoryStyle(cat).color || 'var(--border)'),
                              color: categoryStyle(cat).color || 'var(--text-muted)',
                              flexShrink: 0,
                            }}>
                              {cat}
                            </span>
                          )}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.message}>
                            {displayMsg}
                          </span>
                        </div>
                        {f.action && (
                          <button
                            className="tp-btn-sm"
                            style={{
                              flexShrink: 0, padding: '1px 4px', fontSize: '8px',
                              background: 'var(--bg-deep)', color: 'var(--accent)',
                              border: '1px solid var(--accent-dim)', cursor: 'pointer',
                              textTransform: 'uppercase', fontFamily: 'var(--font)'
                            }}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (f.action) {
                                await applyFindingAction(f.action);
                                runConsultant(def.id);
                              }
                            }}
                          >
                            RESOLVE
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {findings.length > 5 && !showAll && (
                    <button
                      className="tp-btn-sm"
                      style={{ width: '100%', marginTop: '2px', textAlign: 'center' }}
                      onClick={(e) => { e.stopPropagation(); setExpanded(p => ({ ...p, [def.id]: true })); }}
                    >
                      +{findings.length - 5} MORE
                    </button>
                  )}
                  {findings.length > 5 && showAll && (
                    <button
                      className="tp-btn-sm"
                      style={{ width: '100%', marginTop: '2px', textAlign: 'center' }}
                      onClick={(e) => { e.stopPropagation(); setExpanded(p => ({ ...p, [def.id]: false })); }}
                    >
                      SHOW LESS
                    </button>
                  )}
                </div>
              )}
              {result && findings.length === 0 && (
                <div className="dp-clean">NOMINAL</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
