import { useState } from 'react';
import { useToolchainStore } from '../store/toolchainStore';

export function ApprovalModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const proposals = useToolchainStore(s => s.proposals);
  const approveProposal = useToolchainStore(s => s.approveProposal);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState<'all' | 'draft' | 'approved'>('all');
  const [query, setQuery] = useState('');

  if (!isOpen) return null;

  const handleApprove = async (proposalId: string) => {
    setApprovingId(proposalId);
    await approveProposal(proposalId, 'human:kanav');
    setApprovingId(null);
  };

  const copyApplyCmd = (id: string) => {
    navigator.clipboard?.writeText(`ambit apply ${id}`);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const filtered = proposals.filter(p => {
    const matchesTab = statusTab === 'all' || p.status === statusTab;
    const matchesQuery =
      !query.trim() ||
      p.id.toLowerCase().includes(query.toLowerCase()) ||
      p.goal.toLowerCase().includes(query.toLowerCase());
    return matchesTab && matchesQuery;
  });

  const draftCount = proposals.filter(p => p.status === 'draft').length;
  const approvedCount = proposals.filter(p => p.status === 'approved').length;

  return (
    <div className="uplink-modal-overlay" onClick={onClose}>
      <div
        className="uplink-modal"
        style={{ maxWidth: '680px', width: '90%', border: '1px solid var(--border-bright)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="sp-hdr">
          <span className="sp-sig" style={{ color: 'var(--copper-3)' }}>
            📜
          </span>
          <div className="sp-title-group">
            <div className="sp-designation">Governance &amp; Policy Enactments</div>
            <div className="sp-class">Review, sign, and authorize environment modifications</div>
          </div>
          <button type="button" className="sp-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Status Tabs and Search Filter */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '12px',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div className="gov-tabs">
            <button
              type="button"
              className={`gov-tab ${statusTab === 'all' ? 'gov-tab--active' : ''}`}
              onClick={() => setStatusTab('all')}
            >
              All ({proposals.length})
            </button>
            <button
              type="button"
              className={`gov-tab ${statusTab === 'draft' ? 'gov-tab--active' : ''}`}
              onClick={() => setStatusTab('draft')}
            >
              Pending Review {draftCount > 0 && `(${draftCount})`}
            </button>
            <button
              type="button"
              className={`gov-tab ${statusTab === 'approved' ? 'gov-tab--active' : ''}`}
              onClick={() => setStatusTab('approved')}
            >
              Ratified &amp; Signed ({approvedCount})
            </button>
          </div>

          <div style={{ width: '180px' }}>
            <input
              type="text"
              placeholder="Search proposals…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="tp-search"
              style={{ fontSize: '11px', padding: '4px 8px' }}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div
            style={{
              padding: '32px 0',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font)',
              fontSize: '12px',
            }}
          >
            {proposals.length === 0
              ? 'No pending policy proposals. Autonomous agents submit enactments here when requesting environment access.'
              : 'No proposals match your active filter.'}
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              marginTop: '12px',
              maxHeight: '460px',
              overflowY: 'auto',
            }}
          >
            {filtered.map(p => {
              let parsedSteps: any[] = [];
              try {
                parsedSteps = JSON.parse(p.steps);
              } catch {
                /* ignore */
              }
              const isApproved = p.status === 'approved';

              return (
                <div
                  key={p.id}
                  style={{
                    background: 'var(--bg-surface)',
                    border: isApproved ? '1px solid var(--ok)' : '1px solid var(--border)',
                    boxShadow: isApproved
                      ? '0 4px 20px rgba(16, 185, 129, 0.12)'
                      : '0 2px 8px rgba(0,0,0,0.15)',
                    borderRadius: 'var(--radius)',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: 4,
                      bottom: 0,
                      background: isApproved ? 'var(--ok)' : 'var(--accent)',
                    }}
                  />

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font)',
                        fontWeight: 700,
                        fontSize: '12px',
                        color: 'var(--accent)',
                      }}
                    >
                      📜 POLICY ENACTMENT: {p.id}
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '3px 10px',
                        borderRadius: 'var(--radius-xs)',
                        fontWeight: 800,
                        letterSpacing: '0.8px',
                        background: isApproved
                          ? 'rgba(0, 255, 136, 0.15)'
                          : 'rgba(255, 170, 0, 0.15)',
                        color: isApproved ? 'var(--ok)' : 'var(--copper-3)',
                        border: `1px solid ${isApproved ? 'var(--ok)' : 'var(--copper-3)'}`,
                      }}
                    >
                      {isApproved ? '✓ RATIFIED & SIGNED' : 'AWAITING OPERATOR RATIFICATION'}
                    </span>
                  </div>

                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      lineHeight: 1.4,
                    }}
                  >
                    {p.goal}
                  </div>

                  {parsedSteps.length > 0 && (
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-secondary)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        background: 'var(--bg-deep)',
                        padding: '10px',
                        borderRadius: 'var(--radius-xs)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: '10px',
                          textTransform: 'uppercase',
                          letterSpacing: '1px',
                          color: 'var(--text-muted)',
                        }}
                      >
                        Action Schedule ({parsedSteps.length} steps):
                      </span>
                      {parsedSteps.map((step, idx) => (
                        <div
                          key={idx}
                          style={{
                            paddingLeft: '8px',
                            borderLeft: '2px solid var(--accent-dim)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <code style={{ color: 'var(--accent)' }}>
                            {step.action || step.key || JSON.stringify(step)}
                          </code>
                          {step.provider && (
                            <span style={{ fontSize: '10px', color: 'var(--copper-3)' }}>
                              via {step.provider}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {isApproved ? (
                    <div
                      style={{
                        marginTop: '4px',
                        paddingTop: '10px',
                        borderTop: '1px solid var(--border)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontSize: '11px', color: 'var(--ok)', fontWeight: 600 }}>
                        🛡️ Sealed by {p.approved_by || 'Operator'} · HMAC verified
                      </span>
                      <button
                        type="button"
                        className="tp-btn-sm"
                        style={{
                          fontSize: '11px',
                          padding: '4px 12px',
                          borderColor: 'var(--ok)',
                          color: 'var(--ok)',
                        }}
                        onClick={() => copyApplyCmd(p.id)}
                      >
                        {copiedId === p.id ? '✓ Copied to Clipboard!' : `Copy: ambit apply ${p.id}`}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                      <button
                        type="button"
                        className="tp-btn"
                        style={{
                          background: 'var(--ok)',
                          color: 'var(--bg-deep)',
                          borderColor: 'var(--ok)',
                          fontWeight: 800,
                          padding: '6px 16px',
                        }}
                        disabled={approvingId === p.id}
                        onClick={() => handleApprove(p.id)}
                      >
                        {approvingId === p.id ? 'Minting HMAC Token…' : '⚖️ Ratify & Sign Policy'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <button type="button" className="tp-btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default ApprovalModal;
