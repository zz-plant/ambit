import { expect, test } from 'vitest';
import { contactSheet, parseShotArgs, selectShots, SHOTS, SIZES } from './shots.ts';

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

test('a running site can be checked at one size without building or taking offline shots', () => {
  const options = parseShotArgs([
    '--url',
    'https://zz-plant.github.io/ambit/',
    '--size=phone',
    '--strict',
  ]);
  expect(options).toMatchObject({
    origin: 'https://zz-plant.github.io',
    size: 'phone',
    strict: true,
  });
  const shots = selectShots(options);
  expect(shots.map(s => s.name)).toContain('map-rest');
  expect(shots.every(s => !s.live && !s.offline && s.sizes.includes('phone'))).toBe(true);
});

test('the sheet reports navigation failures without linking to a missing PNG', () => {
  const html = contactSheet([
    { name: 'map-rest', size: 'phone', file: null, found: ['net::ERR_CONNECTION_REFUSED'] },
  ]);
  expect(html).toContain('net::ERR_CONNECTION_REFUSED');
  expect(html).not.toContain('<img');
});

test('bad shot names, incompatible sizes and ambiguous URLs fail before starting Chrome', () => {
  expect(() => selectShots(parseShotArgs(['--only', 'map-rets']))).toThrow('map-rets');
  expect(() => selectShots(parseShotArgs(['--only', 'map-selected', '--size', 'wide']))).toThrow(
    'wide'
  );
  expect(() =>
    selectShots(parseShotArgs(['--url', 'http://localhost:3000', '--only', 'welcome']))
  ).toThrow('welcome');
  expect(() => parseShotArgs(['--url', 'https://zz-plant.github.io/ambit/?demo=1'])).toThrow(
    '--url'
  );
  expect(() => parseShotArgs(['--url', 'http://localhost:3000', '--home', '/tmp/fixture'])).toThrow(
    '--home'
  );
});
