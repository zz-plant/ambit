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
import { CHECK_HISTORY_RUNS, type CheckRun, type LoopSnapshot } from '../../shared/api';
import { describeRuns } from '../utils/checkHistory';

/**
 * Figures line up in a column only if the digits are the same width. Only a
 * column: the text face's tabular digits are its code forms, a slashed zero
 * and a footed one, which read as a readout in a column of numbers and as a
 * typo in a sentence.
 */
export const NUM = { fontVariantNumeric: 'tabular-nums' } as const;

export const money = (n: number) => `$${n.toLocaleString()}`;

/** One segment of a stacked bar: what it counts, how many, and the word for it. */
export interface StackSegment {
  key: string;
  n: number;
  label: string;
}

/**
 * A count split into segments, as one bar and a key beneath it.
 *
 * Each segment is coloured by its key through `fig-stack-seg--<key>` and
 * `fig-key-swatch--<key>`, and the key repeats each count in writing, so
 * colour is never the only encoding. Empty segments are not drawn.
 */
export function StackedBar({ segments }: { segments: StackSegment[] }) {
  const shown = segments.filter(s => s.n > 0);
  return (
    <>
      <div
        className="fig-stack"
        role="img"
        aria-label={shown.map(s => `${s.n} ${s.label}`).join(', ')}
      >
        {shown.map(s => (
          <div
            key={s.key}
            className={`fig-stack-seg fig-stack-seg--${s.key}`}
            style={{ flexGrow: s.n }}
            title={`${s.n} ${s.label}`}
          />
        ))}
      </div>
      <ul className="fig-key">
        {shown.map(s => (
          <li key={s.key} className="fig-key-item">
            <span className={`fig-key-swatch fig-key-swatch--${s.key}`} aria-hidden="true" />
            <span className="fig-key-n" style={NUM}>
              {s.n}
            </span>
            <span className="fig-key-label">{s.label}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

type Series = LoopSnapshot['roi']['monthly_hours'];

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

/**
 * The last runs of one check, oldest to newest, as a row of bars.
 *
 * A pass is a short bar and a failure a tall one, so the difference is a height
 * before it is a hue, and it holds where red and green are one colour. The
 * window is always as wide as the projection sends: a slot the check has not
 * filled yet is a faint tick at the old end, so a check that has run once reads
 * as one run in a window of fourteen and not as one that fails often. With no
 * run at all nothing is drawn, because a strip of empty slots would say a check
 * exists that has never been run.
 */
export function HistoryStrip({ runs, of }: { runs: CheckRun[]; of?: string }) {
  if (!runs.length) return null;
  const shown = runs.slice(-CHECK_HISTORY_RUNS);
  const said = describeRuns(shown, of);
  return (
    <span className="fig-history" role="img" aria-label={said} title={said}>
      {Array.from({ length: CHECK_HISTORY_RUNS - shown.length }, (_, i) => (
        <span
          key={`none-${i}`}
          className="fig-history-bar fig-history-bar--none"
          aria-hidden="true"
        />
      ))}
      {shown.map((r, i) => (
        <span
          key={`${i}:${r.id}`}
          className={`fig-history-bar fig-history-bar--${r.passed ? 'pass' : 'fail'}`}
          aria-hidden="true"
        />
      ))}
    </span>
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
  proven,
  reached,
  failing = 0,
  next,
  total,
}: {
  /** The verified part of reached, drawn solid; the rest of reached is drawn lighter. */
  proven?: number;
  reached: number;
  /** Configured and failing its check: red after reached, as an era's header draws it. */
  failing?: number;
  next: number;
  total: number;
}) {
  const w = 44;
  const h = 6;
  const seg = (n: number) => (total ? (n / total) * w : 0);
  const solid = proven ?? reached;
  return (
    <svg className="fig-reach" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <rect className="fig-eras-track" x={0} y={0} width={w} height={h} rx={1.5} />
      {reached > solid && (
        <rect className="fig-eras-unproven" x={0} y={0} width={seg(reached)} height={h} rx={1.5} />
      )}
      {solid > 0 && (
        <rect className="fig-eras-reached" x={0} y={0} width={seg(solid)} height={h} rx={1.5} />
      )}
      {failing > 0 && (
        <rect
          className="fig-eras-failing"
          x={seg(reached)}
          y={0}
          width={seg(failing)}
          height={h}
          rx={1.5}
        />
      )}
      {next > 0 && (
        <rect
          className="fig-eras-next"
          x={seg(reached + failing) + 0.5}
          y={0.5}
          width={Math.max(seg(next) - 1, 1)}
          height={h - 1}
          rx={1}
        />
      )}
    </svg>
  );
}

/**
 * The seal on something signed: an approval the executor will verify. A
 * scalloped disc with a check, drawn only where a signature exists, so it
 * means one thing the way the map's stripes mean one thing. A green pill said
 * "signed" in the same shape as "check passed".
 */
export function Seal({ size = 18, label }: { size?: number; label?: string }) {
  const c = size / 2;
  const teeth = 12;
  const outer = c - 0.5;
  const inner = c - 2;
  const points = Array.from({ length: teeth * 2 }, (_, i) => {
    const r = i % 2 ? inner : outer;
    const a = (Math.PI * i) / teeth;
    return `${(c + r * Math.cos(a)).toFixed(2)},${(c + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
  return (
    <svg
      className="seal"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <polygon className="seal-edge" points={points} />
      <circle className="seal-face" cx={c} cy={c} r={c - 3.5} />
      <path
        className="seal-check"
        d={`M${c - size * 0.18} ${c + size * 0.01} L${c - size * 0.04} ${c + size * 0.14} L${c + size * 0.2} ${c - size * 0.13}`}
      />
    </svg>
  );
}
