/**
 * Where a run's marks sit in time, and what is said about a person's part in it.
 *
 * The sentence is the part that can mislead. A total that added up the asks
 * nobody timed would state a figure the ledger does not hold, and one drawn for
 * an ask with no end would say the person waited no time at all. These hold the
 * wording to the rule: only timed asks are counted, and the page says so.
 */
import { expect, test } from 'vitest';
import type { RunAsk, RunView } from '../../shared/api';
import { demoRun } from './demoRun';
import { askMark, epoch, humanSentence, runDomain, span } from './runTimeline';

const T0 = Date.parse('2026-09-29T10:00:00.000Z');
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();

const run = (over: Partial<RunView> = {}): RunView => ({
  id: 'r',
  started_at: at(0),
  ended_at: at(600),
  uses: [],
  uses_total: 0,
  events: [],
  events_total: 0,
  asks: [],
  asks_total: 0,
  human: { seconds: 0, timed: 0, untimed: 0 },
  ...over,
});

const ask = (over: Partial<RunAsk> = {}): RunAsk => ({
  kind: 'authority',
  actor: 'human:you',
  at: at(60),
  ended_at: null,
  seconds: null,
  gate: true,
  ...over,
});

test('the run is drawn from its start to its end', () => {
  expect(runDomain(run())).toEqual({ start: T0, end: T0 + 600_000, open: false, seconds: 600 });
});

test('anything recorded outside the run widens it, and a run with no end is open', () => {
  const early = run({ ended_at: null, asks: [ask({ at: at(-30) })] });
  expect(runDomain(early)).toEqual({ start: T0 - 30_000, end: T0, open: true, seconds: 30 });

  // The last thing seen is where an open run is drawn to: a use with a length counts to its end.
  const used = run({
    ended_at: null,
    uses: [{ capability: 'A', capability_id: 'combo:a', at: at(100), seconds: 50 }],
    events: [{ at: at(120), kind: 'tool' }],
  });
  expect(runDomain(used)).toEqual({ start: T0, end: T0 + 150_000, open: true, seconds: 150 });
});

test('a run whose every mark is one instant still has a width to be drawn in, and no length', () => {
  // It ended the instant it started: that is a length, and it is none.
  const instant = runDomain(run({ ended_at: at(0) }))!;
  expect(instant.end).toBeGreaterThan(instant.start);
  expect(instant.seconds).toBe(0);

  // No end, and nothing after the start: how long it ran is not recorded, and
  // the second of width is not a second anyone measured.
  const started = runDomain(run({ ended_at: null }))!;
  expect(started.end).toBeGreaterThan(started.start);
  expect(started.seconds).toBeNull();
});

test('a run with no time that reads has nothing to be drawn against', () => {
  // The empty domain began at zero: midnight on the first of January 1970.
  expect(runDomain(run({ started_at: 'not a time', ended_at: null }))).toBeNull();
  expect(
    runDomain(run({ started_at: 'not a time', ended_at: null, asks: [ask({ at: 'nor this' })] }))
  ).toBeNull();
});

test('a time that will not read is left out of the domain, not drawn at zero', () => {
  const skewed = run({ asks: [ask({ at: 'not a time' })] });
  expect(runDomain(skewed)?.start).toBe(T0);
  expect(epoch('not a time')).toBeUndefined();
  expect(epoch(null)).toBeUndefined();
});

test('seconds are said the way a person says them, and under a second says so', () => {
  expect(span(0.4)).toBe('under 1s');
  expect(span(45)).toBe('45s');
  expect(span(130)).toBe('2m 10s');
  expect(span(3900)).toBe('1h 05m');
});

test('a run with one timed and one untimed ask counts only the timed one, and says so', () => {
  const said = humanSentence(
    run({
      asks: [ask({ seconds: 130, ended_at: at(190) }), ask({ at: at(300) })],
      human: { seconds: 130, timed: 1, untimed: 1 },
    })
  );
  expect(said).toBe(
    'Your time in this run: 2m 10s, counting only the 1 ask that was timed. 1 ask was not timed and is left out.'
  );
});

test('every ask timed is a total with nothing left out', () => {
  expect(humanSentence(run({ human: { seconds: 195, timed: 3, untimed: 0 } }))).toBe(
    'Your time in this run: 3m 15s, across 3 asks.'
  );
});

test('no ask timed is not a total of zero: it says the time is not measured', () => {
  const said = humanSentence(run({ human: { seconds: 0, timed: 0, untimed: 2 } }));
  expect(said).toContain('not measured');
  expect(said).not.toMatch(/\b0s\b|under 1s/);
});

test('nobody being asked is said as that', () => {
  expect(humanSentence(run())).toBe('You were not asked in this run.');
});

test('an ask is a span with both ends, a filled point with a figure, a hollow one with none', () => {
  expect(askMark(ask({ ended_at: at(90), seconds: 30 }))).toBe('span');
  expect(askMark(ask({ seconds: 20 }))).toBe('timed-point');
  expect(askMark(ask())).toBe('untimed-point');
  // An end with no figure behind it is not drawn as a length nobody measured.
  expect(askMark(ask({ ended_at: at(90), seconds: null }))).toBe('untimed-point');
});

test('the demo runs are consistent with themselves', () => {
  const { recent, run: shown } = demoRun();
  // Newest first, and the one drawn is the newest that recorded an ask.
  expect(recent.map(r => r.id)).toEqual(['run-deps', 'run-invoices']);
  expect(shown?.id).toBe('run-invoices');

  // The total is what the asks say, and counts only the timed ones.
  const timed = shown?.asks.filter(a => a.seconds !== null) ?? [];
  expect(shown?.human).toEqual({
    seconds: timed.reduce((s, a) => s + (a.seconds ?? 0), 0),
    timed: timed.length,
    untimed: (shown?.asks.length ?? 0) - timed.length,
  });
  // It shows each case the page has to draw.
  expect(shown?.asks.map(askMark).sort()).toEqual(['span', 'span', 'timed-point', 'untimed-point']);
  expect(shown?.asks.some(a => a.gate)).toBe(true);
  expect(shown?.asks.some(a => !a.gate)).toBe(true);

  expect(demoRun('run-deps').run?.asks).toEqual([]);
  expect(demoRun('nonesuch').run).toBeNull();
});
