/**
 * The figures the site draws more than once.
 *
 * A sparkline lived inside the dashboard and nowhere else, so the landing page
 * showed a cartoon of four circles while the one real picture of what the
 * product measures sat two clicks away. The map's era columns carried names and
 * no counts, and the status pill said "42 of 60" in words beside a green dot
 * that meant nothing. Each of these is a quantity, and a quantity wants to be
 * drawn, on a scale, with its own label — the same way everywhere it appears.
 *
 * Three rules, kept here so every caller inherits them:
 *
 *   A scale is shared or it is not a scale. Every era strip on the page uses
 *   the same width for the same total, so a longer bar means more wherever the
 *   eye lands.
 *
 *   Label the marks. An annotation that is drawn as a tick and never named is
 *   a tick; the point of marking April was that a capability landed there.
 *
 *   Ink that encodes nothing is removed. No frames, no gridlines, no fill
 *   behind a value a position already carries.
 */
import type { DemoSnapshot } from '../utils/demoSnapshot';

/** Figures line up in a column only if the digits are the same width. */
export const NUM = { fontVariantNumeric: 'tabular-nums' } as const;

export const money = (n: number) => `$${n.toLocaleString()}`;

type Series = DemoSnapshot['roi']['monthly_hours'];

interface SparklineProps {
  series: Series;
  /** Scene width; height follows the variant. */
  width?: number;
  height?: number;
  /** Name the months where something was acquired, not only mark them. */
  annotate?: boolean;
}

/**
 * Twelve months of human hours, with the headline drawn as the area it
 * actually is.
 *
 * The saving is a difference against January, so January is drawn — a
 * reference line across the top — and the band between the two is shaded. The
 * headline number is the area of that band. The months where a capability
 * landed are the reason the line steps down, so each one is named beside its
 * drop rather than left as an anonymous tick, and the name sits above the
 * line where the space is, with a hairline to the point it belongs to.
 */
export function HoursSparkline({
  series,
  width = 260,
  height = 54,
  annotate = false,
}: SparklineProps) {
  const w = width;
  const h = height;
  const pad = { top: annotate ? 22 : 6, right: 6, bottom: 14, left: 6 };
  const baseline = series[0]?.hours ?? 0;
  const max = Math.max(...series.map(p => p.hours));
  const x = (i: number) =>
    pad.left + (i * (w - pad.left - pad.right)) / Math.max(series.length - 1, 1);
  const y = (v: number) => pad.top + (1 - v / max) * (h - pad.top - pad.bottom);

  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.hours)}`).join(' ');
  const band = `${line} L${x(series.length - 1)},${y(baseline)} L${x(0)},${y(baseline)} Z`;
  const last = series[series.length - 1];

  // Where each annotation sits. A label points away from the middle so it
  // stays inside the figure, and when two would still overprint — which they
  // do at the dashboard's width, where April and October are ninety pixels
  // apart and their names are longer than that — the later one drops a row.
  // Two labels on top of each other say less than none.
  const glyph = 5.2;
  const placed: { i: number; text: string; anchor: 'start' | 'end'; row: number }[] = [];
  series.forEach((p, i) => {
    if (!p.acquired) return;
    const text = `${p.month} · ${p.acquired}`;
    const anchor: 'start' | 'end' = i > series.length / 2 ? 'end' : 'start';
    const width = text.length * glyph;
    const from = anchor === 'start' ? x(i) : x(i) - width;
    const to = from + width;
    let row = 0;
    for (const q of placed) {
      const qw = q.text.length * glyph;
      const qFrom = q.anchor === 'start' ? x(q.i) : x(q.i) - qw;
      if (q.row === row && from < qFrom + qw + 6 && to > qFrom - 6) row = q.row + 1;
    }
    placed.push({ i, text, anchor, row });
  });
  const rows = placed.reduce((m, p) => Math.max(m, p.row + 1), 0);
  if (annotate) pad.top = 12 + rows * 10;
  const noteY = (row: number) => 7 + row * 10;

  return (
    <svg
      className="fig-spark"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Hours a person spent in the loop, ${series[0].month} ${baseline}h down to ${last.month} ${last.hours}h${placed.length ? `; ${placed.map(a => a.text).join(', ')}` : ''}`}
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
      {placed.map(p => (
        <g key={p.text}>
          <line
            className="fig-spark-mark"
            x1={x(p.i)}
            y1={annotate ? noteY(p.row) + 3 : y(series[p.i].hours)}
            x2={x(p.i)}
            y2={annotate ? y(series[p.i].hours) : h - pad.bottom}
          />
          <circle className="fig-spark-dot" cx={x(p.i)} cy={y(series[p.i].hours)} r={3} />
          {annotate && (
            <text
              className="fig-spark-note"
              x={x(p.i)}
              y={noteY(p.row)}
              textAnchor={p.anchor}
              dx={p.anchor === 'end' ? 3 : -3}
            >
              {p.text}
            </text>
          )}
        </g>
      ))}
      <circle
        className="fig-spark-dot fig-spark-dot--last"
        cx={x(series.length - 1)}
        cy={y(last.hours)}
        r={3.5}
      />
      <text className="fig-spark-label" x={x(0)} y={h - 2} textAnchor="start" style={NUM}>
        {series[0].month} {baseline}h
      </text>
      <text className="fig-spark-label" x={w - pad.right} y={h - 2} textAnchor="end" style={NUM}>
        {last.month} {last.hours}h
      </text>
    </svg>
  );
}

