import React from 'react';
import type { RunAsk, RunView } from '../../shared/api';
import { useAmbitStore } from '../store/ambitStore';
import {
  askMark,
  epoch,
  humanSentence,
  type RunDomain,
  runDomain,
  span,
} from '../utils/runTimeline';
import { NUM } from './figures';

/**
 * One run, laid out in time: where it went, and how much of it was yours.
 *
 * The Time & cost page prices a month of attention in aggregate, and a person
 * who wants to know what a single session cost them had only a list of counts.
 * This draws one run from what the ledger recorded and nothing else. The run is
 * a bar, the capabilities it used are bars of the length they were measured to
 * last, the events are points, and every time a person was asked sits in a lane
 * of its own: an amber span where both the ask and its answer were recorded,
 * and a marked point where they were not.
 *
 * The point is the rule this page keeps everywhere. The OpenCode plugin logs a
 * permission prompt and cannot see the reply, so most asks have no end, and an
 * ask with no figure drawn as a span of nothing would say the person waited no
 * time at all. It is a hollow mark that says "not timed", and the total counts
 * only asks something timed.
 */

// The scene, in SVG units. The lanes read top to bottom: the run, what it used,
// what happened, and you.
const W = 720;
const X0 = 84;
const X1 = W - 14;
const LANE = { run: 14, used: 38, events: 66, you: 90 } as const;
const AXIS_Y = 122;
const H = 138;

/** A clock time, in the reader's own zone. */
const clock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** A diamond, drawn about (x, y): the mark for an ask that is a point. */
const diamond = (x: number, y: number, r = 5) =>
  `M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`;

function askTitle(a: RunAsk): string {
  const about = [a.capability, a.action].filter(Boolean).join(' · ');
  const took =
    a.seconds === null
      ? 'not timed'
      : a.ended_at
        ? `answered after ${span(a.seconds)}`
        : `${span(a.seconds)} recorded, no end time`;
  return `${a.gate ? 'Permission' : a.kind} · ${about ? `${about} · ` : ''}${took}`;
}

