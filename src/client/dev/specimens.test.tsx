/**
 * The specimen page shows each state the map draws, through the map's own
 * renderer. These hold that every specimen is the state its title names, by
 * the same predicates the map draws with, and that the page draws it.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import {
  eurekaOf,
  isFailing,
  isNext,
  isProven,
  isRecovering,
  outageRole,
  recentFailures,
} from '../components/civ/layout';
import { SPECIMENS, simulationOf } from './specimens';
import { SpecimenNode, SpecimenPage } from './SpecimenPage';

const named = (title: string) => SPECIMENS.find(s => s.title === title)!;
const drawn = (title: string, still = true) =>
  renderToStaticMarkup(<SpecimenNode s={named(title)} still={still} scale={3} />);

test('each specimen has a title of its own and is drawn at the asked size', () => {
  expect(new Set(SPECIMENS.map(s => s.title)).size).toBe(SPECIMENS.length);
  expect(new Set(SPECIMENS.map(s => s.item.id)).size).toBe(SPECIMENS.length);
  const svg = drawn('Reached, never checked');
  expect(svg).toMatch(/^<svg width="420" height="300"/);
  expect(svg).toContain('<circle r="22"');
});

test('the states are the ones the map tests for', () => {
  expect(isProven(named('Proven: its check passed').item)).toBe(true);
  expect(isFailing(named('Failing: its last check failed').item)).toBe(true);
  expect(isNext(named('Next step, with its setup time').item)).toBe(true);
  expect(isNext(named('Blocked').item)).toBe(false);
  expect([1, 2, 3].map(n => eurekaOf(named(`Next step, asked for ${n} of 3`).item))).toEqual([
    1 / 3,
    2 / 3,
    1,
  ]);
});

test('the four recovering specimens are the waver four steps, each drawn', () => {
  for (const failed of [1, 2, 3, 4]) {
    const title = `Recovering, ${failed} of the last 5 failed`;
    const { item } = named(title);
    expect(isRecovering(item)).toBe(true);
    expect(recentFailures(item)).toBe(failed);
    expect(drawn(title)).toContain(`url(#specimen-waver-${failed}-`);
  }
});

test('every outage role has a specimen, and the map calls it that role', () => {
  const roles = SPECIMENS.filter(s => s.role);
  expect(roles.map(s => s.role).sort()).toEqual(['cut off', 'down', 'loses a provider', 'stops']);
  for (const s of roles) expect(outageRole(s.item, simulationOf(s))).toBe(s.role);
  expect(drawn('Outage: down, and what it stops')).toContain('DOWN · STOPS 3');
  expect(drawn('Outage: stops working')).toContain('url(#specimen-corrode-');
  // A node that was failing before the outage keeps its stripes and corrodes nothing.
  const failing = drawn('Outage: already failing, keeps its stripes');
  expect(failing).toContain('url(#specimen-hazard)');
  expect(failing).not.toContain('-corrode-');
});

test('the page draws as the page does, or as a saved file does', () => {
  // The page's drawing is a control; a still has nothing in it to press.
  expect(drawn('Selected', false)).toContain('role="button"');
  expect(drawn('Selected')).not.toContain('role="button"');
  const page = renderToStaticMarkup(<SpecimenPage />);
  expect(page.match(/class="specimen-card"/g)).toHaveLength(SPECIMENS.length);
  expect(page).toContain('id="specimen-waver-4-2"');
});