export interface EraCount {
  key: string;
  label: string;
  reached: number;
  next: number;
  total: number;
}

/**
 * Seven eras, one row each, on one scale: how much of each is reached.
 *
 * Small multiples — the same form repeated so the eye compares across rows
 * without re-reading a legend. The bar's width is the era's total, so a full
 * era and an empty one read differently before any number is read. Reached
 * is the data hue; the next step is drawn hollow, because it is the frontier
 * rather than the territory; what remains is the track.
 */
export function EraStrip({ eras, unit = 9 }: { eras: EraCount[]; unit?: number }) {
  const maxTotal = Math.max(...eras.map(e => e.total), 1);
  const labelW = 92;
  const barW = maxTotal * unit;
  const rowH = 15;
  const w = labelW + barW + 46;
  const h = eras.length * rowH;
  return (
    <svg
      className="fig-eras"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={eras.map(e => `${e.label}: ${e.reached} of ${e.total} reached`).join('; ')}
    >
      {eras.map((e, r) => {
        const y = r * rowH + rowH / 2;
        const seg = (n: number) => n * unit;
        return (
          <g key={e.key}>
            <text className="fig-eras-label" x={labelW - 8} y={y + 3.5} textAnchor="end">
              {e.label}
            </text>
            <rect
              className="fig-eras-track"
              x={labelW}
              y={y - 3.5}
              width={seg(e.total)}
              height={7}
              rx={1.5}
            />
            {e.reached > 0 && (
              <rect
                className="fig-eras-reached"
                x={labelW}
                y={y - 3.5}
                width={seg(e.reached)}
                height={7}
                rx={1.5}
              />
            )}
            {e.next > 0 && (
              <rect
                className="fig-eras-next"
                x={labelW + seg(e.reached) + 0.75}
                y={y - 2.75}
                width={Math.max(seg(e.next) - 1.5, 1)}
                height={5.5}
                rx={1}
              />
            )}
            <text className="fig-eras-n" x={labelW + barW + 8} y={y + 3.5} style={NUM}>
              {e.reached}
              <tspan className="fig-eras-of">/{e.total}</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The whole graph as one short bar: reached, next step, not reached.
 *
 * Sits inside the status pill, where "42 of 60 reached" used to stand beside a
 * green dot that encoded nothing. Twenty pixels wide, it says the same thing
 * the words say and says it before they are read.
 */
export function ReachBar({
  reached,
  next,
  total,
}: {
  reached: number;
  next: number;
  total: number;
}) {
  const w = 44;
  const h = 6;
  const seg = (n: number) => (total ? (n / total) * w : 0);
  return (
    <svg className="fig-reach" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <rect className="fig-eras-track" x={0} y={0} width={w} height={h} rx={1.5} />
      {reached > 0 && (
        <rect className="fig-eras-reached" x={0} y={0} width={seg(reached)} height={h} rx={1.5} />
      )}
      {next > 0 && (
        <rect
          className="fig-eras-next"
          x={seg(reached) + 0.5}
          y={0.5}
          width={Math.max(seg(next) - 1, 1)}
          height={h - 1}
          rx={1}
        />
      )}
    </svg>
  );
}
