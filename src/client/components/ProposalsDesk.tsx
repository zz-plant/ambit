import { useState } from 'react';
import type {
  ProposalDecision,
  ProposalRow,
  QueueDecisionResult,
  RejectionKind,
} from '../../shared/api';
import { useCopied } from '../hooks/useCopied';
import { useAmbitStore } from '../store/ambitStore';
import { WEB_ACTOR } from '../utils/copy';
import { ActorMark } from './ActorMark';
import { Seal, money } from './figures';

/**
 * What a step may be called, what supplies it, and whether it can be undone.
 * An engine step is `{id, name, chosen, inverse, …}`; the demo's hand-written
 * ones are `{action, provider, …}`. Either reads as a name and what supplies
 * it. The inverse used to be dropped here, so the panel could say a proposal
 * was not reversible and never which step was the reason.
 */
type StepLike = Partial<
  Record<'id' | 'name' | 'action' | 'key' | 'chosen' | 'provider', string>
> & { inverse?: unknown };

/** The stored steps are a JSON string; anything that is not a list of them is no steps. */
function parseSteps(steps: string): StepLike[] {
  try {
    const parsed: unknown = JSON.parse(steps);
    return Array.isArray(parsed) ? parsed.filter(s => s && typeof s === 'object') : [];
  } catch {
    return [];
  }
}

/**
 * The one-press answers to a no. Each names what the refusal is evidence
 * about, and records itself: the cost, the way chosen, the timing. The
 * words the engine classifies free text into, as the chips say them;
 * "Something else" asks for words instead.
 */
const REASONS: { label: string; kind: RejectionKind }[] = [
  { label: 'Too expensive', kind: 'cost' },
  { label: 'Wrong provider', kind: 'provider' },
  { label: 'Later', kind: 'later' },
];

/** The recorded no, said inline the way the chips say it. */
const REASON_WORDS = {
  ...Object.fromEntries(REASONS.map(({ kind, label }) => [kind, label.toLowerCase()])),
  other: 'something else',
} as Record<RejectionKind, string>;

/** Setup time the way a person says it: minutes under an hour. */
const setupLabel = (hours: number) => (hours < 1 ? `${Math.round(hours * 60)}m` : `${hours}h`);

/**
 * The plan in one line, above its steps: how many, whether they can be
 * undone, whether a person has to do one, and the setup time. A setup of zero
 * is steps that stated none, so it is left out, not printed as a time.
 */
function planTally(count: number, d?: ProposalDecision): string {
  const parts = [`${count} ${count === 1 ? 'step' : 'steps'}`];
  if (d) {
    parts.push(d.reversible ? 'reversible' : 'not reversible');
    if (d.requires_person) parts.push('needs a person');
    if (d.setup_hours > 0) parts.push(`${setupLabel(d.setup_hours)} of setup`);
  }
  return parts.join(' · ');
}

/**
 * What a decision needs, in a fixed order: what it is forecast to save, what
 * it costs, whether it can be undone, whether `ambit apply` can run it, and
 * how this person has decided on things like it before. Undo and Apply are
 * two facts on purpose: every step can carry an inverse and apply still
 * refuse a step that is not a config change, so one word cannot say both.
 */
