/** Run Vite and the API as one dev stack, optionally against a disposable graph. */
import { delimiter, dirname } from 'node:path';
import concurrently from 'concurrently';
import { ROOT, seedFixtureGraph } from './lib/fixture.ts';

const useFixture = process.argv.includes('--fixture');
const webPort = process.env.AMBIT_WEB_PORT || (useFixture ? '3100' : '3000');
const apiPort = process.env.AMBIT_API_PORT || (useFixture ? '3101' : '3001');
for (const port of [webPort, apiPort]) {
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error(`Invalid dev port: ${port}`);
  }
}
if (Number(webPort) === Number(apiPort)) throw new Error('The dev stack needs two distinct ports');

const ports = { AMBIT_WEB_PORT: webPort, AMBIT_API_PORT: apiPort };
let env: NodeJS.ProcessEnv = ports;
if (useFixture) {
  const fixture = seedFixtureGraph('ambit-dev-fixture', {
    ...ports,
    PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
  });
  process.once('exit', fixture.cleanup);
  // concurrently merges these overrides with the parent environment. Drop
  // inherited config paths, tokens and other overrides from the fixture.
  env = {
    ...Object.fromEntries(Object.keys(process.env).map(key => [key, undefined])),
    ...fixture.env,
    // Prevent the Environment view from falling back to the machine's socket.
    DOCKER_HOST: `unix://${fixture.work}/no-docker.sock`,
  };
  console.log(`Fixture: http://localhost:${webPort}/ambit/ (API on 127.0.0.1:${apiPort})`);
}

const { result } = concurrently(
  [
    { command: 'npm run server', name: 'api', prefixColor: 'cyan', env },
    { command: 'vite', name: 'web', prefixColor: 'magenta', env },
  ],
  { cwd: ROOT, prefix: 'name', killOthersOn: ['failure'] }
);
try {
  await result;
} catch {
  process.exitCode = 1;
}
