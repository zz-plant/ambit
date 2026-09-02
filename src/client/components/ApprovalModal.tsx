import { useEffect, useState } from 'react';
import { useAmbitStore } from '../store/ambitStore';
import { WEB_ACTOR } from '../utils/copy';

/** How the signer reads in the panel: the browser's own approvals are "you". */
function signerLabel(actor: string | null | undefined): string {
  if (!actor || actor === WEB_ACTOR) return 'you';
  return actor.replace(/^human:/, '');
}

export function ApprovalModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const proposals = useAmbitStore(s => s.proposals);
  const approveProposal = useAmbitStore(s => s.approveProposal);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState<'all' | 'draft' | 'approved'>('all');
  const [query, setQuery] = useState('');

  // Escape closes it. Dismissal used to be a click on the backdrop and nothing
  // else, which is unreachable without a pointer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!isOpen) return null;

  const handleApprove = async (proposalId: string) => {
    setApprovingId(proposalId);
    await approveProposal(proposalId, WEB_ACTOR);
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
  const tabs: [typeof statusTab, string][] = [
    ['all', `All (${proposals.length})`],
    ['draft', `Waiting${draftCount > 0 ? ` (${draftCount})` : ''}`],
    ['approved', `Approved (${approvedCount})`],
  ];

  return (
    <div className="uplink-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="uplink-modal"
        style={{ maxWidth: '680px', width: '90%' }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="proposals-title"
      >
        <div className="sp-hdr">
          <div className="sp-title-group">
            <h2 id="proposals-title" className="sp-designation">
              Proposals
            </h2>
            <div className="sp-class">
              Changes an agent wants to make to your setup. Nothing is applied until you approve it,
              and applying is a command you run.
            </div>
          </div>
          <button type="button" className="sp-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="gov-toolbar">
          <div className="gov-tabs" role="group" aria-label="Filter proposals">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`gov-tab ${statusTab === key ? 'gov-tab--active' : ''}`}
                aria-pressed={statusTab === key}
                onClick={() => setStatusTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="search"
            placeholder="Search proposals"
            aria-label="Search proposals"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="tp-search gov-search"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="gov-empty">
            {proposals.length === 0
              ? 'Nothing waiting. When an agent needs a change to your setup, it appears here for you to approve.'
              : 'No proposals match that filter.'}
          </div>
        ) : (
          <div className="gov-list">
            {filtered.map(p => {
              let parsedSteps: any[] = [];
              try {
                parsedSteps = JSON.parse(p.steps);
              } catch {
                /* ignore */
              }
              const isApproved = p.status === 'approved';

              return (
                <div key={p.id} className={`gov-card ${isApproved ? 'gov-card--approved' : ''}`}>
                  <div className="gov-card-head">
                    <code className="gov-id">{p.id}</code>
                    <span className={`gov-status ${isApproved ? 'gov-status--approved' : ''}`}>
                      {isApproved ? 'Approved' : 'Waiting for your approval'}
                    </span>
                  </div>

                  <div className="gov-goal">{p.goal}</div>

                  {parsedSteps.length > 0 && (
                    <div className="gov-steps">
                      <div className="sp-section-label">
                        {parsedSteps.length} {parsedSteps.length === 1 ? 'step' : 'steps'}
                      </div>
                      {parsedSteps.map((step, idx) => (
                        <div key={idx} className="gov-step">
                          <code>{step.action || step.key || JSON.stringify(step)}</code>
                          {step.provider && (
                            <span className="gov-step-via">via {step.provider}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="gov-foot">
                    {isApproved ? (
                      <>
                        <span className="gov-signed">
                          Signed by {signerLabel(p.approved_by)} · receipt verified
                        </span>
                        <button
                          type="button"
                          className="tp-btn-sm"
                          onClick={() => copyApplyCmd(p.id)}
                        >
                          {copiedId === p.id ? 'Copied' : `Copy: ambit apply ${p.id}`}
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="gov-hint">
                          Approving signs a receipt; nothing runs yet.
                        </span>
                        <button
                          type="button"
                          className="tp-btn tp-btn--primary"
                          disabled={approvingId === p.id}
                          onClick={() => handleApprove(p.id)}
                        >
                          {approvingId === p.id ? 'Signing…' : 'Approve and sign'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default ApprovalModal;
