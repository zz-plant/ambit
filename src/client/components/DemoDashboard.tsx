import React from 'react';
import { useAmbitStore } from '../store/ambitStore';
import type { DemoOpportunity, DemoSnapshot } from '../utils/demoSnapshot';

/**
 * The static demo's view of the work ledger: where human attention went, what
 * it cost, and what would pay back fastest.
 *
 * Everything here is quantity, so everything here is drawn rather than
 * narrated. The page used to say "Today: 43 interventions a month, 8.6h of
 * your time, $2150/mo. After: 0.8h a month, saving $1935/mo. Pays back in 0.6
 * months" — five numbers in a sentence, three times over, with no way to
 * compare one row against the next except by holding them in your head. The
 * numbers have not changed; they are now on shared scales, so the comparison
 * happens in the eye instead.
 *
 * Three rules the figures below keep:
 *
 *   A scale is shared or it is not a scale. Every hours mark on the page sits
 *   on one 0–9h axis, drawn once, so a long bar means more hours wherever it
 *   appears. The old payback bar filled proportionally to nothing at all.
 *
 *   Label the marks, not the axis. Direct labels beat a legend the reader has
 *   to look away to decode, and they are what makes the one red/green pairing
 *   legible to a colourblind reader.
 *
 *   Ink that encodes nothing is removed. No gridlines behind the bars, no
 *   frames, no fill under a value that a position already carries.
 *
 * Only the hosted demo renders this: a real ledger starts empty and is read
 * from the terminal (`ambit attention`, `ambit opportunities`, `ambit roi`).
 */

interface DemoDashboardProps {
  /** Pixels covered by the capability list, so the page sits beside it. */
  leftInset?: number;
}

/** Figures line up in a column only if the digits are the same width. */
const NUM = { fontVariantNumeric: 'tabular-nums' } as const;

const money = (n: number) => `$${n.toLocaleString()}`;

/**
 * Twelve months of human hours, with the headline drawn as the area it
 * actually is.
 *
 * The saving is a difference against January, so January is drawn — a line
 * across the top — and the band between the two is shaded. The number in the
 * stat above is the area of that band.
 */
function HoursSparkline({ series }: { series: DemoSnapshot['roi']['monthly_hours'] }) {
  const w = 260;
  const h = 54;
  const pad = { top: 6, right: 4, bottom: 12, left: 4 };
  const baseline = series[0]?.hours ?? 0;
  const max = Math.max(...series.map(p => p.hours));
  const x = (i: number) =>
    pad.left + (i * (w - pad.left - pad.right)) / Math.max(series.length - 1, 1);
  const y = (v: number) => pad.top + (1 - v / max) * (h - pad.top - pad.bottom);

  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.hours)}`).join(' ');
  const band = `${line} L${x(series.length - 1)},${y(baseline)} L${x(0)},${y(baseline)} Z`;
  const last = series[series.length - 1];

  return (
    <svg
      className="fig-spark"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Hours a person spent in the loop, ${series[0].month} ${baseline}h down to ${last.month} ${last.hours}h`}
    >
      <title>{series.map(p => `${p.month} ${p.hours}h`).join(' · ')}</title>
      {/* The band is the saving. Everything else is context for it. */}
      <path className="fig-spark-band" d={band} />
      <line
        className="fig-spark-base"
        x1={x(0)}
        y1={y(baseline)}
        x2={x(series.length - 1)}
        y2={y(baseline)}
      />
      <path className="fig-spark-line" d={line} />
      {series.map((p, i) =>
        p.acquired ? (
          <g key={p.month}>
            <line
              className="fig-spark-mark"
              x1={x(i)}
              y1={y(p.hours)}
              x2={x(i)}
              y2={h - pad.bottom}
            />
            <circle className="fig-spark-dot" cx={x(i)} cy={y(p.hours)} r={3} />
          </g>
        ) : null
      )}
      <circle
        className="fig-spark-dot fig-spark-dot--last"
        cx={x(series.length - 1)}
        cy={y(last.hours)}
        r={3.5}
      />
      <text className="fig-spark-label" x={x(0)} y={h - 2} textAnchor="start">
        {series[0].month} {baseline}h
      </text>
      <text className="fig-spark-label" x={w - pad.right} y={h - 2} textAnchor="end">
        {last.month} {last.hours}h
      </text>
    </svg>
  );
}

/**
 * What was forecast against what happened, on one axis.
 *
 * A ratio of 1.1 says nothing on its own; two marks on a shared scale say
 * "predicted 37, got 41" and let the reader judge the gap themselves.
 */