function RunChart({ run, domain }: { run: RunView; domain: RunDomain }) {
  const { start, end, open, seconds } = domain;
  const x = (t: number) => X0 + ((t - start) / (end - start)) * (X1 - X0);
  const runStart = epoch(run.started_at) ?? start;
  // An open run is drawn to the last thing seen, and the bar is dashed to say
  // that the end is not a time anyone stated. With nothing seen after its
  // start it is a mark there, not a bar across a second nobody saw.
  const runEnd = epoch(run.ended_at) ?? (seconds === null ? runStart : end);
  const asksDrawn = run.asks.filter(a => epoch(a.at) !== undefined);

  const summary = [
    seconds === null
      ? 'Run with no end recorded, and nothing recorded after its start'
      : `Run of ${span(seconds)}${open ? ', no end recorded' : ''}`,
    `${run.uses_total} capability ${run.uses_total === 1 ? 'use' : 'uses'}`,
    `${run.events_total} ${run.events_total === 1 ? 'event' : 'events'}`,
    `${run.asks_total} ${run.asks_total === 1 ? 'ask' : 'asks'}: ${humanSentence(run)}`,
  ].join('. ');

  return (
    <svg className="fig-run" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
      <title>{summary}</title>
      {(
        [
          ['Run', LANE.run + 4],
          ['Used', LANE.used + 6],
          ['Events', LANE.events + 3],
          ['You', LANE.you + 7],
        ] as const
      ).map(([label, y]) => (
        <text key={label} className="fig-run-lane" x={0} y={y}>
          {label}
        </text>
      ))}

      <rect
        className={`fig-run-bar ${open ? 'fig-run-bar--open' : ''}`}
        x={x(runStart)}
        y={LANE.run}
        width={Math.max(x(runEnd) - x(runStart), 2)}
        height={8}
        rx={4}
      >
        <title>
          {seconds === null
            ? 'No end recorded, and nothing recorded after the start'
            : open
              ? 'No end recorded: drawn to the last thing seen'
              : `Ran ${span((runEnd - runStart) / 1000)}`}
        </title>
      </rect>

      {run.uses.map((u, i) => {
        const t = epoch(u.at);
        if (t === undefined) return null;
        return u.seconds !== null ? (
          <rect
            key={`use-${i}`}
            className="fig-run-use"
            x={x(t)}
            y={LANE.used}
            width={Math.max(x(t + u.seconds * 1000) - x(t), 2)}
            height={11}
            rx={2}
          >
            <title>{`${u.capability}, ${span(u.seconds)}`}</title>
          </rect>
        ) : (
          <circle
            key={`use-${i}`}
            className="fig-run-use-pt"
            cx={x(t)}
            cy={LANE.used + 5.5}
            r={3.2}
          >
            <title>{`${u.capability}, duration not recorded`}</title>
          </circle>
        );
      })}

      {run.events.map((e, i) => {
        const t = epoch(e.at);
        if (t === undefined) return null;
        return (
          <circle
            key={`event-${i}`}
            className="fig-run-event"
            cx={x(t)}
            cy={LANE.events + 6}
            r={1.7}
          >
            <title>{[e.kind, e.action].filter(Boolean).join(' · ')}</title>
          </circle>
        );
      })}

      {asksDrawn.map((a, i) => {
        const t = epoch(a.at) as number;
        const tone = a.gate ? 'fig-run-ask--gate' : 'fig-run-ask--other';
        const mark = askMark(a);
        if (mark === 'span') {
          const to = epoch(a.ended_at) as number;
          return (
            <rect
              key={`ask-${i}`}
              className={`fig-run-ask ${tone}`}
              x={x(t)}
              y={LANE.you}
              width={Math.max(x(to) - x(t), 3)}
              height={14}
              rx={3}
            >
              <title>{askTitle(a)}</title>
            </rect>
          );
        }
        return (
          <path
            key={`ask-${i}`}
            className={`fig-run-ask-pt ${tone} ${mark === 'untimed-point' ? 'is-untimed' : 'is-timed'}`}
            d={diamond(x(t), LANE.you + 7)}
          >
            <title>{askTitle(a)}</title>
          </path>
        );
      })}

      {/* The axis states a stretch of time. A run with none, one instant or
          nothing after its start, has no axis: its second of width is the
          drawing's, and the times at either end of it were invented. */}
      {seconds ? (
        <>
          <line className="fig-run-axis" x1={X0} y1={AXIS_Y - 8} x2={X1} y2={AXIS_Y - 8} />
          <text className="fig-tick" x={X0} y={AXIS_Y + 6} textAnchor="start" style={NUM}>
            {clock(start)}
          </text>
          <text
            className="fig-tick"
            x={(X0 + X1) / 2}
            y={AXIS_Y + 6}
            textAnchor="middle"
            style={NUM}
          >
            {span(seconds)}
          </text>
          <text className="fig-tick" x={X1} y={AXIS_Y + 6} textAnchor="end" style={NUM}>
            {clock(end)}
            {open ? ' (last seen)' : ''}
          </text>
        </>
      ) : null}
    </svg>
  );
}

/** What each mark means, once, under the chart: the amber is a person being asked for permission. */
function RunKey() {
  return (
    <ul className="fig-run-key" aria-label="What the marks mean">
      <li>
        <svg width="26" height="12" aria-hidden="true">
          <rect
            className="fig-run-ask fig-run-ask--gate"
            x="1"
            y="1"
            width="24"
            height="10"
            rx="3"
          />
        </svg>
        asked for permission, from the ask to the answer
      </li>
      <li>
        <svg width="26" height="12" aria-hidden="true">
          <rect
            className="fig-run-ask fig-run-ask--other"
            x="1"
            y="1"
            width="24"
            height="10"
            rx="3"
          />
        </svg>
        asked for something else, timed
      </li>
      <li>
        <svg width="14" height="12" aria-hidden="true">
          <path className="fig-run-ask-pt fig-run-ask--gate is-timed" d={diamond(7, 6, 5)} />
        </svg>
        a figure was recorded, and no end
      </li>
      <li>
        <svg width="14" height="12" aria-hidden="true">
          <path className="fig-run-ask-pt fig-run-ask--gate is-untimed" d={diamond(7, 6, 5)} />
        </svg>
        not timed: asked, and nothing recorded how long it took
      </li>
    </ul>
  );
}

