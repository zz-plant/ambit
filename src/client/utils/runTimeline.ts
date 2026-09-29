import type { RunAsk, RunView } from '../../shared/api';

/**
 * Where a run's marks sit in time, and how its figures are worded.
 *
 * Pure, so the layout and the sentence about a person's time are tested apart
 * from the page that draws them. Times arrive as ISO strings in UTC, normalized
 * by the engine; anything that will not read is left out, never drawn at a
 * guessed place.
 */

/** An ISO time as milliseconds, or nothing when it will not read. */
export const epoch = (iso?: string | null): number | undefined => {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
};

/**
 * The stretch of time the run's marks are drawn over.
 *
 * From the run's start to its end, and further either way for anything the
 * ledger recorded outside them: a clock that disagrees, or a runtime that never
 * reported the end. `open` says the run has no end recorded, so the bar is
 * drawn to the last thing seen and not to a time nobody stated.
 */
export function runDomain(run: RunView): { start: number; end: number; open: boolean } {
  const points: number[] = [];
  const start = epoch(run.started_at);
  if (start !== undefined) points.push(start);
  const ended = epoch(run.ended_at);
  if (ended !== undefined) points.push(ended);
  for (const u of run.uses) {
    const at = epoch(u.at);
    if (at !== undefined) points.push(at, at + (u.seconds ?? 0) * 1000);
  }
  for (const e of run.events) {
    const at = epoch(e.at);
    if (at !== undefined) points.push(at);
  }
  for (const a of run.asks) {
    const at = epoch(a.at);
    if (at !== undefined) points.push(at);
    const end = epoch(a.ended_at);
    if (end !== undefined) points.push(end);
  }
  const from = points.length ? Math.min(...points) : 0;
  const to = points.length ? Math.max(...points) : 0;
  // A run whose every mark falls in one instant still needs a width to draw in.
  return { start: from, end: to > from ? to : from + 1000, open: ended === undefined };
}

/** Seconds as a person says them: "45s", "2m 10s", "1h 05m". Under a second is said so. */
export function span(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 1) return 'under 1s';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

/**
 * What a person's time in the run was, and what it counts.
 *
 * Only asks something timed are added up, and the sentence says so, because a
 * total that quietly included the asks nobody measured would state a figure the
 * ledger does not hold. An ask with nothing timed is named as such and left out.
 */
export function humanSentence(run: RunView): string {
  const { seconds, timed, untimed } = run.human;
  const asks = (n: number) => `${n} ${n === 1 ? 'ask' : 'asks'}`;
  if (timed + untimed === 0) return 'You were not asked in this run.';
  if (timed === 0) {
    return `No ask in this run was timed, so how much of your time it took is not measured. ${asks(untimed)} recorded.`;
  }
  if (untimed === 0) return `Your time in this run: ${span(seconds)}, across ${asks(timed)}.`;
  return `Your time in this run: ${span(seconds)}, counting only the ${asks(timed)} that ${timed === 1 ? 'was' : 'were'} timed. ${asks(untimed)} ${untimed === 1 ? 'was' : 'were'} not timed and ${untimed === 1 ? 'is' : 'are'} left out.`;
}

/** How one ask is drawn: a span with both ends, a filled point with a figure, a hollow one with none. */
export type AskMark = 'span' | 'timed-point' | 'untimed-point';

export function askMark(a: RunAsk): AskMark {
  if (a.ended_at && a.seconds !== null) return 'span';
  return a.seconds !== null ? 'timed-point' : 'untimed-point';
}