function ForecastPair({ predicted, observed }: { predicted: number; observed: number }) {
  const w = 200;
  const max = Math.max(predicted, observed) * 1.15;
  const x = (v: number) => 34 + (v / max) * (w - 68);
  return (
    <svg
      className="fig-pair"
      viewBox={`0 0 ${w} 42`}
      role="img"
      aria-label={`Forecast ${predicted} hours, observed ${observed} hours`}
    >
      {/* The two marks sit close together precisely when the forecast was
          good, which is the moment two labels on one baseline collide into
          nonsense. One goes above the axis and one below, so the figure is
          legible exactly where it matters most. */}
      <text className="fig-tick" x={x(predicted)} y={9} textAnchor="middle">
        {predicted}h forecast
      </text>
      <line className="fig-pair-track" x1={4} y1={20} x2={w - 4} y2={20} />
      <line className="fig-pair-span" x1={x(predicted)} y1={20} x2={x(observed)} y2={20} />
      <circle className="fig-dot-hollow" cx={x(predicted)} cy={20} r={4} />
      <circle className="fig-dot" cx={x(observed)} cy={20} r={4.5} />
      <text className="fig-tick fig-tick--strong" x={x(observed)} y={36} textAnchor="middle">
        {observed}h spent
      </text>
    </svg>
  );
}

/**
 * The assurance split as one bar rather than four chips.
 *
 * Order matters and is not cosmetic: proven is green and failing is red, and
 * at ΔE 5.6 under deuteranopia those two are the same colour — so the grey
 * unproven segment sits between them, they never share an edge, and every
 * segment carries its own written label. Colour is the last thing doing the
 * work here, not the first.
 */
