/**
 * The frontier through time, under the map.
 *
 * One tick per second the ledger took a snapshot in, and a playhead that
 * redraws the map as that snapshot left it. The playhead is a range input:
 * it drags, and the arrow keys, Home and End step it, with nothing to
 * reimplement. Its far end is now, the map every other surface reads. Play
 * beside it steps the same stops on its own; the store keeps its timer, so
 * this stays a drawing of props, and nothing here moves the focus.
 */
import type { FrontierHistoryResponse } from '../../../shared/api';
import { timelineKey } from '../../utils/keys';
import { Term } from '../Term';
import { dayOf, hasHistory, momentOf, tickSecond, timelineSentence } from './history';

interface TimelineProps {
  history: FrontierHistoryResponse;
  /** The second the playhead is on, as the URL writes it; null for now. */
  at: string | null;
  /** A hand on the playhead: a drag, a step, or Back to now. It pauses Play. */
  onScrub: (at: string | null) => void;
  /** Whether Play is stepping the playhead on its own. */
  playing: boolean;
  onPlay: (playing: boolean) => void;
  leftInset?: number;
  rightInset?: number;
}

export function Timeline({
  history,
  at,
  onScrub,
  playing,
  onPlay,
  leftInset = 0,
  rightInset = 0,
}: TimelineProps) {
  const { ticks } = history;
  const style = { paddingLeft: 12 + leftInset, paddingRight: 12 + rightInset };

  if (!hasHistory(history)) return null;

  const index = at ? ticks.findIndex(t => tickSecond(t) === at) : -1;
  const tick = index === -1 ? null : ticks[index];
  // The live end sits one step past the newest tick.
  const position = tick ? index : ticks.length;
  const place = (i: number) => `${(i / ticks.length) * 100}%`;

  return (
    <section className="civ-timeline" style={style} aria-label="The frontier through time">
      <div className="civ-timeline-head">
        <Term name="frontier" />
        {/* A status, so each stop Play reaches is read out politely, as a
            scrub's is, without taking the focus from where it is. */}
        <span className="civ-timeline-sentence" role="status">
          {timelineSentence(history, tick)}
        </span>
        {tick && (
          <button type="button" className="civ-timeline-now" onClick={() => onScrub(null)}>
            Back to now
          </button>
        )}
      </div>
      <div className="civ-timeline-bar">
        {/* A toggle: the name stays Play and the pressed state says whether it
            is playing, while the drawing shows what a press would do. */}
        <button
          type="button"
          className={`civ-timeline-play${playing ? ' is-on' : ''}`}
          aria-label="Play"
          aria-pressed={playing}
          title={playing ? 'Pause (Space)' : 'Play each observation in turn, up to now (Space)'}
          onClick={() => onPlay(!playing)}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
            {playing ? <path d="M2.5 2h2.5v8H2.5zM7 2h2.5v8H7z" /> : <path d="M3 1.5v9L10.5 6z" />}
          </svg>
        </button>
        <div className="civ-timeline-scrub">
          <div className="civ-timeline-track">
            <ol className="civ-timeline-ticks" aria-hidden="true">
              {ticks.map((t, i) => (
                <li
                  key={t.at}
                  className={`civ-timeline-tick ${i === index ? 'is-on' : ''} ${
                    t.emergent?.length ? 'civ-timeline-tick--emergent' : ''
                  }`}
                  style={{ left: place(i) }}
                  title={
                    t.emergent?.length
                      ? `${momentOf(t.at)} · emergent: ${t.emergent.join(', ')}`
                      : momentOf(t.at)
                  }
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
              onKeyDown={e => {
                if (timelineKey(e, e.currentTarget) !== 'play') return;
                e.preventDefault();
                onPlay(!playing);
              }}
            />
          </div>
          <div className="civ-timeline-ends" aria-hidden="true">
            <span>{dayOf(ticks[0].at)}</span>
            <span>Now</span>
          </div>
        </div>
      </div>
    </section>
  );
}
