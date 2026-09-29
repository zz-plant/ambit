/**
 * One run, in time, and the marks that keep it honest.
 *
 * The chart's job is the lane for the person: an amber span where an ask and its
 * answer were both recorded, and a hollow marked point where they were not. The
 * OpenCode plugin logs a permission prompt and cannot see the reply, so most
 * asks have no end, and drawing one as a span of no width would say the person
 * waited no time at all. These render the section on a run with one timed ask
 * and one untimed and look at exactly what is drawn.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import type { RunAsk, RunResponse, RunView } from '../../shared/api';
import { useAmbitStore } from '../store/ambitStore';
import { demoRun } from '../utils/demoRun';
import { demoSnapshot } from '../utils/demoSnapshot';
import LoopDashboard from './LoopDashboard';
import RunSection from './RunTimeline';

/** `renderToStaticMarkup` reads zustand's initial state, so both halves are set. */
function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

afterEach(() => {
  vi.unstubAllGlobals();
  seed({ run: null, demo: false, loop: null, loopSource: null, loopEmpty: false });
});

const T0 = Date.parse('2026-09-29T10:00:00.000Z');
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();

const ask = (over: Partial<RunAsk> = {}): RunAsk => ({
  kind: 'authority',
  actor: 'human:you',
  at: at(60),
  ended_at: null,
  seconds: null,
  gate: true,
  ...over,
});

