/**
 * The frontier through time, under the map.
 *
 * One tick per second the ledger took a snapshot in, and a playhead that
 * redraws the map as that snapshot left it. The playhead is a range input:
 * it drags, and the arrow keys, Home and End step it, with nothing to
 * reimplement. Its far end is now, the map every other surface reads.
 */
import type { FrontierHistoryResponse } from '../../../shared/api';
import { Term } from '../Term';
import { beforeHistory, dayOf, momentOf, tickSecond, timelineSentence } from './history';

interface TimelineProps {
  history: FrontierHistoryResponse;
  /** The second the playhead is on, as the URL writes it; null for now. */
  at: string | null;
  onScrub: (at: string | null) => void;
  leftInset?: number;
  rightInset?: number;
}

export function Timeline({ history, at, onScrub, leftInset = 0, rightInset = 0 }: TimelineProps) {
  const { ticks } = history;
  const style = { paddingLeft: 12 + leftInset, paddingRight: 12 + rightInset };

  // One observation is a point, not a line: say how history begins instead.
  if (ticks.length < 2) {
    return (
      <section
        className="civ-timeline civ-timeline--before"
        style={style}
        aria-label="The frontier through time"
      >
        <p className="civ-timeline-note">
          <Term name="frontier" />
          <span>{beforeHistory(history)}</span>
        </p>
      </section>
    );
  }

  const index = at ? ticks.findIndex(t => tickSecond(t) === at) : -1;
  const tick = index === -1 ? null : ticks[index];
  // The live end sits one step past the newest tick.
  const position = tick ? index : ticks.length;
  const place = (i: number) => `${(i / ticks.length) * 100}%`;

  return (
    <section className="civ-timeline" style={style} aria-label="The frontier through time">
      <div className="civ-timeline-head">
        <Term name="frontier" />
        <span className="civ-timeline-sentence" role="status">
          {timelineSentence(history, tick)}
        </span>
        {tick && (
          <button type="button" className="civ-timeline-now" onClick={() => onScrub(null)}>
            Back to now
          </button>
        )}
      </div>
      <div className="civ-timeline-track">
        <ol className="civ-timeline-ticks" aria-hidden="true">
          {ticks.map((t, i) => (
            <li
              key={t.at}
              className={`civ-timeline-tick ${i === index ? 'is-on' : ''}`}
              style={{ left: place(i) }}
              title={momentOf(t.at)}
            />
          ))}
          <li
            className={`civ-timeline-tick civ-timeline-tick--now ${tick ? '' : 'is-on'}`}
            style={{ left: place(ticks.length) }}
          />
        </ol>
        <input
          type="range"
          className="civ-timeline-range"
          min={0}
          max={ticks.length}
          step={1}
          value={position}
          aria-label="Scrub the frontier through time"
          aria-valuetext={tick ? momentOf(tick.at) : 'Now'}
          onChange={e => {
            const i = Number(e.target.value);
            onScrub(i >= ticks.length ? null : tickSecond(ticks[i]));
          }}
        />
      </div>
      <div className="civ-timeline-ends" aria-hidden="true">
        <span>{dayOf(ticks[0].at)}</span>
        <span>Now</span>
      </div>
    </section>
  );
}
