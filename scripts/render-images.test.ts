import { join } from 'node:path';
import { expect, test } from 'vitest';
import { servedDir } from './render-images.ts';

test('the images never land where the API server or Vite serves them', () => {
  const root = '/repo';
  expect(servedDir(join(root, 'dist'), root)).toBe('dist');
  expect(servedDir(join(root, 'dist', 'assets'), root)).toBe('dist');
  expect(servedDir(join(root, 'src', 'client', 'public'), root)).toBe('src');
  expect(servedDir(join(root, 'output', 'images'), root)).toBeNull();
  expect(servedDir(join(root, 'distant'), root)).toBeNull();
  expect(servedDir(join(root, 'dist', '..images'), root)).toBe('dist');
  expect(servedDir('/tmp/images', root)).toBeNull();
});
