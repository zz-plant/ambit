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

  // The old headline was a 0-100 "rating" averaged from an invented penalty
  // scale (100 minus 35 per error, 20 per warning, 5 per note). Nobody could
  // check it, and it read as a measurement. These counts are the input to that
  // number and are directly verifiable against the list below.
  const tally = hasResults
    ? defList.reduce(
        (acc, d) => {
          for (const f of results[d.id]?.findings || []) {
            if (f.severity === 'error') acc.errors++;
            else if (f.severity === 'warn') acc.warnings++;
            else acc.notes++;
          }
          return acc;
        },
        { errors: 0, warnings: 0, notes: 0 }
      )
    : null;

  return (
    <div className="diag-panel">
      <div className="dp-hdr">
        <h3>◈ Diagnostics</h3>
        <button className="dp-run-all" onClick={runAll} title="Run all diagnostics">Run All</button>
      </div>

      {itemCount === 0 && (
        <div className="dp-empty">Select a capability to run checks on it</div>
      )}

      {tally !== null && (
        <div className="dp-tally">
          <span className="dp-tally-item dp-tally-error">{tally!.errors} problem{tally!.errors === 1 ? '' : 's'}</span>
          <span className="dp-tally-item dp-tally-warn">{tally!.warnings} warning{tally!.warnings === 1 ? '' : 's'}</span>
          <span className="dp-tally-item dp-tally-note">{tally!.notes} note{tally!.notes === 1 ? '' : 's'}</span>
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
                  <span className="dp-card-score" title={`${findings.length} finding${findings.length === 1 ? '' : 's'}`}
                    style={{ color: scoreColor(result.score), borderColor: scoreColor(result.score) }}>
                    {findings.length}
                  </span>
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
                <div className="dp-clean">NO ISSUES FOUND</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