function DecisionRows({ d }: { d: ProposalDecision }) {
  const tenth = (n: number) => Math.round(n * 10) / 10;
  const rows: [string, string][] = [
    [
      'Forecast',
      d.forecast
        ? `${tenth(d.forecast.hours_month_now)}h a month now, ${tenth(
            d.forecast.hours_month_after
          )}h after · saves ${money(d.forecast.savings_dollars_month)} a month · ${
            d.forecast.confidence
          } confidence`
        : 'nothing forecast: no recurring interruption was recorded against it',
    ],
    [
      'Costs',
      `${d.recurring ? `${d.recurring} recurring` : 'no recurring cost'}${
        d.privacy ? ` · ${d.privacy}` : ''
      }`,
    ],
    [
      'Undo',
      d.reversible
        ? 'every step has an inverse, computed before anything runs'
        : d.requires_person
          ? 'a step is work only a person can do, so it has no inverse'
          : 'a step has no computed inverse',
    ],
    [
      'Apply',
      d.applicable
        ? 'every step is a config change with an inverse; apply rolls back on a failed check'
        : d.reversible
          ? 'cannot be applied by ambit apply: a step is not a config change, and apply edits only configuration'
          : 'cannot be applied by ambit apply, which runs nothing without an inverse, so this stays a document',
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
    <dl className="gov-decision">
      {rows.map(([term, value]) => (
        <div key={term} className="gov-decision-row">
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What the last queue decision did, one line per id. */
interface QueueReport {
  decision: 'approve' | 'reject';
  results: QueueDecisionResult[];
  error?: string;
}

/**
 * The record of this person's decisions leans against something this draft
 * has, so the queue starts it unticked: one click should not sign what the
 * record says they usually refuse.
 */
const leansRefused = (p: ProposalRow) =>
  Boolean(p.decision?.precedent.some(l => l.leans === 'refused'));

/** The queue's answer, said once per outcome, with each refusal's reason. */
function QueueReportLines({ report }: { report: QueueReport }) {
  const decided = report.results.filter(r => r.decided).map(r => r.id);
  return (
    <div className="gov-queue-report" role="status">
      {decided.length > 0 && (
        <p className="gov-signed">
          {report.decision === 'approve' ? 'Approved and signed' : 'Turned down'}:{' '}
          {decided.join(', ')}
        </p>
      )}
      {report.results.map(r =>
        r.decided ? null : (
          <p key={r.id} className="gov-error">
            {r.id}: {r.refused}
          </p>
        )
      )}
      {report.error && <p className="gov-error">{report.error}</p>}
    </div>
  );
}

/** How the signer reads in the panel: the browser's own approvals are "you". */
function signerLabel(actor: string | null | undefined): string {
  if (!actor || actor === WEB_ACTOR) return 'you';
  return actor.replace(/^human:/, '');
}

/**
 * The decisions, drawn: the waiting drafts as a queue, each draft as a card,
 * and each decided one as its receipt. This is the body the Proposals view
 * shows, and the modal the demo's tour narrates over the map; the decisions
 * live in one place, so the two can never disagree about what approving does.
 */
export function ProposalsDesk() {
  const proposals = useAmbitStore(s => s.proposals);
  const approveProposal = useAmbitStore(s => s.approveProposal);
  const rejectProposal = useAmbitStore(s => s.rejectProposal);
  const decideQueue = useAmbitStore(s => s.decideQueue);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  // The queue: which waiting drafts are ticked. Null until a box is touched,
  // and until then every draft is ticked except one the record leans against.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [queueBusy, setQueueBusy] = useState<'approve' | 'reject' | null>(null);
  const [queueReport, setQueueReport] = useState<QueueReport | null>(null);
  const [copiedId, copy] = useCopied();
  const [statusTab, setStatusTab] = useState<'all' | 'draft' | 'approved' | 'rejected'>('all');
  // A no in progress: which card, the reason typed so far, and how it was
  // given. A chip is the whole answer and records itself; the text field is
  // for what the chips do not name, and "Something else" is the word that
  // none of the named reasons applies.
  const [declining, setDeclining] = useState<{
    id: string;
    reason: string;
    kind?: RejectionKind;
    wantsText?: boolean;
  } | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const handleApprove = async (proposalId: string) => {
    setApprovingId(proposalId);
    setDecisionError(null);
    const result = await approveProposal(proposalId, WEB_ACTOR);
    if (!result.ok) setDecisionError(result.error || 'Could not record the approval.');
    setApprovingId(null);
  };

  const recordRejection = async (id: string, reason?: string, reasonKind?: RejectionKind) => {
    setDecisionError(null);
    const result = await rejectProposal(id, reason?.trim() || undefined, reasonKind);
    if (!result.ok) setDecisionError(result.error || 'Could not record the decision.');
    else setDeclining(null);
  };

  const handleReject = () => {
    if (!declining) return;
    void recordRejection(declining.id, declining.reason, declining.kind);
  };

  const copyApplyCmd = (id: string) => copy(id, `ambit apply ${id}`);

  // Several drafts are a queue, decided together wherever they are listed:
  // each one still signed or turned down on its own, against what it showed.
  const drafts = proposals.filter(p => p.status === 'draft');
  const selected = picked ?? new Set(drafts.filter(p => !leansRefused(p)).map(p => p.id));
  const chosen = drafts.filter(p => selected.has(p.id)).map(p => p.id);
  const showQueue = (statusTab === 'all' || statusTab === 'draft') && drafts.length >= 2;
  const allTicked = drafts.length > 0 && chosen.length === drafts.length;
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const decideChosen = async (decision: 'approve' | 'reject') => {
    setQueueBusy(decision);
    setQueueReport(null);
    const result = await decideQueue(decision, chosen);
    setQueueBusy(null);
    setQueueReport({ decision, results: result.results, error: result.error });
    if (result.ok) setPicked(null);
  };

  const filtered = proposals.filter(p => statusTab === 'all' || p.status === statusTab);

  const draftCount = proposals.filter(p => p.status === 'draft').length;
  const approvedCount = proposals.filter(p => p.status === 'approved').length;
  const rejectedCount = proposals.filter(p => p.status === 'rejected').length;
  // The deck's Proposals tab carries the waiting count, and All is the sum of
  // the rest, so neither is counted here; what a tab holds is what the tab
  // shows. Approved and turned down are said nowhere else.
  const tabs: [typeof statusTab, string][] = [
    ['all', 'All'],
    ['draft', 'Waiting'],
    ['approved', `Approved (${approvedCount})`],
    ...(rejectedCount > 0
      ? ([['rejected', `Turned down (${rejectedCount})`]] as [typeof statusTab, string][])
      : []),
  ];

  return (
    <>
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

      {/* What approving does, said once for the desk rather than on every
          card that asks for the decision. */}
      {draftCount > 0 && (statusTab === 'all' || statusTab === 'draft') && (
        <p className="gov-hint">Approving signs a receipt; nothing runs yet.</p>
      )}

      {/* The queue. No comment box: an approval has no field to keep one
          in yet, and a box whose words are dropped would be a lie. */}
      {showQueue && (
        <div className="gov-queue">
          <label className="gov-queue-all">
            <input
              type="checkbox"
              checked={allTicked}
              onChange={() => setPicked(new Set(allTicked ? [] : drafts.map(p => p.id)))}
            />
            Select all
          </label>
          <span className="gov-actions">
            <button
              type="button"
              className="tp-btn-sm"
              disabled={!chosen.length || queueBusy !== null}
              onClick={() => decideChosen('reject')}
            >
              {queueBusy === 'reject' ? 'Turning down…' : `Turn down ${chosen.length}`}
            </button>
            <button
              type="button"
              className="tp-btn tp-btn--primary"
              disabled={!chosen.length || queueBusy !== null}
              onClick={() => decideChosen('approve')}
            >
              {queueBusy === 'approve' ? 'Signing…' : `Approve ${chosen.length} and sign`}
            </button>
          </span>
          <p className="gov-hint">
            A proposal that changed after this page loaded is skipped; reopening Proposals shows the
            new version.
          </p>
        </div>
      )}
      {queueReport && <QueueReportLines report={queueReport} />}

      {filtered.length === 0 ? (
        <div className="gov-empty">
          {proposals.length === 0
            ? 'Nothing waiting. A change drafted by an agent or by ambit propose appears here for you to decide.'
            : 'Nothing here yet.'}
        </div>
      ) : (
        <div className="gov-list">
          {filtered.map(p => {
            const parsedSteps = parseSteps(p.steps);
            const isApproved = p.status === 'approved' || p.status === 'applied';
            const isRejected = p.status === 'rejected';
            const isDeclining = declining?.id === p.id;

            return (
              // A proposal is a request, and its card is drawn as one: a
              // bubble beside the mark of who drafted it, where that was
              // recorded, with the answer below it on the other side.
              <div
                key={p.id}
                className={`gov-card ${isApproved ? 'gov-card--approved' : ''} ${isRejected ? 'gov-card--rejected' : ''}`}
              >
                <div className="gov-ask-row">
                  {p.proposed_by && (
                    <span className="gov-asker" title={`Drafted by ${p.proposed_by}`}>
                      <ActorMark id={p.proposed_by} size={22} />
                    </span>
                  )}
                  <div className="gov-ask">
                    {/* The change leads, in words, beside where it stands; its id,
                        which the commands take, follows it quietly. The card
                        opened on prop-deploy-staging-42 above its own title. */}
                    <div className="gov-card-head">
                      {showQueue && p.status === 'draft' && (
                        <input
                          type="checkbox"
                          className="gov-pick"
                          checked={selected.has(p.id)}
                          onChange={() => toggle(p.id)}
                          aria-label={`Include ${p.id}`}
                        />
                      )}
                      <div className="gov-goal">{p.goal}</div>
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
                    <p className="gov-meta">
                      <code className="gov-id">{p.id}</code>
                      {showQueue && p.status === 'draft' && leansRefused(p) && (
                        <span className="gov-pick-note">
                          unticked to start: you usually turn down changes like this
                        </span>
                      )}
                    </p>
                    {/* What the change is for, in the drafter's words. Reach
                    serves a purpose someone named, and the approval binds
                    the purpose shown here. */}
                    {p.purpose && (
                      <p className="gov-purpose">
                        <span>For</span> {p.purpose}
                      </p>
                    )}

                    {p.decision && <DecisionRows d={p.decision} />}

                    {parsedSteps.length > 0 && (
                      <div className="gov-steps">
                        <div className="sp-section-label">
                          {planTally(parsedSteps.length, p.decision)}
                        </div>
                        {/* An engine step is {id, name, chosen, …}; the demo's
                        hand-written ones are {action, provider}. Either reads
                        as a name and what supplies it; a step shaped some third
                        way used to print as its own JSON. A step with nothing
                        to undo it says so, in words. */}
                        {parsedSteps.map((step, idx) => (
                          <div key={idx} className="gov-step">
                            <code>{step.name || step.action || step.key || step.id || 'step'}</code>
                            <span className="gov-step-side">
                              {(step.chosen || step.provider) && (
                                <span className="gov-step-via">
                                  via {step.chosen || step.provider}
                                </span>
                              )}
                              {!step.inverse && <span className="gov-step-mark">no inverse</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {isDeclining && (
                  <div className="gov-decline">
                    <fieldset className="gov-decline-reasons">
                      <legend className="visually-hidden">Why turn it down</legend>
                      {REASONS.map(chip => (
                        <button
                          key={chip.kind}
                          type="button"
                          className="tp-btn-sm"
                          onClick={() => void recordRejection(p.id, undefined, chip.kind)}
                        >
                          {chip.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="tp-btn-sm"
                        onClick={() =>
                          setDeclining({ id: p.id, reason: '', kind: 'other', wantsText: true })
                        }
                      >
                        Something else
                      </button>
                    </fieldset>
                    {declining.wantsText && (
                      <>
                        <label className="gov-decline-label" htmlFor={`decline-${p.id}`}>
                          Reason, optional. The next draft reads it.
                        </label>
                        <input
                          id={`decline-${p.id}`}
                          className="tp-search gov-decline-input"
                          placeholder="what none of those says…"
                          value={declining.reason}
                          onChange={e =>
                            setDeclining({
                              id: p.id,
                              reason: e.target.value,
                              kind: 'other',
                              wantsText: true,
                            })
                          }
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleReject();
                          }}
                        />
                      </>
                    )}
                  </div>
                )}

                {decisionError && (declining?.id === p.id || approvingId === p.id) && (
                  <p className="gov-error">{decisionError}</p>
                )}

                <div className="gov-foot">
                  {isApproved ? (
                    <>
                      {/* The answer, as a receipt: a torn top edge, the
                          seal, and the mark of who signed. */}
                      <span className="gov-receipt">
                        <Seal size={18} />
                        <span className="gov-signed">
                          Signed by {signerLabel(p.approved_by)} · receipt verified
                        </span>
                        <ActorMark id={p.approved_by} size={20} decorative />
                      </span>
                      {/* Not offered where the Apply row says apply refuses
                          it: a command copied to be refused is no help. */}
                      {p.status !== 'applied' && p.decision?.applicable !== false && (
                        <button
                          type="button"
                          className="tp-btn-sm"
                          onClick={() => copyApplyCmd(p.id)}
                        >
                          {copiedId === p.id ? 'Copied ✓' : `Copy: ambit apply ${p.id}`}
                        </button>
                      )}
                    </>
                  ) : isRejected ? (
                    p.rejected_kind || p.rejected_reason ? (
                      <span className="gov-reply">
                        Turned down ·{' '}
                        {p.rejected_kind ? REASON_WORDS[p.rejected_kind] : `"${p.rejected_reason}"`}
                      </span>
                    ) : null
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
                        Turn it down
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="gov-hint">Approving signs a receipt; nothing runs yet.</span>
                      <span className="gov-actions">
                        <button
                          type="button"
                          className="tp-btn-sm"
                          onClick={() => setDeclining({ id: p.id, reason: '' })}
                        >
                          Turn down
                        </button>
                        {/* It names what it approves: with several cards
                            open, "approve" alone does not say which. */}
                        <button
                          type="button"
                          className="tp-btn tp-btn--primary"
                          disabled={approvingId === p.id}
                          onClick={() => handleApprove(p.id)}
                          aria-label={
                            approvingId === p.id ? undefined : `Approve this proposal, ${p.id}`
                          }
                        >
                          {approvingId === p.id ? 'Signing…' : 'Approve this proposal'}
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
    </>
  );
}

export default ProposalsDesk;
