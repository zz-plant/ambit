/**
 * Live containers off the Docker socket (roadmap §2).
 *
 * A fake engine listens on a unix socket in a temp directory and answers
 * `GET /containers/json`, so the tests cover the request, the mapping of
 * container state to the scan's health vocabulary, and the two absences: no
 * socket (quiet) and a socket that refuses (a finding).
 */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DOCKER_ENGINE_ID, dockerScan, dockerSocketPath } from './docker.ts';

const dir = mkdtempSync(join(tmpdir(), 'ambit-docker-'));
const socketPath = join(dir, 'docker.sock');
const brokenPath = join(dir, 'broken.sock');

const CONTAINERS = [
  {
    Id: 'abcdef0123456789',
    Names: ['/homelab-postgres-1'],
    Image: 'postgres:16',
    State: 'running',
    Status: 'Up 3 days',
    Labels: { 'com.docker.compose.project': 'homelab' },
    Ports: [{ IP: '0.0.0.0', PrivatePort: 5432, PublicPort: 5432, Type: 'tcp' }],
  },
  {
    Id: '0123456789abcdef',
    Names: ['/ollama'],
    Image: 'ollama/ollama',
    State: 'exited',
    Status: 'Exited (0) 2 hours ago',
    Ports: [],
  },
  {
    Id: 'fedcba9876543210',
    Names: ['/paused-thing'],
    Image: 'busybox',
    State: 'paused',
    Status: 'Up 1 hour (Paused)',
  },
];

let engine: Server;
let broken: Server;

beforeAll(async () => {
  engine = createServer((req, res) => {
    if (req.url?.startsWith('/containers/json')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(CONTAINERS));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  broken = createServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('engine on fire');
  });
  await new Promise<void>(r => engine.listen(socketPath, r));
  await new Promise<void>(r => broken.listen(brokenPath, r));
});

afterAll(async () => {
  await new Promise<void>(r => engine.close(() => r()));
  await new Promise<void>(r => broken.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

test('DOCKER_HOST=unix:// names the socket; anything else is not probed', () => {
  expect(dockerSocketPath({ DOCKER_HOST: `unix://${socketPath}` })).toBe(socketPath);
  expect(dockerSocketPath({ DOCKER_HOST: 'unix:///nowhere/docker.sock' })).toBeNull();
  expect(dockerSocketPath({ DOCKER_HOST: 'tcp://10.0.0.2:2375' })).toBeNull();
  // A HOME with none of the per-user sockets, and no daemon default here.
  const found = dockerSocketPath({ HOME: dir });
  expect(found === null || found === '/var/run/docker.sock').toBe(true);
});

test('containers become service nodes on an engine device', async () => {
  const scan = await dockerScan({ socketPath });
  expect(scan.socket).toBe(socketPath);
  expect(scan.findings).toEqual([]);

  const engineNode = scan.nodes.find(n => n.id === DOCKER_ENGINE_ID)!;
  expect(engineNode.kind).toBe('device');
  expect(engineNode.status).toBe('online');
  expect(engineNode.meta).toMatchObject({ containers: 3, running: 1 });

  const byId = Object.fromEntries(scan.nodes.map(n => [n.id, n]));
  expect(byId['svc:docker/homelab-postgres-1']).toMatchObject({
    kind: 'service',
    status: 'online',
    meta: { image: 'postgres:16', compose: 'homelab', ports: ['5432→5432/tcp'], source: 'docker' },
  });
  expect(byId['svc:docker/ollama'].status).toBe('offline');
  expect(byId['svc:docker/paused-thing'].status).toBe('degraded');

  // Every container runs on the engine.
  expect(scan.links).toEqual(
    expect.arrayContaining([
      { from: DOCKER_ENGINE_ID, to: 'svc:docker/homelab-postgres-1', type: 'runs' },
      { from: DOCKER_ENGINE_ID, to: 'svc:docker/ollama', type: 'runs' },
    ])
  );
  expect(scan.links).toHaveLength(3);
});

test('no socket is a quiet absence, not a finding', async () => {
  const scan = await dockerScan({ socketPath: null });
  expect(scan).toEqual({ socket: null, nodes: [], links: [], findings: [] });
});

test('a socket that refuses is an offline engine with a finding', async () => {
  const scan = await dockerScan({ socketPath: brokenPath });
  expect(scan.nodes).toHaveLength(1);
  expect(scan.nodes[0]).toMatchObject({ id: DOCKER_ENGINE_ID, status: 'offline' });
  expect(scan.findings[0].severity).toBe('error');
  expect(scan.findings[0].message).toContain('HTTP 500');
});

test('a socket nobody listens on is a stopped engine, not an error', async () => {
  const scan = await dockerScan({ socketPath: join(dir, 'missing.sock') });
  expect(scan.nodes[0]).toMatchObject({ id: DOCKER_ENGINE_ID, status: 'offline' });
  expect(scan.findings[0].severity).toBe('warn');
  expect(scan.findings[0].message).toMatch(/not running/);
});
