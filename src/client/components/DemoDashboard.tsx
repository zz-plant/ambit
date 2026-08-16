import React from 'react';
import { useToolchainStore } from '../store/toolchainStore';
import type { DemoOpportunity } from '../utils/demoSnapshot';

/**
 * The static demo's view of the economic loop.
 *
 * A backend-driven install answers these questions from the work ledger; the
 * published site has no backend, so this renders the bundled snapshot in the
 * same report shapes — status, attention, opportunities, ROI — labelled as
 * sample data so a visitor never mistakes illustration for their own graph.
 */

const LABEL: React.CSSProperties = { fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase' };

function Confidence({ level }: { level: DemoOpportunity['confidence'] }) {
  const color = level === 'high' ? 'var(--ok)' : level === 'medium' ? 'var(--warn)' : 'var(--text-muted)';
  return <span style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.5 }}>{level}</span>;
}

function OpportunityCard({ o }: { o: DemoOpportunity }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 13 }}>{o.title}</span>
        <Confidence level={o.confidence} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        {o.burden.interventions_month} interventions/mo · {o.burden.human_hours_month}h · <span style={{ color: 'var(--warn)' }}>${o.burden.attention_dollars_month}/mo</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        <span style={{ color: 'var(--ok)' }}>{o.expected.human_hours_month_after}h</span> after · saves <span style={{ color: 'var(--ok)' }}>${o.expected.savings_dollars_month}/mo</span> · payback ≈ {o.payback_months}mo
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {o.acquisition_options?.map(a => (
          <span key={a.provider} style={{ fontSize: 9, border: '1px solid var(--border)', borderRadius: 3, padding: '2px 6px', color: 'var(--text-muted)' }}>
            {a.kind} · {a.provider}{a.total_first_year_dollars != null ? ` · $${a.total_first_year_dollars}/yr` : ''} · {a.privacy}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function DemoDashboard() {
  const demo = useToolchainStore(s => s.demo);
  if (!demo) return null;

  const { status, attention, opportunities, roi } = demo;

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', background: 'var(--bg-deep)', padding: 18, boxSizing: 'border-box', fontFamily: 'var(--font)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: 'var(--text-primary)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>THE ECONOMIC LOOP</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>sample data — a backend-driven install reads this from the work ledger</div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={LABEL}>saved / year</div>
              <div style={{ color: 'var(--ok)', fontSize: 16, fontWeight: 700 }}>{roi.hours_per_year}h · ${roi.dollars_per_year.toLocaleString()}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={LABEL}>forecast accuracy</div>
              <div style={{ color: 'var(--accent)', fontSize: 16, fontWeight: 700 }}>{roi.accuracy} · {roi.verdict}</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-primary)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '4px 8px' }}>{status.reached}/{status.total} reached</span>
          <span style={{ fontSize: 11, color: 'var(--ok)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '4px 8px' }}>{status.verified} verified</span>
          <span style={{ fontSize: 11, color: 'var(--error)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '4px 8px' }}>{status.failing} failing</span>
          <span style={{ fontSize: 11, color: 'var(--warn)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '4px 8px' }}>degraded: {status.degraded.join(', ')}</span>
        </div>

        <div>
          <div style={LABEL}>what to build next — ranked by attention saved</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
            {opportunities.map(o => <OpportunityCard key={o.id} o={o} />)}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={LABEL}>where the human's time goes</div>
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 10, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {attention.reducible.map(r => (
                <div key={r.capability} style={{ fontSize: 11 }}>
                  <span style={{ color: 'var(--text-primary)' }}>{r.capability}</span>
                  <span style={{ color: 'var(--text-muted)' }}> · {r.times}× · {r.hours}h · </span>
                  <span style={{ color: 'var(--warn)' }}>reducible — {r.suggested_fix}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={LABEL}>keepers — not reducible, however often they recur</div>
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 10, marginTop: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
              {attention.keepers.map(k => (
                <div key={k.capability}>{k.kind}: {k.capability} · {k.times}× — the reason the human is there</div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ fontSize: 10, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          This is what a real install reports from its own ledger — `ambit status`, `ambit attention`, `ambit opportunities`, `ambit roi`. Run it locally: Node 22, no dependencies.
        </div>
      </div>
    </div>
  );
}