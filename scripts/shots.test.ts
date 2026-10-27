import { expect, test } from 'vitest';
import { contactSheet, SHOTS, SIZES } from './shots.ts';

test('every shot is named once, is a page under the base, and is taken at a size there is', () => {
  const names = SHOTS.map(s => s.name);
  expect(new Set(names).size).toBe(names.length);
  for (const shot of SHOTS) {
    expect(shot.path.startsWith('/ambit/')).toBe(true);
    for (const size of shot.sizes) expect(Object.keys(SIZES)).toContain(size);
  }
});

test('the sheet marks a shot a check flagged, and says what it found', () => {
  const html = contactSheet([
    { name: 'map-rest', size: 'desk', file: 'map-rest--desk.png', found: [] },
    {
      name: 'map-rest',
      size: 'wide',
      file: 'map-rest--wide.png',
      found: ['the status pill wraps onto a second line'],
    },
  ]);
  expect(html).toContain('<figure class="desk"><img src="map-rest--desk.png"');
  expect(html).toContain('<figure class="wide flagged">');
  expect(html).toContain('<b>the status pill wraps onto a second line</b>');
});
