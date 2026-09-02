import React from 'react';
import { useAmbitStore } from '../store/ambitStore';
import type { DemoOpportunity } from '../utils/demoSnapshot';

/**
 * The static demo's view of the work ledger: where human attention went,
 * what it cost, and what would pay back fastest.
 *
 * Only the hosted demo has this tab — a real ledger starts empty and is read
 * from the terminal (`ambit attention`, `ambit opportunities`, `ambit roi`).
 */

interface DemoDashboardProps {
  /** Pixels covered by the capability list, so the page sits beside it. */
  leftInset?: number;
}

function Confidence({ level }: { level: DemoOpportunity['confidence'] }) {
  return <span className={`loop-confidence loop-confidence--${level}`}>{level} confidence</span>;
}

function OpportunityCard({ o }: { o: DemoOpportunity }) {
  const startAcquisition = useAmbitStore(s => s.startAcquisitionSimulation);
  const selectItem = useAmbitStore(s => s.selectItem);
  const items = useAmbitStore(s => s.items);

  // Map opportunity to a node ID if present
  const targetNodeId = o.id.includes('deploy')
    ? 'combo:deploy'
    : o.id.includes('e2e')
      ? 'combo:e2e'
      : 'skill:wrangler';

  const paybackPct = Math.min(100, Math.max(10, Math.round((1 / (o.payback_months || 1)) * 100)));

  return (
    <div className="loop-card">
      <div className="loop-card-head">
        <span className="loop-card-title">{o.title}</span>
        <Confidence level={o.confidence} />
      </div>
      <div className="loop-card-line">
        Today: {o.burden.interventions_month} interventions a month, {o.burden.human_hours_month}h
        of your time, <span className="is-warn">${o.burden.attention_dollars_month}/mo</span>.
      </div>
      <div className="loop-card-line">
        After: {o.expected.human_hours_month_after}h a month, saving{' '}
        <span className="is-ok">${o.expected.savings_dollars_month}/mo</span>. Pays back in{' '}
        <strong>{o.payback_months} months</strong>.
      </div>

      <div className="payback-meter" aria-hidden="true">
        <span>Payback</span>
        <div className="payback-track">
          <div className="payback-fill" style={{ width: `${paybackPct}%` }} />
        </div>
      </div>

      <div className="loop-card-foot">
        <div className="loop-options">
          {o.acquisition_options?.map(a => (
            <span key={a.provider} className="loop-option">
              {a.kind} · <strong>{a.provider}</strong>
              {a.total_first_year_dollars != null ? ` · $${a.total_first_year_dollars}/yr` : ''} ·{' '}
              {a.privacy}
            </span>
          ))}
        </div>

        <button
          type="button"
          className="loop-sim-btn"
          onClick={() => {
            const found = items.find(i => i.id === targetNodeId);
            if (found) {
              selectItem(found.id);
              startAcquisition(found.id);
            }
          }}
          title="Show what this would unlock on the map"
        >
          Show on the map
        </button>
      </div>
    </div>
  );
}

export default function DemoDashboard({ leftInset = 0 }: DemoDashboardProps) {
  const demo = useAmbitStore(s => s.demo);
  const [confidenceFilter, setConfidenceFilter] = React.useState<'all' | 'high' | 'medium'>('all');

  if (!demo) return null;

  const { status, attention, opportunities, roi } = demo;
  const filteredOpportunities = opportunities.filter(
    o => confidenceFilter === 'all' || o.confidence === confidenceFilter
  );
  const filters: [typeof confidenceFilter, string][] = [
    ['all', 'All'],
    ['high', 'High confidence'],
    ['medium', 'Medium confidence'],
  ];

  return (
    <div className="loop-dashboard" style={{ left: leftInset }}>
      <div className="loop-inner">
        <div className="loop-hero">
          <div>
            <h2 className="loop-title">Where the time goes</h2>
            <p className="loop-subtitle">
              Every time a person had to step in, recorded against the capability that needed them.
              Priced, and ranked by what would pay back fastest. Example data.
            </p>
          </div>
          <div className="loop-stats">
            <div className="loop-stat">
              <div className="loop-label">Saved per year</div>
              <div className="loop-stat-value loop-stat-value--ok">
                {roi.hours_per_year}h · ${roi.dollars_per_year.toLocaleString()}
              </div>
            </div>
            <div className="loop-stat">
              <div className="loop-label">Forecast accuracy</div>
              <div className="loop-stat-value">
                {roi.accuracy} · {roi.verdict}
              </div>
            </div>
          </div>
        </div>

        <div className="loop-chips">
          <span className="loop-chip">
            {status.reached}/{status.total} reached
          </span>
          <span className="loop-chip loop-chip--ok">✓ {status.verified} verified</span>
          <span className="loop-chip loop-chip--error">! {status.failing} failing</span>
          {status.degraded.length > 0 && (
            <span className="loop-chip loop-chip--warn">
              degraded: {status.degraded.join(', ')}
            </span>
          )}
        </div>

        <section>
          <div className="loop-section-head">
            <h3 className="loop-section-title">What to set up next</h3>
            <div className="loop-filter-tabs" role="group" aria-label="Filter by confidence">
              {filters.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`loop-filter-tab ${confidenceFilter === key ? 'loop-filter-tab--active' : ''}`}
                  aria-pressed={confidenceFilter === key}
                  onClick={() => setConfidenceFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="loop-cards">
            {filteredOpportunities.map(o => (
              <OpportunityCard key={o.id} o={o} />
            ))}
          </div>
        </section>

        <div className="loop-grid">
          <section>
            <div className="loop-section-head">
              <h3 className="loop-section-title">Interruptions worth removing</h3>
            </div>
            <div className="loop-list">
              {attention.reducible.map(r => (
                <div key={r.capability} className="loop-list-row">
                  <strong>{r.capability}</strong> · {r.times}× · {r.hours}h
                  <br />
                  <span className="is-warn">{r.suggested_fix}</span>
                </div>
              ))}
            </div>
          </section>
          <section>
            <div className="loop-section-head">
              <h3 className="loop-section-title">Decisions worth keeping</h3>
            </div>
            <div className="loop-list">
              {attention.keepers.map(k => (
                <div key={k.capability} className="loop-list-row">
                  <strong>{k.capability}</strong> · {k.kind} · {k.times}×
                </div>
              ))}
            </div>
          </section>
        </div>

        <p className="loop-foot">
          On your own machine this comes from the work ledger: <code>ambit attention</code>,{' '}
          <code>ambit opportunities</code> and <code>ambit roi</code>. It starts empty and fills as
          runs are recorded.
        </p>
      </div>
    </div>
  );
}
