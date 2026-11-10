/**
 * The sample tells one story.
 *
 * A visitor reads the demo across five views, and each view was written on
 * its own. Read in order they disagreed: the front door said a step took the
 * sample from 16 capabilities to 18 when it reaches one; the tour counted a
 * failing capability and then said it does not count; My Setup named a
 * different next step from the map; Time & cost gave the step a reason the map
 * does not draw; and one failing check was three hours old on the trail and
 * 45 days old in its panel. These pin the facts the views share.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test } from 'vitest';
import {
  columnProgress,
  isEntry,
  isFailing,
  mapFindings,
  stepStanding,
  unlockCascade,
  unlockEffect,
} from './components/civ/layout';
import LoopDashboard from './components/LoopDashboard';
import SetupView from './components/SetupView';
import { nextStepBody } from './components/Tour';
import WelcomeScreen from './components/WelcomeScreen';
import { mergeGraphs } from './store/ambitStore';
import { demoAudit, demoConfigGraph, demoTreeGraph } from './store/demo';
import { seed } from './testing/page';
import { demoSnapshot } from './utils/demoSnapshot';
import { toUtcEpoch } from '../shared/format';

afterEach(() => {
  seed({ items: [], connections: [], loop: null, loopSource: null, demo: false });
});

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');

const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
const snapshot = demoSnapshot();
const ranked = snapshot.next.map(n => n.id);
const best = mapFindings(items, connections, ranked).best!;
const standing = stepStanding(items, connections, best.item.id);

test('the count before a step leaves out what is failing, as the era heads do', () => {
  const tree = items.filter(i => !isEntry(i));
  expect(tree.some(isFailing)).toBe(true);
  expect(standing.reached).toBe(columnProgress(tree).reached);
  expect(standing.reached).toBe(tree.filter(i => i.status === 'built' && !isFailing(i)).length);
  expect(standing.total).toBe(tree.length);
});

test('the count after a step adds the step and what comes with it, not what it only opens', () => {
  const { reaches, opens } = unlockEffect(items, connections, best.item.id);
  expect(standing.after).toBe(standing.reached + 1 + reaches.length);
  // The sample's step opens something, or the arithmetic above proves nothing.
  expect(opens.length).toBeGreaterThan(0);
  expect(reaches.length + opens.length).toBe(unlockCascade(items, connections, best.item.id).size);
});

test('the front door and the tour state those two counts', () => {
  const door = text(
    renderToStaticMarkup(
      <WelcomeScreen onExploreDemo={() => {}} onViewLoop={() => {}} onMapped={() => {}} />
    )
  );
  expect(door).toContain(
    `They reach ${standing.reached} of ${standing.total} today, ${standing.after} after`
  );
  const card = nextStepBody(best.item.name, '10m', standing);
  expect(card).toContain(`reaches ${standing.reached} of ${standing.total} capabilities`);
  expect(card).toContain(`would bring that to ${standing.after}`);
  for (const opened of standing.opens) expect(card).toContain(opened.name);
});

test('a step that reaches others with it says which, apart from what it opens', () => {
  const named = (name: string) => ({ name }) as (typeof items)[number];
  expect(
    nextStepBody('Model Routing', '10m', {
      reached: 15,
      total: 46,
      after: 18,
      reaches: [named('Subagents'), named('Review Loop')],
      opens: [named('Evaluation')],
    })
  ).toBe(
    'This sample setup reaches 15 of 46 capabilities. Setting up Model Routing (about 10m) ' +
      'would bring that to 18, Subagents and Review Loop coming with it, and make Evaluation ' +
      'next steps. What it lights is ringed in blue.'
  );
});

test('My Setup names the next step the map names', () => {
  seed({ items, connections, loop: snapshot, loopSource: 'sample', demo: true });
  const setup = text(
    renderToStaticMarkup(<SetupView tab="entries" onTab={() => {}} onShow={() => {}} />)
  );
  expect(setup).toContain(`Next step: ${best.item.name}`);
});

test('the reason a step is given is what the map lights when it is played', () => {
  for (const step of snapshot.next) {
    const { reaches, opens } = unlockEffect(items, connections, step.id);
    for (const item of [...reaches, ...opens]) expect(step.why).toContain(item.name);
  }
  // The council's first seat quotes the first step's reason.
  expect(snapshot.council?.advisors[0].says).toBe(snapshot.next[0].why);
});

test('Time & cost says the first step once above the council, and prices hours at one rate', () => {
  seed({ loop: snapshot, loopSource: 'sample', loopEmpty: false });
  const page = text(renderToStaticMarkup(<LoopDashboard />));
  const reason = snapshot.next[0].why;
  // Once in the council and once in the ranked list, and not in the headline too.
  expect(page.split(reason).length - 1).toBe(2);
  // The yearly dollars are the yearly hours at the rate each opportunity uses.
  const { burden } = snapshot.opportunities[0];
  const rate = burden.attention_dollars_month / burden.human_hours_month;
  expect(snapshot.roi.dollars_per_year).toBe(snapshot.roi.hours_per_year * rate);
  expect(page).toContain(`At the sample's $${rate} an hour`);
  // What happened is a saving, like the forecast beside it and the headline.
  expect(page).toContain(`${snapshot.roi.forecast?.observed_hours}h saved`);
  expect(page).not.toMatch(/\dh spent/);
});

test('the failing check is as old in its panel as it is on the trail', () => {
  const failing = demoTreeGraph().items.find(isFailing)!;
  const onTrail = demoAudit().events.find(e => e.action === 'failed' && e.target === failing.id)!;
  const inPanel = toUtcEpoch(String(failing.meta?.lastChecked))!;
  // The graph stamps whole seconds, and the trail is dated a moment later.
  expect(Math.abs(Date.parse(onTrail.at) - inPanel)).toBeLessThan(5000);
  // Every other check keeps its distance, and none is dated after now.
  for (const item of demoTreeGraph().items) {
    const at = toUtcEpoch(item.meta?.lastChecked as string | undefined);
    if (at !== undefined) expect(at).toBeLessThanOrEqual(inPanel);
  }
});
