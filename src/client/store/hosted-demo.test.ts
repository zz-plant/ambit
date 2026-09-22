/**
 * Which hosts skip the engine probe. Only GitHub Pages: a Codespace serves the
 * map from *.app.github.dev with a real engine behind its proxy, and a local
 * checkout serves it from loopback.
 */
import { expect, test } from 'vitest';
import { isHostedDemo } from './ambitStore';

test('GitHub Pages is the hosted demo, and nothing else is', () => {
  expect(isHostedDemo('zz-plant.github.io')).toBe(true);
  expect(isHostedDemo('localhost')).toBe(false);
  expect(isHostedDemo('127.0.0.1')).toBe(false);
  expect(isHostedDemo('ambit-3000.app.github.dev')).toBe(false);
  expect(isHostedDemo('zz-plant.github.io.example.com')).toBe(false);
});
