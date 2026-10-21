/**
 * The key says what an entry means where a touch screen can read it. It was a
 * `title` only, which no finger ever shows: focused, pressed or pointed at, an
 * entry's meaning takes the key's last line, and at rest that line is the one
 * it always was.
 */
import type { PointerEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { findAll } from '../../testing/elements';
import { MapKeyView } from './MapKey';
import type { LegendKey } from './marks';

const keys: LegendKey[] = [
  { kind: 'label', label: 'State' },
  { kind: 'node', label: 'Reached', color: 'var(--node-reached)', hint: 'Set up, and working.' },
  { kind: 'line', label: 'Required', hint: 'Gates what it points at.' },
];

function view(explained: string | null, onExplain: (label: string | null) => void = () => {}) {
  return MapKeyView({
    keys,
    spotlight: null,
    lights: label => label === 'Reached',
    onSpotlight: () => {},
    concepts: {},
    hazard: 'url(#h)',
    explained,
    onExplain,
  });
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const pointer = (pointerType: string) => ({ pointerType }) as PointerEvent;

test('at rest it says how to use it, and no entry carries a tooltip', () => {
  const html = renderToStaticMarkup(view(null));
  expect(text(html)).toContain('Press a key to light its nodes.');
  expect(html).not.toContain('title=');
  expect(html).not.toContain('civ-key-said');
});

test('an entry explained says its meaning over the line at rest', () => {
  const html = renderToStaticMarkup(view('Required'));
  expect(html).toContain('class="civ-key-hint is-saying"');
  expect(html).toMatch(/id="civ-key-said"[^>]*>Gates what it points at\.</);
});

test('a focus, a press or a mouse explains an entry; only a mouse or a blur takes it back', () => {
  const said: (string | null)[] = [];
  const rows = findAll(
    view(null, label => said.push(label)),
    el => String(el.props.className ?? '').startsWith('civ-key-row')
  );
  expect(rows).toHaveLength(2);
  const [button, span] = rows;
  button.props.onFocus();
  span.props.onPointerDown(pointer('touch'));
  // A finger leaves after it lifts: the line stays.
  span.props.onPointerLeave(pointer('touch'));
  span.props.onPointerEnter(pointer('touch'));
  span.props.onPointerEnter(pointer('mouse'));
  span.props.onPointerLeave(pointer('mouse'));
  button.props.onBlur();
  expect(said).toEqual(['Reached', 'Required', 'Required', null, null]);
});
