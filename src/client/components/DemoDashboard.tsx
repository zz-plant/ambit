import React from 'react';
import { useAmbitStore } from '../store/ambitStore';
import type { DemoOpportunity } from '../utils/demoSnapshot';

/**
 * The static demo's view of the economic loop.
 *
 * Rendered with demoscene cybernetic tracker & instrumentation styling.
 */

const LABEL: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--accent)',
  fontWeight: 700,
  letterSpacing: 1.5,
  textTransform: 'uppercase',
  fontFamily: 'var(--font)',
};

function Confidence({ level }: { level: DemoOpportunity['confidence'] }) {
  const color =
    level === 'high' ? 'var(--ok)' : level === 'medium' ? 'var(--warn)' : 'var(--text-muted)';
  const glow =
    level === 'high' ? 'var(--ok-glow)' : level === 'medium' ? 'var(--warn-glow)' : 'none';
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        color,
        textTransform: 'uppercase',
        letterSpacing: 1,
        border: `1px solid ${color}`,
        padding: '1px 6px',
        borderRadius: 'var(--radius-xs)',
        boxShadow: glow,
      }}
    >
      {level}
    </span>
  );
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
    <div
      style={{
        background: 'var(--bg-glass)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid var(--border-bright)',
        borderRadius: 'var(--radius)',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 3,
          bottom: 0,
          background: 'linear-gradient(180deg, var(--accent), var(--copper-2))',
        }}
      />
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}
      >
        <span
          style={{
            color: 'var(--text-primary)',
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: 0.4,
          }}
        >
          {o.title}
        </span>
        <Confidence level={o.confidence} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {o.burden.interventions_month} interventions/mo · {o.burden.human_hours_month}h ·{' '}
        <span style={{ color: 'var(--warn)', fontWeight: 700 }}>
          ${o.burden.attention_dollars_month}/mo burden
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        <span style={{ color: 'var(--ok)', fontWeight: 700 }}>
          {o.expected.human_hours_month_after}h
        </span>{' '}
        post-fix · saves{' '}
        <span style={{ color: 'var(--ok)', fontWeight: 700 }}>
          ${o.expected.savings_dollars_month}/mo
        </span>{' '}
        · payback ≈{' '}
        <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{o.payback_months}mo</span>
      </div>

      {/* Visual Payback Velocity Meter */}
      <div className="payback-meter">
        <span
          style={{
            fontSize: '10px',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Payback Velocity:
        </span>
        <div className="payback-track">
          <div className="payback-fill" style={{ width: `${paybackPct}%` }} />
        </div>
        <span style={{ fontSize: '10px', color: 'var(--ok)', fontWeight: 700 }}>
          {o.payback_months} mo
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 6,
          marginTop: 2,
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {o.acquisition_options?.map(a => (
            <span
              key={a.provider}
              style={{
                fontSize: 10,
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-xs)',
                padding: '3px 8px',
                color: 'var(--text-muted)',
                background: 'var(--bg-deep)',
              }}
            >
              {a.kind} · <strong style={{ color: 'var(--accent)' }}>{a.provider}</strong>
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
          title="Simulate acquiring this capability on the Tech Tree"
        >
          ✨ Simulate Fix
        </button>
      </div>
    </div>
  );
}

export default function DemoDashboard() {
  const demo = useAmbitStore(s => s.demo);
  const [confidenceFilter, setConfidenceFilter] = React.useState<'all' | 'high' | 'medium'>('all');

  if (!demo) return null;

  const { status, attention, opportunities, roi } = demo;
  const filteredOpportunities = opportunities.filter(
    o => confidenceFilter === 'all' || o.confidence === confidenceFilter
  );

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'auto',
        background: 'var(--bg-deep)',
        padding: 24,
        boxSizing: 'border-box',
        fontFamily: 'var(--font)',
      }}
    >
      <div
        style={{
          maxWidth: 940,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Dashboard Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 12,
            flexWrap: 'wrap',
            borderBottom: '1px solid var(--border-bright)',
            paddingBottom: 16,
            position: 'relative',
          }}
        >
          <div>
            <div
              style={{
                color: 'var(--text-primary)',
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: 2,
                textTransform: 'uppercase',
              }}
            >
              THE ECONOMIC LOOP
            </div>
            <div
              style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, letterSpacing: 0.5 }}
            >
              telemetry &amp; opportunity engine — real-time ROI tracking
            </div>
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            <div
              style={{
                textAlign: 'right',
                background: 'var(--bg-elevated)',
                padding: '8px 14px',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={LABEL}>saved / year</div>
              <div
                style={{
                  color: 'var(--ok)',
                  fontSize: 18,
                  fontWeight: 800,
                  fontVariantNumeric: 'tabular-nums',
                  textShadow: 'var(--ok-glow)',
                }}
              >
                {roi.hours_per_year}h · ${roi.dollars_per_year.toLocaleString()}
              </div>
            </div>
            <div
              style={{
                textAlign: 'right',
                background: 'var(--bg-elevated)',
                padding: '8px 14px',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={LABEL}>forecast accuracy</div>
              <div
                style={{
                  color: 'var(--accent)',
                  fontSize: 18,
                  fontWeight: 800,
                  fontVariantNumeric: 'tabular-nums',
                  textShadow: 'var(--accent-glow)',
                }}
              >
                {roi.accuracy} · {roi.verdict}
              </div>
            </div>
          </div>
        </div>

        {/* Status Indicators */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-primary)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-xs)',
              padding: '5px 10px',
            }}
          >
            ◈ {status.reached}/{status.total} reached
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--ok)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--ok)',
              borderRadius: 'var(--radius-xs)',
              padding: '5px 10px',
              boxShadow: 'var(--ok-glow)',
            }}
          >
            ✓ {status.verified} verified
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--error)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--error)',
              borderRadius: 'var(--radius-xs)',
              padding: '5px 10px',
              boxShadow: 'var(--error-glow)',
            }}
          >
            ! {status.failing} failing
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--warn)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--warn)',
              borderRadius: 'var(--radius-xs)',
              padding: '5px 10px',
            }}
          >
            ~ degraded: {status.degraded.join(', ')}
          </span>
        </div>

        {/* Ranked Opportunities */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div style={LABEL}>what to build next — ranked by human attention saved</div>
            <div className="loop-filter-tabs">
              {(['all', 'high', 'medium'] as const).map(c => (
                <button
                  key={c}
                  type="button"
                  className={`loop-filter-tab ${confidenceFilter === c ? 'loop-filter-tab--active' : ''}`}
                  onClick={() => setConfidenceFilter(c)}
                >
                  {c.toUpperCase()} CONFIDENCE
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            {filteredOpportunities.map(o => (
              <OpportunityCard key={o.id} o={o} />
            ))}
          </div>
        </div>

        {/* Attention Allocation Split */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <div style={LABEL}>where human attention is spent</div>
            <div
              style={{
                background: 'var(--bg-glass)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: 14,
                marginTop: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {attention.reducible.map(r => (
                <div
                  key={r.capability}
                  style={{
                    fontSize: 12,
                    borderBottom: '1px solid var(--border)',
                    paddingBottom: 6,
                  }}
                >
                  <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                    {r.capability}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {' '}
                    · {r.times}× · {r.hours}h ·{' '}
                  </span>
                  <span style={{ color: 'var(--warn)', fontWeight: 600 }}>
                    reducible — {r.suggested_fix}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={LABEL}>keepers — strategic human-in-the-loop decisions</div>
            <div
              style={{
                background: 'var(--bg-glass)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: 14,
                marginTop: 8,
                fontSize: 12,
                color: 'var(--text-secondary)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {attention.keepers.map(k => (
                <div
                  key={k.capability}
                  style={{ borderBottom: '1px solid var(--border)', paddingBottom: 6 }}
                >
                  <strong style={{ color: 'var(--accent)' }}>{k.kind}</strong>:{' '}
                  <span style={{ color: 'var(--text-primary)' }}>{k.capability}</span> · {k.times}×
                  — core judgment
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            borderTop: '1px solid var(--border)',
            paddingTop: 10,
            letterSpacing: 0.4,
          }}
        >
          Ambit economics ledger: run{' '}
          <code
            style={{
              color: 'var(--accent)',
              background: 'var(--bg-deep)',
              padding: '2px 6px',
              border: '1px solid var(--border)',
              borderRadius: 3,
            }}
          >
            ambit status
          </code>
          ,{' '}
          <code
            style={{
              color: 'var(--accent)',
              background: 'var(--bg-deep)',
              padding: '2px 6px',
              border: '1px solid var(--border)',
              borderRadius: 3,
            }}
          >
            ambit attention
          </code>
          ,{' '}
          <code
            style={{
              color: 'var(--accent)',
              background: 'var(--bg-deep)',
              padding: '2px 6px',
              border: '1px solid var(--border)',
              borderRadius: 3,
            }}
          >
            ambit opportunities
          </code>
          ,{' '}
          <code
            style={{
              color: 'var(--accent)',
              background: 'var(--bg-deep)',
              padding: '2px 6px',
              border: '1px solid var(--border)',
              borderRadius: 3,
            }}
          >
            ambit roi
          </code>{' '}
          locally.
        </div>
      </div>
    </div>
  );
}
