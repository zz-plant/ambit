import { createServer as createHttpServer } from 'node:http';
import { resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { expect, test, vi } from 'vitest';

test('Vite waits for the dev API to report ready before opening the page', async () => {
  const probe = Promise.withResolvers<void>();
  let ready = false;
  const api = createHttpServer((request, response) => {
    if (request.url !== '/api/health') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: ready ? 'ok' : 'starting' }));
    probe.resolve();
  });
  await new Promise<void>(done => api.listen(0, '127.0.0.1', done));
  const address = api.address();
  if (!address || typeof address === 'string') throw new Error('No API test port');
  vi.stubEnv('AMBIT_API_PORT', String(address.port));
  vi.stubEnv('AMBIT_DEV_WAIT_FOR_API', '1');
  const web = createViteServer({
    configFile: resolve('vite.config.ts'),
    optimizeDeps: { noDiscovery: true },
    server: { watch: null, ws: false },
  });
  try {
    const first = await Promise.race([probe.promise.then(() => 'api'), web.then(() => 'vite')]);
    expect(first).toBe('api');
    ready = true;
    await web;
  } finally {
    ready = true;
    await web.then(
      server => server.close(),
      () => {}
    );
    api.close();
    vi.unstubAllEnvs();
  }
});
