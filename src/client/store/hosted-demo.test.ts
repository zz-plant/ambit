/**
 * Which hosts skip the engine probe: the two that serve static files, and the
 * origin a build was published under.
 */
import { expect, test } from 'vitest';
import { builtHost, isHostedDemo } from './ambitStore';

test('the static hosts are the hosted demo, and a machine with an engine is not', () => {
  expect(isHostedDemo('zz-plant.github.io')).toBe(true);
  expect(isHostedDemo('ambit-web.example.workers.dev')).toBe(true);
  expect(isHostedDemo('localhost')).toBe(false);
  expect(isHostedDemo('127.0.0.1')).toBe(false);
  expect(isHostedDemo('ambit-3000.app.github.dev')).toBe(false);
  expect(isHostedDemo('zz-plant.github.io.example.com')).toBe(false);
  expect(isHostedDemo('ambit-web.example.workers.dev.example.com')).toBe(false);
});

test('a custom domain is static when the build names it, and only then', () => {
  expect(isHostedDemo('ambit.kanav.net', 'ambit.kanav.net')).toBe(true);
  expect(isHostedDemo('localhost', 'ambit.kanav.net')).toBe(false);
  expect(isHostedDemo('ambit.kanav.net.example.com', 'ambit.kanav.net')).toBe(false);
  // A build that names no host, which is what a test without a document sees.
  expect(isHostedDemo('ambit.kanav.net', '')).toBe(false);
});

test('the published host is read from the meta tag the build writes', () => {
  const globals = globalThis as { document?: unknown };
  const before = globals.document;
  const meta = (content: string | null) => ({
    querySelector: (selector: string) =>
      selector === 'meta[name="ambit-site-origin"]'
        ? { getAttribute: (name: string) => (name === 'content' ? content : null) }
        : null,
  });
  try {
    globals.document = meta('https://ambit.kanav.net');
    expect(builtHost()).toBe('ambit.kanav.net');
    globals.document = meta(null);
    expect(builtHost()).toBe('');
    globals.document = meta('');
    expect(builtHost()).toBe('');
  } finally {
    if (before === undefined) delete globals.document;
    else globals.document = before;
  }
});
