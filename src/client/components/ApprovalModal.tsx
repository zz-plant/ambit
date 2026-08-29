import React, { useState } from 'react';
import { useToolchainStore } from '../store/toolchainStore';

export function ApprovalModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const proposals = useToolchainStore(s => s.proposals);
  const approveProposal = useToolchainStore(s => s.approveProposal);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  return (
    <div className="uplink-modal-overlay">
      <div className="uplink-modal" style={{ maxWidth: '640px', width: '90%' }}>
        <div className="sp-hdr">
          <span className="sp-sig" style={{ color: 'var(--ok, #2a9d8f)' }}>🛡️</span>
          <div className="sp-title-group">
            <div className="sp-designation">Proposal Approval Broker</div>
            <div className="sp-class">Review and sign environment configuration changes</div>
          </div>
          <button className="sp-close" onClick={onClose}>✕</button>
        </div>

        {proposals.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            No pending proposals. Autonomous agents will submit proposals here when hitting restricted actions.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '14px', maxHeight: '420px', overflowY: 'auto' }}>
            {proposals.map((p) => {
              let parsedSteps: any[] = [];
              try { parsedSteps = JSON.parse(p.steps); } catch { /* ignore */ }
              const isApproved = p.status === 'approved';

              return (
                <div
                  key={p.id}
                  style={{
                    background: 'var(--bg-deep, #141923)',
                    border: isApproved ? '1px solid var(--ok, #2a9d8f)' : '1px solid var(--border, #2a3447)',
                    borderRadius: '8px',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '12px', color: 'var(--accent, #e76f51)' }}>
                      {p.id}
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontWeight: 600,
                        background: isApproved ? 'rgba(42, 157, 143, 0.2)' : 'rgba(231, 111, 81, 0.2)',
                        color: isApproved ? 'var(--ok, #2a9d8f)' : 'var(--accent, #e76f51)',
                      }}
                    >
                      {isApproved ? '✓ APPROVED' : 'PENDING APPROVAL'}
                    </span>
                  </div>

                  <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text, #fff)' }}>
                    {p.goal}
                  </div>

                  {parsedSteps.length > 0 && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Action Steps:</span>
                      {parsedSteps.map((step, idx) => (
                        <div key={idx} style={{ paddingLeft: '8px', borderLeft: '2px solid var(--border)' }}>
                          <code>{step.action || step.key || JSON.stringify(step)}</code>
                          {step.provider && <span style={{ marginLeft: '6px', opacity: 0.7 }}>via {step.provider}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {isApproved ? (
                    <div style={{ marginTop: '6px', paddingTop: '8px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '10px', color: 'var(--ok)' }}>
                        Signed by {p.approved_by || 'Kanav'} · Artifact HMAC verified
                      </span>
                      <button
                        type="button"
                        className="sp-action-btn"
                        style={{ fontSize: '10px', padding: '4px 10px' }}
                        onClick={() => copyApplyCmd(p.id)}
                      >
                        {copiedId === p.id ? '✓ Copied' : `Copy: ambit apply ${p.id}`}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                      <button
                        type="button"
                        className="sp-action-btn"
                        style={{ background: 'var(--ok, #2a9d8f)', color: '#fff', fontWeight: 600 }}
                        disabled={approvingId === p.id}
                        onClick={() => handleApprove(p.id)}
                      >
                        {approvingId === p.id ? 'Signing HMAC Token…' : 'Approve & Mint Receipt'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <button type="button" className="sp-action-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default ApprovalModal;