function AssuranceBar({ status }: { status: DemoSnapshot['status'] }) {
  const proven = status.verified;
  const unproven = Math.max(status.reached - status.verified - status.failing, 0);
  const failing = status.failing;
  const unreached = Math.max(status.total - status.reached, 0);
  const segments = [
    { key: 'proven', n: proven, label: 'check passed' },
    { key: 'unproven', n: unproven, label: 'configured, never checked' },
    { key: 'failing', n: failing, label: 'check failing' },
    { key: 'unreached', n: unreached, label: 'not reached' },
  ].filter(s => s.n > 0);

  return (
    <figure className="fig fig--assurance">
      <figcaption className="fig-caption">
        <span className="fig-caption-title">What the graph can prove</span>
        <span className="fig-caption-note">{status.total} capabilities the model knows</span>
      </figcaption>
      <div
        className="fig-stack"
        role="img"
        aria-label={segments.map(s => `${s.n} ${s.label}`).join(', ')}
      >
        {segments.map(s => (
          <div
            key={s.key}
            className={`fig-stack-seg fig-stack-seg--${s.key}`}
            style={{ flexGrow: s.n }}
            title={`${s.n} ${s.label}`}
          />
        ))}
      </div>
      <ul className="fig-key">
        {segments.map(s => (
          <li key={s.key} className="fig-key-item">
            <span className={`fig-key-swatch fig-key-swatch--${s.key}`} aria-hidden="true" />
            <span className="fig-key-n" style={NUM}>
              {s.n}
            </span>
            <span className="fig-key-label">{s.label}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** A dumbbell: where the hours are now, where they would be, on a shared axis. */
function HoursDumbbell({ now, after, max }: { now: number; after: number; max: number }) {
  const w = 168;
  // Room at both ends for the two values: the mark is a difference and both
  // sides of it get a number.
  const x = (v: number) => 20 + (v / max) * (w - 48);
  return (
    <svg
      className="fig-row-svg"
      viewBox={`0 0 ${w} 20`}
      role="img"
      aria-label={`${now} hours now, ${after} hours after`}
    >
      <title>{`${now}h a month now → ${after}h after`}</title>
      <line className="fig-dumbbell-span" x1={x(after)} y1={10} x2={x(now)} y2={10} />
      <circle className="fig-dot-hollow" cx={x(after)} cy={10} r={3.5} />
      <circle className="fig-dot" cx={x(now)} cy={10} r={4} />
      <text
        className="fig-inline-label fig-inline-label--soft"
        x={x(after) - 6}
        y={13.5}
        textAnchor="end"
        style={NUM}
      >
        {after}
      </text>
      <text className="fig-inline-label" x={x(now) + 7} y={13.5} style={NUM}>
        {now}h
      </text>
    </svg>
  );
}

/** Money recovered each month, as length on one scale. */
function SavingsBar({ saved, max }: { saved: number; max: number }) {
  const w = 130;
  const len = Math.max((saved / max) * (w - 46), 2);
  return (
    <svg
      className="fig-row-svg"
      viewBox={`0 0 ${w} 20`}
      role="img"
      aria-label={`${money(saved)} recovered a month`}
    >
      <title>{`${money(saved)} a month`}</title>
      <rect className="fig-bar" x={0} y={6} width={len} height={8} rx={4} />
      <text className="fig-inline-label" x={len + 6} y={13.5} style={NUM}>
        {money(saved)}
      </text>
    </svg>
  );
}

/** Payback against the month it has to beat. */
function PaybackMark({ months }: { months: number }) {
  const w = 116;
  const scale = 1; // one month, which is the comparison worth making
  const x = (v: number) => 2 + Math.min(v / scale, 1) * (w - 44);
  return (
    <svg
      className="fig-row-svg"
      viewBox={`0 0 ${w} 20`}
      role="img"
      aria-label={`Pays back in ${months} months`}
    >
      <title>{`${months} months to pay back`}</title>
      <line className="fig-axis-line" x1={2} y1={10} x2={x(scale)} y2={10} />
      {/* The month it has to beat, marked once. The value rides its own dot:
          at the axis end it read as though the maximum were the measurement. */}
      <line className="fig-axis-tick" x1={x(scale)} y1={4} x2={x(scale)} y2={16} />
      <circle className="fig-dot" cx={x(months)} cy={10} r={4} />
      <text className="fig-inline-label" x={x(months) + 7} y={13.5} style={NUM}>
        {months}
      </text>
    </svg>
  );
}

/**
 * Interruptions, as one comparison rather than two lists.
 *
 * The reducible ones and the ones worth keeping were in separate columns, so
 * the question the section exists to answer — how much of this is the human
 * being a duct, and how much is the human deciding — needed the reader to
 * compare across a gap. One scale, one sort, and the keeper drawn in the
 * recessive grey with a hatch, because it is the context and not the point.
 */
function InterruptionChart({ attention }: { attention: DemoSnapshot['attention'] }) {
  const rows = [
    ...attention.reducible.map(r => ({
      capability: r.capability,
      hours: r.hours,
      times: r.times,
      note: r.suggested_fix,
      kept: false,
    })),
    ...attention.keepers.map(k => ({
      capability: k.capability,
      hours: k.hours,
      times: k.times,
      note: `${k.kind} — never proposed for removal, however often it recurs`,
      kept: true,
    })),
  ].sort((a, b) => b.hours - a.hours);

  const max = Math.max(...rows.map(r => r.hours));
  const ticks = [0, 1, 2, 3].filter(t => t <= max * 1.1);

  return (
    <figure className="fig">
      <figcaption className="fig-caption">
        <span className="fig-caption-title">Where the interruptions are</span>
        <span className="fig-caption-note">
          hours a month · {attention.interventions} interventions in the window
        </span>
      </figcaption>

      <ul className="fig-bars">
        {rows.map(r => (
          <li key={r.capability} className={`fig-bar-row ${r.kept ? 'is-kept' : ''}`}>
            <span className="fig-bar-name">
              {r.capability}
              {r.kept && <span className="fig-tag">kept</span>}
            </span>
            <span className="fig-bar-track">
              <span
                className={`fig-bar-fill ${r.kept ? 'fig-bar-fill--kept' : ''}`}
                style={{ width: `${(r.hours / max) * 100}%` }}
                title={`${r.hours}h a month over ${r.times} interruptions`}
              />
              <span className="fig-bar-value" style={NUM}>
                {r.hours}h
              </span>
            </span>
            <span className="fig-bar-count" style={NUM}>
              {r.times}×
            </span>
            <span className="fig-bar-note">{r.note}</span>
          </li>
        ))}
      </ul>

      <div className="fig-axis" aria-hidden="true">
        <span className="fig-axis-spacer" />
        <span className="fig-axis-scale">
          {ticks.map(t => (
            <span
              key={t}
              className="fig-axis-tick-label"
              style={{ left: `${(t / max) * 100}%`, ...NUM }}
            >
              {t}h
            </span>
          ))}
        </span>
      </div>
    </figure>
  );
}

function OpportunityRows({ list }: { list: DemoOpportunity[] }) {
  const startAcquisition = useAmbitStore(s => s.startAcquisitionSimulation);
  const selectItem = useAmbitStore(s => s.selectItem);
  const items = useAmbitStore(s => s.items);

  // One scale per column, taken from the whole set rather than per row, so a
  // longer mark means more wherever the eye lands.
  const maxHours = Math.max(...list.map(o => o.burden.human_hours_month)) * 1.05;
  const maxSaved = Math.max(...list.map(o => o.expected.savings_dollars_month));

  const show = (o: DemoOpportunity) => {
    const targetNodeId = o.id.includes('deploy')
      ? 'combo:deploy'
      : o.id.includes('e2e')
        ? 'combo:e2e'
        : 'skill:wrangler';
    const found = items.find(i => i.id === targetNodeId);
    if (found) {
      selectItem(found.id);
      startAcquisition(found.id);
    }
  };

  return (
    <div className="fig-table-wrap">
      <table className="fig-table">
        <thead>
          <tr>
            <th scope="col">What to set up</th>
            <th scope="col" className="is-num">
              A month
            </th>
            <th scope="col">
              Your hours a month
              <span className="fig-th-scale">
                <span>0</span>
                <span>{Math.round(maxHours)}h</span>
              </span>
            </th>
            <th scope="col">Recovered a month</th>
            <th scope="col">
              Pays back
              <span className="fig-th-scale">
                <span>0</span>
                <span>1 month</span>
              </span>
            </th>
            <th scope="col">
              <span className="sr-only">Show on the map</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map(o => (
            <tr key={o.id}>
              <th scope="row">
                <span className="fig-row-title">{o.title}</span>
                <span className={`fig-conf fig-conf--${o.confidence}`}>
                  {o.confidence} confidence
                </span>
                {o.acquisition_options && (
                  <span className="fig-row-options">
                    {o.acquisition_options.map(a => (
                      <span key={a.provider}>
                        {a.kind} · {a.provider}
                        {a.total_first_year_dollars != null
                          ? ` · ${money(a.total_first_year_dollars)}/yr`
                          : ''}{' '}
                        · {a.privacy}
                      </span>
                    ))}
                  </span>
                )}
              </th>
              <td className="is-num" style={NUM}>
                {o.burden.interventions_month}×
              </td>
              <td>
                <HoursDumbbell
                  now={o.burden.human_hours_month}
                  after={o.expected.human_hours_month_after}
                  max={maxHours}
                />
              </td>
              <td>
                <SavingsBar saved={o.expected.savings_dollars_month} max={maxSaved} />
              </td>
              <td>
                <PaybackMark months={o.payback_months} />
              </td>
              <td>
                <button type="button" className="fig-row-btn" onClick={() => show(o)}>
                  Map
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fig-legend">
        <span className="fig-legend-item">
          <svg width="34" height="10" aria-hidden="true">
            <line className="fig-dumbbell-span" x1="4" y1="5" x2="30" y2="5" />
            <circle className="fig-dot-hollow" cx="4" cy="5" r="3.5" />
            <circle className="fig-dot" cx="30" cy="5" r="4" />
          </svg>
          hollow is where the hours would land · solid is where they are now
        </span>
      </p>
    </div>
  );
}

export default function DemoDashboard({ leftInset = 0 }: DemoDashboardProps) {
  const demo = useAmbitStore(s => s.demo);
  const [confidenceFilter, setConfidenceFilter] = React.useState<'all' | 'high' | 'medium'>('all');

  if (!demo) return null;

  const { status, attention, opportunities, roi } = demo;
  const filtered = opportunities.filter(
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
        </div>

        <div className="fig-kpis">
          <figure className="fig fig--kpi">
            <figcaption className="fig-caption">
              <span className="fig-caption-title">Hours a person spent in the loop</span>
              <span className="fig-caption-note">the shaded band is the saving</span>
            </figcaption>
            <div className="fig-kpi-value" style={NUM}>
              {roi.hours_per_year}h<span className="fig-kpi-unit"> saved</span>{' '}
              <span className="fig-kpi-second">{money(roi.dollars_per_year)} a year</span>
            </div>
            <HoursSparkline series={roi.monthly_hours} />
          </figure>

          <figure className="fig fig--kpi">
            <figcaption className="fig-caption">
              <span className="fig-caption-title">Forecast against what happened</span>
              <span className="fig-caption-note">{roi.verdict}</span>
            </figcaption>
            <div className="fig-kpi-value" style={NUM}>
              {roi.accuracy}×<span className="fig-kpi-unit"> of forecast</span>
            </div>
            <ForecastPair
              predicted={roi.forecast.predicted_hours}
              observed={roi.forecast.observed_hours}
            />
          </figure>

          <AssuranceBar status={status} />
        </div>

        <section>
          <div className="loop-section-head">
            <h3 className="loop-section-title">What to set up next</h3>
            <div className="loop-filter-tabs" role="tablist" aria-label="Filter by confidence">
              {filters.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  className={`loop-filter-tab ${confidenceFilter === key ? 'loop-filter-tab--active' : ''}`}
                  aria-selected={confidenceFilter === key}
                  onClick={() => setConfidenceFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <OpportunityRows list={filtered} />
        </section>

        <InterruptionChart attention={attention} />

        <p className="loop-foot">
          On your own machine this comes from the work ledger: <code>ambit attention</code>,{' '}
          <code>ambit opportunities</code> and <code>ambit roi</code>. It starts empty and fills as
          runs are recorded.
        </p>
      </div>
    </div>
  );
}
