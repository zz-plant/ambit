/**
 * The map as an observation of the frontier left it.
 *
 * A snapshot stores each capability's state, kind and lifecycle, and nothing
 * else: no names, eras or edges, no authority, no providers, no evidence
 * times. So a past map is today's tree, with today's names, eras and edges,
 * redrawn from the snapshot's states, and what the snapshot cannot supply is
 * dropped from it, never filled in from today. Pure, so the rule is tested
 * apart from the renderer.
 */
import type { FrontierHistoryResponse, FrontierTick } from '../../../shared/api';
import { readSecond } from '../../linkState';
import type { Connection, Item } from '../../utils/configImporter';

/**
 * What a past node keeps of today's meta: where it sits on the curated tree
 * and what reaching it costs, which are the tree's facts and not the
 * machine's. Everything else in meta is today's evidence, grants or config.
 */
const KEPT = ['domain', 'era', 'eraName', 'setupSeconds'] as const;

/** The second a tick names, as the URL's `at` writes it. */
export const tickSecond = (tick: FrontierTick): string => readSecond(tick.at) ?? tick.at;

/** The tick the playhead names, or null for now: a second no tick has is now. */
export function tickAt(
  history: FrontierHistoryResponse | null | undefined,
  at: string | null | undefined
): FrontierTick | null {
  if (!history || !at) return null;
  return history.ticks.find(t => tickSecond(t) === at) ?? null;
}

/**
 * Today's items as the tick left them.
 *
 * Only what the snapshot held is drawn. State and lifecycle are the
 * snapshot's; a next step is a locked node whose required prerequisites the
 * snapshot records as reached, over today's edges, since past edges are not
 * stored. A tick recorded before lifecycles were gives no lifecycle at all,
 * which draws no check either way.
 */
export function itemsAsOf(items: Item[], connections: Connection[], tick: FrontierTick): Item[] {
  const reached = (id: string) => {
    const state = tick.states[id];
    return state !== undefined && state !== 'locked';
  };
  const required = new Map<string, string[]>();
  for (const c of connections) {
    if (c.type !== 'hard-dep') continue;
    if (!required.has(c.to)) required.set(c.to, []);
    required.get(c.to)!.push(c.from);
  }
  return items
    .filter(item => tick.states[item.id] !== undefined)
    .map(item => {
      const state = tick.states[item.id];
      const lifecycle = tick.lifecycles?.[item.id];
      const meta: Record<string, unknown> = {};
      for (const key of KEPT) {
        if (item.meta?.[key] !== undefined) meta[key] = item.meta[key];
      }
      meta.state = state;
      meta.next = state === 'locked' && (required.get(item.id) ?? []).every(reached);
      if (lifecycle !== undefined) meta.lifecycle = lifecycle;
      return {
        ...item,
        status: state === 'locked' ? ('specified' as const) : ('built' as const),
        meta,
      };
    });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A stored second as a date, or null when it is not one. */
function parts(at: string) {
  const second = readSecond(at);
  if (!second) return null;
  const d = new Date(second);
  return {
    day: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`,
    year: d.getUTCFullYear(),
    time: second.slice(11, 16),
  };
}

/** `Sep 26`: the day a tick was taken, in UTC, the ledger's clock. */
export function dayOf(at: string): string {
  return parts(at)?.day ?? at;
}

/** `Sep 26, 2026, 10:00 UTC`: the whole of what a tick's second says. */
export function momentOf(at: string): string {
  const p = parts(at);
  return p ? `${p.day}, ${p.year}, ${p.time} UTC` : at;
}

/**
 * The timeline's sentence: what moved at the tick on screen, in the words
 * `ambit history since` prints, or at the live end, what moved since the
 * newest tick.
 */
export function timelineSentence(history: FrontierHistoryResponse, tick: FrontierTick | null) {
  if (tick) return `${dayOf(tick.at)}: ${tick.moved}.`;
  const last = history.ticks[history.ticks.length - 1];
  if (!last) return '';
  return history.movedSinceLast
    ? `Since ${dayOf(last.at)}: ${history.movedSinceLast}.`
    : `Nothing has moved since ${dayOf(last.at)}.`;
}

/**
 * How long Play holds each stop before the next. The sentence it changes runs
 * to a dozen words ("Aug 31: reached 46 to 65, 3 emergent."), and the map
 * redraws under it, so a stop has to last long enough to read one and glance
 * at the other; 1.4 seconds does both, and plays the demo's five observations
 * through to now in seven. Reduced motion keeps the same pace: each step is a
 * new reading the person asked for, not decoration, and none of it animates.
 */
export const PLAY_STEP_MS = 1400;

/**
 * Where Play starts: the observation on screen, or the first one when the
 * playhead is on now, since from now nothing is left to play. Null only for a
 * series with no observation in it.
 */
export function playStart(history: FrontierHistoryResponse, at: string | null): string | null {
  const tick = tickAt(history, at) ?? history.ticks[0];
  return tick ? tickSecond(tick) : null;
}

/**
 * The stop after the playhead: the next observation's second, or null for
 * now once the newest has been shown. Now is the last stop, so from now the
 * answer is now again, which is where Play stops.
 */
export function nextStop(history: FrontierHistoryResponse, at: string | null): string | null {
  const tick = tickAt(history, at);
  if (!tick) return null;
  const next = history.ticks[history.ticks.indexOf(tick) + 1];
  return next ? tickSecond(next) : null;
}

/**
 * Whether there is a history to draw: two observations, the fewest with
 * anything between them. One is a point, and a full-width strip saying so sat
 * under every first look at the map.
 */
export const hasHistory = (history: FrontierHistoryResponse | null): boolean =>
  (history?.ticks.length ?? 0) >= 2;
