import { useEffect, useState } from 'react';
import type { ProposalDecision } from '../../shared/api';
import { useAmbitStore } from '../store/ambitStore';
import { WEB_ACTOR } from '../utils/copy';
import { NUM, money } from './figures';

/**
 * The four things a decision needs, in a fixed order: what it saves, what it
 * costs, whether it can be undone, and how this person has decided on things
 * like it before. The card showed the goal and the steps; the engine had
 * stored all four and the browser drew none.
 */
function DecisionRows({ d }: { d: ProposalDecision }) {
  const tenth = (n: number) => Math.round(n * 10) / 10;
  const rows: [string, string][] = [
    [
      'Saves',
      d.forecast
        ? `${tenth(d.forecast.hours_month_now - d.forecast.hours_month_after)}h a month · ${money(
            d.forecast.savings_dollars_month
          )} a month · ${d.forecast.confidence} confidence`
        : 'nothing forecast: no recurring interruption was recorded against it',
    ],
    [
      'Costs',
      `${d.setup_hours}h of setup · ${d.recurring ? `${d.recurring} recurring` : 'no recurring cost'}${
        d.privacy ? ` · ${d.privacy}` : ''
      }`,
    ],
    [
      'Undo',
      d.reversible
        ? 'every step is a config change with an inverse; apply rolls back on a failed check'
        : d.requires_person
          ? 'a step is work only a person can do, so this stays a document'
          : 'a step has no computed inverse, so this stays a document',
    ],
  ];
  if (d.unlocks.length) rows.push(['Unlocks', d.unlocks.join(', ')]);
  if (d.precedent.length) {
    rows.push([
      'Precedent',
      d.precedent
        .map(
          l => `${l.trait.replace(':', ' ')} ${l.leans} ${l.approved} of ${l.approved + l.rejected}`
        )
        .join(' · '),
    ]);
  }
  return (
    <dl className="gov-decision" style={NUM}>
      {rows.map(([term, value]) => (
        <div key={term} className="gov-decision-row">
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** How the signer reads in the panel: the browser's own approvals are "you". */
function signerLabel(actor: string | null | undefined): string {
  if (!actor || actor === WEB_ACTOR) return 'you';
  return actor.replace(/^human:/, '');
}

export function ApprovalModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const proposals = useAmbitStore(s => s.proposals);
  const approveProposal = useAmbitStore(s => s.approveProposal);
  const rejectProposal = useAmbitStore(s => s.rejectProposal);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState<'all' | 'draft' | 'approved' | 'rejected'>('all');
  // A no in progress: which card, and the reason typed so far. The reason is
  // optional and is the most valuable part of the record.
  const [declining, setDeclining] = useState<{ id: string; reason: string } | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

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
    setDecisionError(null);
    const result = await approveProposal(proposalId, WEB_ACTOR);
    if (!result.ok) setDecisionError(result.error || 'Could not record the approval.');
    setApprovingId(null);
  };

  const handleReject = async () => {
    if (!declining) return;
    setDecisionError(null);
    const result = await rejectProposal(declining.id, declining.reason.trim() || undefined);
    if (!result.ok) setDecisionError(result.error || 'Could not record the decision.');
    else setDeclining(null);
  };

  const copyApplyCmd = (id: string) => {
    navigator.clipboard?.writeText(`ambit apply ${id}`);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const filtered = proposals.filter(p => statusTab === 'all' || p.status === statusTab);

  const draftCount = proposals.filter(p => p.status === 'draft').length;
  const approvedCount = proposals.filter(p => p.status === 'approved').length;
  const rejectedCount = proposals.filter(p => p.status === 'rejected').length;
  const tabs: [typeof statusTab, string][] = [
    ['all', `All (${proposals.length})`],
    ['draft', `Waiting${draftCount > 0 ? ` (${draftCount})` : ''}`],
    ['approved', `Approved (${approvedCount})`],
    ...(rejectedCount > 0
      ? ([['rejected', `Turned down (${rejectedCount})`]] as [typeof statusTab, string][])
      : []),
  ];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click to dismiss modal
    <div className="uplink-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="uplink-modal"
        style={{ maxWidth: '680px', width: '90%' }}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="proposals-title"
      >
        <div className="sp-hdr">
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="sp-modal-icon"
            aria-hidden="true"
          >
            <path d="M4 3 H13 L17 7 V17 H4 Z" />
            <path d="M12 3 V7 H16" />
            <path d="M7 11 H13 M7 14 H11" strokeWidth="1.4" />
          </svg>
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

        {/* Three tabs and no search box: a machine holds a handful of
            proposals at a time, and a search over five cards is a control
            that never earns its row. */}
        <div className="gov-tabs" role="tablist" aria-label="Filter proposals">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              className={`gov-tab ${statusTab === key ? 'gov-tab--active' : ''}`}
              aria-selected={statusTab === key}
              onClick={() => setStatusTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="gov-empty">
            {proposals.length === 0
              ? 'Nothing waiting. When an agent needs a change to your setup, it appears here for you to approve.'
              : statusTab === 'draft'
                ? 'Nothing waiting for your approval.'
                : statusTab === 'rejected'
                  ? 'Nothing turned down.'
                  : 'Nothing approved yet.'}
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
              const isApproved = p.status === 'approved' || p.status === 'applied';
              const isRejected = p.status === 'rejected';
              const isDeclining = declining?.id === p.id;

              return (
                <div
                  key={p.id}
                  className={`gov-card ${isApproved ? 'gov-card--approved' : ''} ${isRejected ? 'gov-card--rejected' : ''}`}
                >
                  <div className="gov-card-head">
                    <code className="gov-id">{p.id}</code>
                    <span
                      className={`gov-status ${isApproved ? 'gov-status--approved' : ''} ${isRejected ? 'gov-status--rejected' : ''}`}
                    >
                      {p.status === 'applied'
                        ? 'Applied'
                        : isApproved
                          ? 'Approved'
                          : isRejected
                            ? 'Turned down'
                            : 'Waiting for your approval'}
                    </span>
                  </div>

                  <div className="gov-goal">{p.goal}</div>

                  {p.decision && <DecisionRows d={p.decision} />}

                  {parsedSteps.length > 0 && (
                    <div className="gov-steps">
                      <div className="sp-section-label">
                        {parsedSteps.length} {parsedSteps.length === 1 ? 'step' : 'steps'}
                      </div>
                      {/* An engine step is {id, name, chosen, …}; the demo's
                          hand-written ones are {action, provider}. Either reads
                          as a name and what supplies it; a step shaped some third
                          way used to print as its own JSON. */}
                      {parsedSteps.map((step, idx) => (
                        <div key={idx} className="gov-step">
                          <code>{step.name || step.action || step.key || step.id || 'step'}</code>
                          {(step.chosen || step.provider) && (
                            <span className="gov-step-via">via {step.chosen || step.provider}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {isDeclining && (
                    <div className="gov-decline">
                      <label className="gov-decline-label" htmlFor={`decline-${p.id}`}>
                        Why not? Optional, and what the next draft learns from.
                      </label>
                      <input
                        id={`decline-${p.id}`}
                        className="tp-search gov-decline-input"
                        placeholder="too expensive, wrong provider, not this quarter…"
                        value={declining.reason}
                        onChange={e => setDeclining({ id: p.id, reason: e.target.value })}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleReject();
                        }}
                      />
                    </div>
                  )}

                  {decisionError && (declining?.id === p.id || approvingId === p.id) && (
                    <p className="gov-error">{decisionError}</p>
                  )}

                  <div className="gov-foot">
                    {isApproved ? (
                      <>
                        <span className="gov-signed">
                          Signed by {signerLabel(p.approved_by)} · receipt verified
                        </span>
                        {p.status !== 'applied' && (
                          <button
                            type="button"
                            className="tp-btn-sm"
                            onClick={() => copyApplyCmd(p.id)}
                          >
                            {copiedId === p.id ? 'Copied' : `Copy: ambit apply ${p.id}`}
                          </button>
                        )}
                      </>
                    ) : isRejected ? (
                      <span className="gov-hint">
                        Recorded. A no teaches the next draft what to choose instead.
                      </span>
                    ) : isDeclining ? (
                      <>
                        <button
                          type="button"
                          className="tp-btn-sm"
                          onClick={() => setDeclining(null)}
                        >
                          Keep it waiting
                        </button>
                        <button type="button" className="tp-btn" onClick={handleReject}>
                          Record the no
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="gov-hint">
                          Approving signs a receipt; nothing runs yet.
                        </span>
                        <span className="gov-actions">
                          <button
                            type="button"
                            className="tp-btn-sm"
                            onClick={() => setDeclining({ id: p.id, reason: '' })}
                          >
                            Turn down
                          </button>
                          <button
                            type="button"
                            className="tp-btn tp-btn--primary"
                            disabled={approvingId === p.id}
                            onClick={() => handleApprove(p.id)}
                          >
                            {approvingId === p.id ? 'Signing…' : 'Approve and sign'}
                          </button>
                        </span>
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