const view = (over: Partial<RunView> = {}): RunView => ({
  id: 'run-a',
  goal: 'Ship the release',
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

/** The section, drawing this run. */
function draw(run: RunView | null, recent?: RunResponse['recent']) {
  seed({
    run: {
      recent:
        recent ??
        (run
          ? [
              {
                id: run.id,
                goal: run.goal,
                started_at: run.started_at,
                ended_at: run.ended_at,
                asks: run.asks_total,
                events: run.events_total,
              },
            ]
          : []),
      run,
    },
  });
  return renderToStaticMarkup(<RunSection />);
}

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
/** Only the chart, since the key beneath it draws every mark once as well. */
const chart = (html: string) => html.match(/<svg class="fig-run"[\s\S]*?<\/svg>/)?.[0] ?? '';

/** One ask whose answer was recorded, and one the plugin left without an end. */
const oneTimedOneNot = view({
  asks: [
    ask({ at: at(60), ended_at: at(190), seconds: 130 }),
    ask({ at: at(300), capability: 'Secret Management', action: 'read_secret' }),
  ],
  asks_total: 2,
  human: { seconds: 130, timed: 1, untimed: 1 },
});

test('a run with one timed and one untimed ask draws one amber span and one marked point', () => {
  const svg = chart(draw(oneTimedOneNot));

  // One span, amber, and the untimed ask is not a span at all.
  expect(svg.match(/<rect class="fig-run-ask fig-run-ask--gate"/g)).toHaveLength(1);
  // One point, marked as untimed, in the same amber.
  expect(svg.match(/fig-run-ask-pt fig-run-ask--gate is-untimed/g)).toHaveLength(1);
  expect(svg.match(/fig-run-ask-pt/g)).toHaveLength(1);
  // It is said in words where the eye lands.
  expect(svg).toContain('not timed');
});

test('the total counts only the timed ask, and says so', () => {
  const said = text(draw(oneTimedOneNot));
  expect(said).toContain(
    'Your time in this run: 2m 10s, counting only the 1 ask that was timed. 1 ask was not timed and is left out.'
  );
});

test('an ask nobody timed is never drawn with an extent', () => {
  const untimedOnly = view({
    asks: [ask({ at: at(300) }), ask({ at: at(400), kind: 'approval' })],
    asks_total: 2,
    human: { seconds: 0, timed: 0, untimed: 2 },
  });
  const html = draw(untimedOnly);
  const svg = chart(html);

  // Two points and no span: nothing here has a width, and no figure of zero.
  expect(svg.match(/fig-run-ask-pt/g)).toHaveLength(2);
  expect(svg).not.toMatch(/<rect class="fig-run-ask /);
  expect(text(html)).toContain(
    'No ask in this run was timed, so how much of your time it took is not measured.'
  );
  expect(text(html)).not.toMatch(/\b0s\b/);
});

test('an ask with a figure and no end is a filled point, not a span and not hollow', () => {
  const svg = chart(
    draw(
      view({
        asks: [ask({ seconds: 20 })],
        asks_total: 1,
        human: { seconds: 20, timed: 1, untimed: 0 },
      })
    )
  );
  expect(svg).toContain('fig-run-ask-pt fig-run-ask--gate is-timed');
  expect(svg).not.toContain('is-untimed');
  expect(svg).not.toMatch(/<rect class="fig-run-ask /);
});

test('only permission asks are amber; an ask of another kind is grey', () => {
  const svg = chart(
    draw(
      view({
        asks: [ask({ kind: 'judgment', gate: false, at: at(60), ended_at: at(100), seconds: 40 })],
        asks_total: 1,
        human: { seconds: 40, timed: 1, untimed: 0 },
      })
    )
  );
  expect(svg).toContain('fig-run-ask--other');
  expect(svg).not.toContain('fig-run-ask--gate');
});

test('every ask is also listed as text, with how long it took or that it was not timed', () => {
  const html = draw(oneTimedOneNot);
  const list = html.match(/<table class="fig-run-asks"[\s\S]*?<\/table>/)?.[0] ?? '';
  expect(text(list)).toContain('2m 10s');
  expect(text(list)).toContain('not timed');
  expect(text(list)).toContain('Secret Management · read_secret');
  expect(list.match(/<tr/g)).toHaveLength(3);
});

test('a run with no end says so, and is drawn to the last thing seen', () => {
  const html = draw(
    view({ ended_at: null, events: [{ at: at(240), kind: 'tool' }], events_total: 1 })
  );
  expect(chart(html)).toContain('fig-run-bar--open');
  expect(text(chart(html))).toContain('(last seen)');
});

test('a use is a bar where a length was measured and a point where it was not', () => {
  const svg = chart(
    draw(
      view({
        uses: [
          { capability: 'Shell', capability_id: 'combo:shell', at: at(10), seconds: 90 },
          { capability: 'Git', capability_id: 'combo:git', at: at(200), seconds: null },
        ],
        uses_total: 2,
      })
    )
  );
  expect(svg.match(/class="fig-run-use"/g)).toHaveLength(1);
  expect(svg.match(/class="fig-run-use-pt"/g)).toHaveLength(1);
  expect(svg).toContain('Git, duration not recorded');
});

test('events are points, one for each that was sent', () => {
  const events = [30, 90, 150].map(s => ({ at: at(s), kind: 'tool', action: 'bash' }));
  expect(
    chart(draw(view({ events, events_total: 3 })).toString()).match(/fig-run-event/g)
  ).toHaveLength(3);
});

test('a run nobody was asked in says so and draws no lane of asks', () => {
  const html = draw(view());
  expect(text(html)).toContain('You were not asked in this run.');
  expect(html).not.toContain('fig-run-asks');
  expect(chart(html)).not.toContain('fig-run-ask');
});

test('a long run says how much of it is drawn', () => {
  const html = draw(view({ events: [{ at: at(5), kind: 'tool' }], events_total: 1500 }));
  expect(text(html)).toContain('the latest 1 of 1500 events');
});

test('a ledger with no run says what writes one', () => {
  const said = text(draw(null));
  expect(said).toContain('No run recorded yet');
  expect(said).toContain('plugins/ambit-telemetry.js');
});

test('before the ledger has answered, the section says it is reading', () => {
  seed({ run: null });
  expect(text(renderToStaticMarkup(<RunSection />))).toContain('Reading the ledger');
});

test('several runs are offered to choose between, each with how often you were asked', () => {
  const html = draw(oneTimedOneNot, [
    { id: 'run-b', goal: 'Later', started_at: at(900), ended_at: null, asks: 0, events: 4 },
    {
      id: 'run-a',
      goal: 'Ship the release',
      started_at: at(0),
      ended_at: at(600),
      asks: 2,
      events: 0,
    },
  ]);
  expect(html).toContain('aria-label="Choose a run"');
  expect(text(html)).toContain('Later');
  expect(text(html)).toContain('2 asks');
  // One run is not a choice.
  expect(draw(oneTimedOneNot)).not.toContain('Choose a run');
});

test('nothing the ledger did not record reaches the page as a value', () => {
  const html = draw(
    view({
      goal: undefined,
      ended_at: null,
      // A start that will not read is left out of the drawing, and off the list's clock.
      asks: [ask({ at: 'not a time', capability: undefined, action: undefined })],
      asks_total: 1,
      human: { seconds: 0, timed: 0, untimed: 1 },
    })
  );
  for (const marker of ['undefined', 'NaN', 'Invalid Date', '[object Object]', 'null']) {
    expect(html.includes(marker), `rendered "${marker}"`).toBe(false);
  }
});

test('the demo draws a run with every case, and labels it a sample', () => {
  seed({ run: demoRun(), loopSource: 'sample' });
  const html = renderToStaticMarkup(<RunSection />);
  const svg = chart(html);

  expect(text(html)).toContain('a sample run');
  expect(svg.match(/<rect class="fig-run-ask fig-run-ask--gate"/g)).toHaveLength(1);
  expect(svg.match(/<rect class="fig-run-ask fig-run-ask--other"/g)).toHaveLength(1);
  expect(svg.match(/is-timed/g)).toHaveLength(1);
  expect(svg.match(/is-untimed/g)).toHaveLength(1);
  expect(text(html)).toContain('counting only the 3 asks that were timed. 1 ask was not timed');
});

test('the way in is on the Time & cost page', () => {
  seed({ loop: demoSnapshot(), loopSource: 'sample', loopEmpty: false, run: demoRun() });
  const html = renderToStaticMarkup(<LoopDashboard />);
  expect(text(html)).toContain('One run, in time');
  expect(html).toContain('fig-run');
});

test('on the demo the runs are the demo’s, and a pick is answered without an engine', async () => {
  seed({ demo: true });
  await useAmbitStore.getState().loadRun();
  expect(useAmbitStore.getState().run?.run?.id).toBe('run-invoices');
  await useAmbitStore.getState().loadRun('run-deps');
  expect(useAmbitStore.getState().run?.run?.id).toBe('run-deps');
});

test('on a machine the run is asked of the engine, by name, and an error leaves what is shown', async () => {
  const served: RunResponse = { recent: [], run: view({ id: 'run/with space' }) };
  const fetched: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    const body = url.startsWith('/api/health')
      ? { status: 'ok' }
      : url.includes('missing')
        ? { error: 'No run missing.' }
        : served;
    return { ok: true, json: async () => body };
  });

  seed({ demo: false, run: null });
  await useAmbitStore.getState().loadRun('run/with space');
  expect(fetched).toContain('/api/run?id=run%2Fwith%20space');
  expect(useAmbitStore.getState().run?.run?.id).toBe('run/with space');

  await useAmbitStore.getState().loadRun('missing');
  expect(useAmbitStore.getState().run?.run?.id).toBe('run/with space');
});
