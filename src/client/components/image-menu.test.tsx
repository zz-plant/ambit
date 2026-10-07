/**
 * The map's Image button: the card that was all it saved, and the whole map
 * beside it, as a vector and as a PNG. It follows the card's rule about the
 * past: a map scrubbed back to an observation offers no image at all.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test } from 'vitest';
import { useAmbitStore } from '../store/ambitStore';
import { demoTreeGraph } from '../store/demo';
import CivTree from './CivTree';
import { IMAGE_CHOICES, ImageMenu } from './civ/ImageMenu';

function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

afterEach(() => seed({ items: [], connections: [] }));

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('it offers the card, and the whole map as SVG and as PNG', () => {
  expect(IMAGE_CHOICES.map(([kind]) => kind)).toEqual(['card', 'svg', 'png']);
  const html = renderToStaticMarkup(<ImageMenu onSave={() => {}} onClose={() => {}} />);
  const said = text(html);
  expect(said).toContain('The finding, to post PNG');
  expect(said).toContain('The whole map SVG');
  expect(said).toContain('The whole map PNG, 2×');
  expect(html.match(/<button type="button"/g)?.length).toBe(3);
});

const { items, connections } = demoTreeGraph();
const map = (extra: Partial<Parameters<typeof CivTree>[0]> = {}) =>
  renderToStaticMarkup(
    <CivTree
      items={items}
      connections={connections}
      selectedId={null}
      hoveredId={null}
      onSelect={() => {}}
      onHover={() => {}}
      {...extra}
    />
  );

test('the Image button opens the choices, and is absent in the past as the card always was', () => {
  seed({ items, connections });
  const today = map({ onSaveImage: () => {} });
  expect(today).toMatch(/aria-expanded="false" data-image-toggle="true"[^>]*>Image</);
  expect(map({ onSaveImage: () => {}, asOf: '2026-09-01T00:00:00Z' })).not.toContain(
    'data-image-toggle'
  );
  expect(map()).not.toContain('data-image-toggle');
});