/** The asks as text, in order: the same marks, readable without the chart. */
function AskList({ run }: { run: RunView }) {
  if (!run.asks.length) return null;
  return (
    <table className="fig-run-asks">
      <caption className="sr-only">Every time you were asked in this run</caption>
      <thead>
        <tr>
          <th scope="col">Asked</th>
          <th scope="col">About</th>
          <th scope="col">Took</th>
        </tr>
      </thead>
      <tbody>
        {run.asks.map((a, i) => {
          const t = epoch(a.at);
          const about = [a.capability, a.action].filter(Boolean).join(' · ');
          return (
            <tr key={`${a.at}-${i}`}>
              <td style={NUM}>
                {t !== undefined ? clock(t) : ''}
                <span className={`fig-tag ${a.gate ? 'fig-tag--gate' : ''}`}>
                  {a.gate ? 'permission' : a.kind}
                </span>
              </td>
              <td>{about}</td>
              <td style={NUM}>
                {a.seconds === null ? (
                  <span className="fig-run-untimed">not timed</span>
                ) : (
                  <>
                    {span(a.seconds)}
                    {!a.ended_at && <span className="fig-run-note"> · no end recorded</span>}
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const label = (r: { id: string; goal?: string; started_at: string; asks: number }) => {
  const at = epoch(r.started_at);
  return [
    r.goal || r.id,
    at !== undefined
      ? new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      : '',
    `${r.asks} ${r.asks === 1 ? 'ask' : 'asks'}`,
  ]
    .filter(Boolean)
    .join(' · ');
};

/**
 * The run section of the Time & cost page: a chooser over recent runs and the
 * one chosen, drawn. The store loads it, from the ledger on a real machine and
 * from a hand-written run on the demo; the ledger having no runs is a state
 * the section says, and not a blank.
 */
export default function RunSection() {
  const data = useAmbitStore(s => s.run);
  const loadRun = useAmbitStore(s => s.loadRun);
  const sample = useAmbitStore(s => s.loopSource) === 'sample';
  // Null when nothing in the run has a time that reads: then there is no
  // chart, and no key to marks nobody drew.
  const domain = data?.run ? runDomain(data.run) : null;

  React.useEffect(() => {
    if (!data) loadRun();
  }, [data, loadRun]);

  return (
    <section className="fig-run-section">
      <div className="loop-section-head">
        <h3 className="loop-section-title">One run, in time</h3>
        {data && data.recent.length > 1 && (
          <select
            className="fig-run-pick"
            aria-label="Choose a run"
            value={data.run?.id ?? ''}
            onChange={e => loadRun(e.target.value)}
          >
            {data.recent.map(r => (
              <option key={r.id} value={r.id}>
                {label(r)}
              </option>
            ))}
          </select>
        )}
      </div>

      {!data && <p className="fig-note">Reading the ledger…</p>}
      {data && !data.run && (
        <p className="fig-note">
          No run recorded yet. A run groups the capabilities used, the events and the times you were
          asked in one session; <code>plugins/ambit-telemetry.js</code> writes one per session.
        </p>
      )}
      {data?.run && (
        <figure className="fig fig--run">
          <figcaption className="fig-caption">
            <span className="fig-caption-title">{data.run.goal || data.run.id}</span>
            <span className="fig-caption-note" style={NUM}>
              {sample ? 'a sample run · ' : ''}
              recorded as it happened: nothing here is inferred
            </span>
          </figcaption>
          <p className="fig-run-human" style={NUM}>
            {humanSentence(data.run)}
          </p>
          {/* The sentence is the finding; the lanes and the asks are its
              evidence, a click in. Drawn open, they were the page's tallest
              section, under everything a first read was for. */}
          <details className="fig-row-more">
            <summary>Show the run in time</summary>
            {domain && <RunChart run={data.run} domain={domain} />}
            {domain && <RunKey />}
            <AskList run={data.run} />
          </details>
          {(data.run.events_total > data.run.events.length ||
            data.run.uses_total > data.run.uses.length ||
            data.run.asks_total > data.run.asks.length) && (
            <p className="fig-note">
              Drawn: the latest {data.run.events.length} of {data.run.events_total} events,{' '}
              {data.run.uses.length} of {data.run.uses_total} uses and {data.run.asks.length} of{' '}
              {data.run.asks_total} asks.
            </p>
          )}
        </figure>
      )}
    </section>
  );
}
