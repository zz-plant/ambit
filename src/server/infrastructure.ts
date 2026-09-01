/**
 * The device and service topology the client draws alongside the capability
 * graph, probed from a manifest the user supplies.
 *
 * The manifest path comes from INFRA_MANIFEST (default
 * ~/.config/opencode/infrastructure.json), so no host addresses are baked in.
 * With no manifest the scan is empty rather than an error.
 */
import { existsSync, readFileSync } from 'node:fs';
import { readConfig, INFRA_MANIFEST_PATH } from './config.ts';
import type {
  InfrastructureNode as InfraNode,
  InfrastructureLink as InfraLink,
  InfrastructureFinding as InfraFinding,
  InfraHealth,
} from '../shared/types.ts';

async function probe(
  url: string,
  timeoutMs = 3000
): Promise<{ ok: boolean; status?: number; json?: any; error?: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { text: text.slice(0, 500) };
    }
    return { ok: res.ok, status: res.status, json };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'fetch failed' };
  }
}

export interface InfraManifest {
  /** Hosts that run services. */
  devices?: {
    id: string;
    name: string;
    description?: string;
    statusUrl?: string;
    meta?: Record<string, unknown>;
  }[];
  /** Services expected on those hosts. */
  services?: {
    key: string;
    label?: string;
    host?: string;
    url?: string;
    expectedMcp?: string;
    description?: string;
  }[];
  links?: InfraLink[];
}

function readManifest(): InfraManifest | null {
  if (!existsSync(INFRA_MANIFEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(INFRA_MANIFEST_PATH, 'utf8')) as InfraManifest;
  } catch {
    return null;
  }
}

/**
 * Probes the hosts and services described by the infrastructure manifest and
 * returns a topology the client can render alongside the capability graph.
 *
 * The manifest path comes from INFRA_MANIFEST (default
 * ~/.config/opencode/infrastructure.json), so no host addresses are baked in.
 * With no manifest the scan is empty rather than an error — the graph simply
 * shows no infrastructure layer.
 */
export async function buildInfrastructureScan(): Promise<{
  generatedAt: string;
  source: string;
  nodes: InfraNode[];
  links: InfraLink[];
  findings: InfraFinding[];
  summary: { online: number; degraded: number; offline: number; unknown: number };
}> {
  const generatedAt = new Date().toISOString();
  const manifest = readManifest();
  const nodes: InfraNode[] = [];
  const links: InfraLink[] = [...(manifest?.links || [])];
  const findings: InfraFinding[] = [];

  if (!manifest) {
    findings.push({
      severity: 'info',
      message: `No infrastructure manifest at ${INFRA_MANIFEST_PATH}. Create one (or set INFRA_MANIFEST) to map devices and services into the graph.`,
    });
    return {
      generatedAt,
      source: INFRA_MANIFEST_PATH,
      nodes,
      links,
      findings,
      summary: { online: 0, degraded: 0, offline: 0, unknown: 0 },
    };
  }

  const rawConfig = await readConfig();
  const mcpConfig = (rawConfig?.mcp as Record<string, any>) || {};
  const enabledMcps = new Set(
    Object.entries(mcpConfig)
      .filter(([, value]) => value && value.enabled !== false)
      .map(([key]) => key)
  );

  // Probe every device that exposes a status URL, in parallel.
  const deviceProbes = await Promise.all(
    (manifest.devices || []).map(async device => ({
      device,
      result: device.statusUrl ? await probe(device.statusUrl) : null,
    }))
  );

  // A device's status payload doubles as a service health map, so keep it.
  const serviceHealthFromDevice = new Map<string, any>();

  for (const { device, result } of deviceProbes) {
    const status: InfraHealth = !device.statusUrl ? 'unknown' : result?.ok ? 'online' : 'offline';
    if (result?.json) serviceHealthFromDevice.set(device.id, result.json);
    nodes.push({
      id: device.id,
      name: device.name,
      kind: 'device',
      status,
      description: device.description || `Host ${device.name}`,
      meta: { ...device.meta, statusUrl: device.statusUrl, statusCode: result?.status },
    });
    if (device.statusUrl && !result?.ok) {
      findings.push({
        severity: 'error',
        message: `${device.name} status endpoint unreachable: ${result?.error || result?.status}`,
        relatedIds: [device.id],
      });
    }
  }

  for (const spec of manifest.services || []) {
    const id = `svc:${spec.key}`;
    const hostPayload = spec.host ? serviceHealthFromDevice.get(spec.host) : undefined;
    const reported = hostPayload?.[spec.key];

    let health: InfraHealth = 'unknown';
    if (spec.url) {
      const res = await probe(spec.url);
      health = res.ok ? 'online' : 'offline';
    } else if (reported === true) {
      health = 'online';
    } else if (reported === false) {
      health = 'offline';
    }

    const mcpEnabled = spec.expectedMcp ? enabledMcps.has(spec.expectedMcp) : undefined;
    nodes.push({
      id,
      name: spec.label || spec.key,
      kind: 'service',
      status: health,
      description: spec.description || `Service ${spec.key}`,
      meta: { host: spec.host, url: spec.url, expectedMcp: spec.expectedMcp, mcpEnabled },
    });

    if (spec.host) links.push({ from: spec.host, to: id, type: 'runs' });
    if (spec.expectedMcp && mcpEnabled) {
      links.push({ from: `mcp:${spec.expectedMcp}`, to: id, type: 'controls' });
    }

    // The point of the scan: config expects a service that isn't actually up.
    if (mcpEnabled && health === 'offline') {
      findings.push({
        severity: 'warn',
        message: `MCP "${spec.expectedMcp}" is enabled but ${spec.label || spec.key} is not reachable.`,
        relatedIds: [id, `mcp:${spec.expectedMcp}`],
      });
    }
  }

  const summary = nodes.reduce(
    (acc, node) => {
      acc[node.status] += 1;
      return acc;
    },
    { online: 0, degraded: 0, offline: 0, unknown: 0 }
  );

  return {
    generatedAt,
    source: INFRA_MANIFEST_PATH,
    nodes,
    links,
    findings,
    summary,
  };
}

/**
 * Only local dev origins may talk to this server.
 *
 * Reflecting the caller's Origin (the previous behaviour) let any website the
 * user visited read /api/config and POST to /api/config/apply, because the
 * browser would honour the reflected header. Since /api/config/apply can add an
 * MCP server — an arbitrary command OpenCode later runs — that was a path from
 * "visit a page" to "code runs on this machine".
 */
/**
 * SSE subscribers of /api/events. The graph is polled; work is pushed. Every
 * /api/telemetry observation is broadcast to the open connections so the AG-UI
 * stream narrates real work as it happens, not only graph changes.
 */
