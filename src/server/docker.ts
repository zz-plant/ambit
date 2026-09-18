/**
 * Live containers, read off the local Docker socket (roadmap §2).
 *
 * The manifest says what a machine is supposed to run; the socket says what it
 * is running now. One GET over the unix socket lists every container, and each
 * becomes a service node the client can draw beside the manifest's, with the
 * engine itself as the device they run on.
 *
 * Read-only by construction: the only request is `GET /containers/json`, and
 * nothing here can start, stop or create anything. No socket is a quiet
 * absence — most machines have no Docker, and a finding about that would be
 * noise — while a socket that refuses is worth a finding, since something is
 * installed and not answering.
 */
import { existsSync } from 'node:fs';
import { request } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  InfrastructureNode as InfraNode,
  InfrastructureLink as InfraLink,
  InfrastructureFinding as InfraFinding,
  InfraHealth,
} from '../shared/types.ts';

/** The engine node every container links to. */
export const DOCKER_ENGINE_ID = 'device:docker';

/**
 * Where the engine listens.
 *
 * `DOCKER_HOST=unix://…` is the contract every Docker client honours, so it
 * wins. Otherwise the daemon's default, then the per-user sockets the desktop
 * runtimes (Docker Desktop, OrbStack, Colima, Rancher Desktop) create on macOS
 * and rootless Linux. A TCP `DOCKER_HOST` is not probed: reaching across the
 * network to enumerate containers is a different decision from reading a local
 * socket.
 */
export function dockerSocketPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const host = env.DOCKER_HOST;
  if (host) {
    if (host.startsWith('unix://')) {
      const path = host.slice('unix://'.length);
      return existsSync(path) ? path : null;
    }
    return null;
  }
  const home = env.HOME || homedir();
  const candidates = [
    '/var/run/docker.sock',
    join(home, '.docker', 'run', 'docker.sock'),
    join(home, '.orbstack', 'run', 'docker.sock'),
    join(home, '.colima', 'default', 'docker.sock'),
    join(home, '.colima', 'docker.sock'),
    join(home, '.rd', 'docker.sock'),
    env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, 'docker.sock') : '',
  ].filter(Boolean);
  return candidates.find(p => existsSync(p)) || null;
}

/** The fields of `GET /containers/json` this reads. */
export interface DockerContainer {
  Id: string;
  Names?: string[];
  Image?: string;
  State?: string;
  Status?: string;
  Labels?: Record<string, string>;
  Ports?: { IP?: string; PrivatePort?: number; PublicPort?: number; Type?: string }[];
}

/** One GET over the socket, with a deadline. */
export function dockerGet(
  socketPath: string,
  path: string,
  timeoutMs = 2000
): Promise<{ ok: boolean; status?: number; json?: any; error?: string }> {
  return new Promise(resolve => {
    const req = request(
      { socketPath, path, method: 'GET', headers: { Host: 'docker' }, timeout: timeoutMs },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          let json: any = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch {
            json = { text: body.slice(0, 500) };
          }
          const status = res.statusCode || 0;
          resolve({ ok: status >= 200 && status < 300, status, json });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(`no answer in ${timeoutMs}ms`)));
    req.on('error', error => resolve({ ok: false, error: error?.message || 'request failed' }));
    req.end();
  });
}

/** A container's health, in the vocabulary the rest of the scan uses. */
function healthOf(state?: string): InfraHealth {
  switch ((state || '').toLowerCase()) {
    case 'running':
      return 'online';
    case 'paused':
    case 'restarting':
    case 'removing':
      return 'degraded';
    case 'exited':
    case 'dead':
    case 'created':
      return 'offline';
    default:
      return 'unknown';
  }
}

/** `/foo` → `foo`; compose gives `/project-web-1`, which is kept whole. */
function nameOf(container: DockerContainer): string {
  const raw = container.Names?.[0] || container.Id.slice(0, 12);
  return raw.replace(/^\//, '');
}

export interface DockerScan {
  socket: string | null;
  nodes: InfraNode[];
  links: InfraLink[];
  findings: InfraFinding[];
}

/**
 * Every container the engine knows, as service nodes on an engine device.
 *
 * Stopped containers are included and shown offline: a container that exists
 * and is not running is exactly the kind of thing the person set up once and
 * expects to be there, which is what the manifest scan reports for services.
 */
export async function dockerScan(
  options: { socketPath?: string | null; timeoutMs?: number } = {}
): Promise<DockerScan> {
  const socket = options.socketPath === undefined ? dockerSocketPath() : options.socketPath;
  const nodes: InfraNode[] = [];
  const links: InfraLink[] = [];
  const findings: InfraFinding[] = [];
  if (!socket) return { socket: null, nodes, links, findings };

  const res = await dockerGet(socket, '/containers/json?all=1', options.timeoutMs);
  if (!res.ok || !Array.isArray(res.json)) {
    nodes.push({
      id: DOCKER_ENGINE_ID,
      name: 'Docker engine',
      kind: 'device',
      status: 'offline',
      description: `Docker socket at ${socket}`,
      meta: { socket, error: res.error || res.status },
    });
    // A socket file with nothing behind it is a stopped engine (Colima and
    // Docker Desktop leave theirs in place), which is worth saying and not
    // worth alarming about. An engine that answers and errors is.
    const stopped = /ECONNREFUSED|ENOENT/.test(res.error || '');
    findings.push({
      severity: stopped ? 'warn' : 'error',
      message: stopped
        ? `Docker socket at ${socket} exists but the engine is not running.`
        : `Docker socket at ${socket} did not answer: ${res.error || `HTTP ${res.status}`}`,
      relatedIds: [DOCKER_ENGINE_ID],
    });
    return { socket, nodes, links, findings };
  }

  const containers = res.json as DockerContainer[];
  nodes.push({
    id: DOCKER_ENGINE_ID,
    name: 'Docker engine',
    kind: 'device',
    status: 'online',
    description: `Docker socket at ${socket}`,
    meta: {
      socket,
      containers: containers.length,
      running: containers.filter(c => healthOf(c.State) === 'online').length,
    },
  });

  for (const container of containers) {
    const name = nameOf(container);
    const id = `svc:docker/${name}`;
    const status = healthOf(container.State);
    const ports = (container.Ports || [])
      .filter(p => p.PublicPort)
      .map(p => `${p.PublicPort}→${p.PrivatePort}/${p.Type || 'tcp'}`);
    const compose = container.Labels?.['com.docker.compose.project'];
    nodes.push({
      id,
      name,
      kind: 'service',
      status,
      description: container.Image ? `Container ${name} (${container.Image})` : `Container ${name}`,
      meta: {
        container: container.Id.slice(0, 12),
        image: container.Image,
        state: container.State,
        status: container.Status,
        ports: ports.length ? ports : undefined,
        compose,
        source: 'docker',
      },
    });
    links.push({ from: DOCKER_ENGINE_ID, to: id, type: 'runs' });
  }

  return { socket, nodes, links, findings };
}
