import { Database } from 'bun:sqlite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DB_PATH = Bun.env.HOME + '/.config/opencode/toolchain-viz.db';
const CONFIG_PATH = Bun.env.HOME + '/.config/opencode/opencode.json';
const REPO_PATH = Bun.env.REPO_PATH || Bun.env.HOME + '/Documents/GitHub';
const INFRA_MANIFEST_PATH = Bun.env.INFRA_MANIFEST || Bun.env.HOME + '/.config/opencode/infrastructure.json';
const API_PORT = 3001;

type InfraHealth = 'online' | 'degraded' | 'offline' | 'unknown';

interface InfraNode {
  id: string;
  name: string;
  kind: 'device' | 'service' | 'api' | 'network' | 'workflow';
  status: InfraHealth;
  description: string;
  meta?: Record<string, unknown>;
}

interface InfraLink {
  from: string;
  to: string;
  type: string;
}

interface InfraFinding {
  severity: 'info' | 'warn' | 'error';
  message: string;
  relatedIds?: string[];
}

function initDb(): Database {
  const db = new Database(DB_PATH, { create: true });
  db.run(`CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    items TEXT NOT NULL,
    connections TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS consultant_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    consultant_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    score INTEGER NOT NULL,
    findings TEXT NOT NULL,
    item_count INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS trends (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT,
    score INTEGER DEFAULT 0,
    category TEXT DEFAULT 'mcp',
    created_at TEXT NOT NULL,
    discovered_at TEXT NOT NULL
  )`);
  return db;
}

async function readConfig(): Promise<Record<string, unknown> | null> {
  try {
    const f = Bun.file(CONFIG_PATH);
    return JSON.parse(await f.text());
  } catch {
    return null;
  }
}

async function writeConfig(data: Record<string, unknown>): Promise<boolean> {
  try {
    await Bun.write(CONFIG_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

interface InfraManifest {
  /** Hosts that run services. */
  devices?: { id: string; name: string; description?: string; statusUrl?: string; meta?: Record<string, unknown> }[];
  /** Services expected on those hosts. */
  services?: { key: string; label?: string; host?: string; url?: string; expectedMcp?: string; description?: string }[];
  links?: InfraLink[];
}

async function probe(url: string, timeoutMs = 3000): Promise<{ ok: boolean; status?: number; json?: any; error?: string }> {
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
async function buildInfrastructureScan(): Promise<{
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
function isAllowedOrigin(origin: string): boolean {
  if (!origin) return true; // same-origin and non-browser clients send no Origin
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function corsHeaders(origin: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

let db: Database;

try {
  db = initDb();
} catch (e) {
  console.error('DB init failed:', e);
  process.exit(1);
}

const server = Bun.serve({
  port: API_PORT,
  // Loopback only. This server reads and writes the OpenCode config, so it must
  // not be reachable from the LAN or over Tailscale.
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    // CORS headers only stop a browser from *reading* a cross-origin response;
    // a simple request is still delivered and executed. Reject it outright so a
    // foreign page cannot rewrite the config it is not allowed to read.
    if (!isAllowedOrigin(origin)) {
      return new Response('Forbidden origin', { status: 403, headers });
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    // GET /api/config — read + parse opencode.json into graph model
    if (url.pathname === '/api/config' && req.method === 'GET') {
      const raw = await readConfig();
      if (!raw) {
        return Response.json({ error: 'Config not found at ' + CONFIG_PATH }, { status: 404, headers });
      }
      return Response.json({ config: raw }, { headers });
    }

    // POST /api/config/apply — write delta back to config
    if (url.pathname === '/api/config/apply' && req.method === 'POST') {
      const body = await req.json() as any;
      const raw = await readConfig() as any;
      if (!raw) {
        return Response.json({ error: 'Config not found' }, { status: 404, headers });
      }
      if (body.disableMcp) {
        for (const name of body.disableMcp) {
          if (raw.mcp?.[name]) raw.mcp[name].enabled = false;
        }
      }
      if (body.enableMcp) {
        for (const name of body.enableMcp) {
          if (raw.mcp?.[name]) raw.mcp[name].enabled = true;
        }
      }
      if (body.addMcp) {
        raw.mcp = { ...(raw.mcp || {}), ...body.addMcp };
      }
      if (body.updateAgent) {
        const { name, updates } = body.updateAgent;
        if (raw.agent && raw.agent[name]) {
          raw.agent[name] = { ...raw.agent[name], ...updates };
        }
      }
      if (body.updateCommand) {
        const { name, updates } = body.updateCommand;
        if (raw.command && raw.command[name]) {
          raw.command[name] = { ...raw.command[name], ...updates };
        }
      }
      const ok = await writeConfig(raw);
      if (!ok) {
        return Response.json({ error: 'Write failed' }, { status: 500, headers });
      }
      return Response.json({ ok: true }, { headers });
    }

    // GET /api/snapshots — list from SQLite
    if (url.pathname === '/api/snapshots' && req.method === 'GET') {
      const rows = db.query('SELECT id, label, timestamp FROM snapshots ORDER BY timestamp DESC').all() as any[];
      return Response.json({ snapshots: rows }, { headers });
    }

    // POST /api/snapshots — create
    if (url.pathname === '/api/snapshots' && req.method === 'POST') {
      const body = await req.json() as any;
      const id = `snap-${Date.now()}`;
      db.run('INSERT INTO snapshots (id, label, timestamp, items, connections) VALUES (?, ?, ?, ?, ?)',
        [id, body.label || `Snapshot ${new Date().toLocaleDateString()}`, new Date().toISOString(), JSON.stringify(body.items), JSON.stringify(body.connections)]);
      return Response.json({ id }, { headers });
    }

    // DELETE /api/snapshots/:id
    if (url.pathname.startsWith('/api/snapshots/') && req.method === 'DELETE') {
      const id = url.pathname.slice('/api/snapshots/'.length);
      db.run('DELETE FROM snapshots WHERE id = ?', [id]);
      return Response.json({ ok: true }, { headers });
    }

    // GET /api/snapshots/:id — restore snapshot data
    if (url.pathname.startsWith('/api/snapshots/') && req.method === 'GET') {
      const id = url.pathname.slice('/api/snapshots/'.length);
      const row = db.query('SELECT * FROM snapshots WHERE id = ?').get(id) as any;
      if (!row) return Response.json({ error: 'Not found' }, { status: 404, headers });
      return Response.json({ snapshot: { ...row, items: JSON.parse(row.items), connections: JSON.parse(row.connections) } }, { headers });
    }

    // GET /api/consultant/history
    if (url.pathname === '/api/consultant/history' && req.method === 'GET') {
      const rows = db.query('SELECT * FROM consultant_log ORDER BY timestamp DESC LIMIT 50').all() as any[];
      return Response.json({ history: rows.map(r => ({ ...r, findings: JSON.parse(r.findings) })) }, { headers });
    }

    // POST /api/consultant/log
    if (url.pathname === '/api/consultant/log' && req.method === 'POST') {
      const body = await req.json() as any;
      db.run('INSERT INTO consultant_log (consultant_id, timestamp, score, findings, item_count) VALUES (?, ?, ?, ?, ?)',
        [body.consultantId, new Date().toISOString(), body.score, JSON.stringify(body.findings), body.itemCount]);
      return Response.json({ ok: true }, { headers });
    }

    // GET /api/infrastructure/scan — read-only device/service topology
    if (url.pathname === '/api/infrastructure/scan' && req.method === 'GET') {
      const scan = await buildInfrastructureScan();
      return Response.json(scan, { headers });
    }

    // GET /api/health — return server status
    if (url.pathname === '/api/health' && req.method === 'GET') {
      const configExists = await Bun.file(CONFIG_PATH).exists();
      const snapshots = db.query('SELECT COUNT(*) as c FROM snapshots').get() as { c: number } | null;
      return Response.json({
        status: 'ok',
        configPath: CONFIG_PATH,
        configExists,
        infraManifestPath: INFRA_MANIFEST_PATH,
        snapshotCount: snapshots?.c || 0,
      }, { headers });
    }

    // GET /api/repos/scan — cross-repo config diff against global
    if (url.pathname === '/api/repos/scan' && req.method === 'GET') {
      const global = await readConfig();
      if (!global) return Response.json({ error: 'Global config required' }, { status: 400, headers });

      // Extract reference sets from global
      const globalMcps = new Set(Object.keys((global.mcp as Record<string, any>) || {}));
      const globalAgents = new Set(Object.keys((global.agent as Record<string, any>) || {}));
      const globalCommands = new Set(Object.keys((global.command as Record<string, any>) || {}));
      const globalProviders = new Set(Object.keys((global.provider as Record<string, any>) || {}));

      const repos: any[] = [];
      if (!existsSync(REPO_PATH)) return Response.json({ repos }, { headers });

      const entries = readdirSync(REPO_PATH, { encoding: 'utf8' });
      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const configFile = `${REPO_PATH}/${entry}/opencode.json`;
        if (!existsSync(configFile)) continue;

        let repoConfig: any;
        try { repoConfig = JSON.parse(await Bun.file(configFile).text()); } catch { continue; }

        const repoMcps = new Set(Object.keys((repoConfig.mcp as Record<string, any>) || {}));
        const repoAgents = new Set(Object.keys((repoConfig.agent as Record<string, any>) || {}));
        const repoCommands = new Set(Object.keys((repoConfig.command as Record<string, any>) || {}));
        const repoProviders = new Set(Object.keys((repoConfig.provider as Record<string, any>) || {}));

        const uniqueMcps = [...repoMcps].filter(k => !globalMcps.has(k));
        const missingMcps = [...globalMcps].filter(k => k !== 'opencode-core' && !repoMcps.has(k));
        const uniqueAgents = [...repoAgents].filter(k => !globalAgents.has(k));
        const uniqueCommands = [...repoCommands].filter(k => !globalCommands.has(k));

        const driftItems = uniqueMcps.length + missingMcps.length + uniqueAgents.length + uniqueCommands.length;
        const totalGlobal = globalMcps.size + globalAgents.size + globalCommands.size + globalProviders.size;
        const driftPct = totalGlobal > 0 ? Math.round((driftItems / totalGlobal) * 100) : 0;

        repos.push({
          name: entry,
          drift: Math.min(100, driftPct),
          driftItems,
          uniqueMcps,
          missingMcps,
          uniqueAgents,
          uniqueCommands,
          defaultAgent: repoConfig.default_agent || null,
        });
      }

      repos.sort((a, b) => b.drift - a.drift);
      return Response.json({
        globalStats: {
          mcps: globalMcps.size,
          agents: globalAgents.size,
          commands: globalCommands.size,
          providers: globalProviders.size,
          totalRepos: repos.length,
        },
        repos,
      }, { headers });
    }

    // GET /api/trending — ecosystem freshness signals from GitHub
    if (url.pathname === '/api/trending' && req.method === 'GET') {
      // Check cache first (1 hour TTL)
      const cached = db.query('SELECT * FROM trends ORDER BY score DESC LIMIT 30').all() as any[];
      if (cached.length > 0) {
        const oldest = cached.reduce((a, b) => a.discovered_at < b.discovered_at ? a : b);
        const age = Date.now() - new Date(oldest.discovered_at).getTime();
        if (age < 3600000) { // 1 hour
          return Response.json({ trends: cached, cached: true }, { headers });
        }
      }

      // Fetch fresh signals from GitHub
      const queries = [
        'mcp-server+created:>2026-04-22&sort=stars',
        'opencode+agent+created:>2026-04-22&sort=stars',
        'modelcontextprotocol+created:>2026-04-22&sort=stars',
        'topic:mcp-server+created:>2026-04-22&sort=stars',
      ];

      const newTrends: any[] = [];
      const seen = new Set<string>();
      const cutoff = new Date(Date.now() - 45 * 24 * 3600000).toISOString().slice(0, 10);

      for (const q of queries) {
        try {
          const res = await fetch(`https://api.github.com/search/repositories?q=${q}&per_page=5`, {
            headers: { 'User-Agent': 'toolchain-viz/0.3', 'Accept': 'application/vnd.github.v3+json' },
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) continue;
          const data = await res.json() as any;
          for (const repo of (data.items || [])) {
            if (seen.has(repo.full_name)) continue;
            seen.add(repo.full_name);
            newTrends.push({
              id: `gh-${repo.id}`,
              source: 'github',
              title: repo.full_name,
              url: repo.html_url,
              description: (repo.description || '').slice(0, 200),
              score: repo.stargazers_count || 0,
              category: repo.full_name.includes('mcp') ? 'mcp' : repo.full_name.includes('agent') ? 'agent' : 'tool',
              created_at: repo.created_at || cutoff,
              discovered_at: new Date().toISOString(),
            });
          }
        } catch {}
      }

      // Also check npm for trending MCP packages
      try {
        const npmRes = await fetch('https://registry.npmjs.org/-/v1/search?text=keywords:mcp-server&size=5', {
          signal: AbortSignal.timeout(5000),
        });
        if (npmRes.ok) {
          const npmData = await npmRes.json() as any;
          for (const pkg of (npmData.objects || [])) {
            const name = pkg.package.name;
            if (seen.has(name)) continue;
            seen.add(name);
            const downloads = (pkg.downloads?.monthly || 0) as number;
            if (downloads > 100) {
              newTrends.push({
                id: `npm-${name}`,
                source: 'npm',
                title: name,
                url: pkg.package.links?.npm || `https://www.npmjs.com/package/${name}`,
                description: (pkg.package.description || '').slice(0, 200),
                score: Math.min(500, downloads),
                category: 'mcp',
                created_at: pkg.package.date?.slice(0, 10) || cutoff,
                discovered_at: new Date().toISOString(),
              });
            }
          }
        }
      } catch {}

      // Replace cache
      db.run('DELETE FROM trends');
      for (const t of newTrends.slice(0, 30)) {
        db.run('INSERT OR REPLACE INTO trends (id, source, title, url, description, score, category, created_at, discovered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [t.id, t.source, t.title, t.url, t.description, t.score, t.category, t.created_at, t.discovered_at]);
      }

      return Response.json({ trends: newTrends.slice(0, 30), cached: false }, { headers });
    }


    // Serve built SPA whenever dist exists; Vite dev still proxies /api separately.
    if (url.pathname === '/' || !url.pathname.startsWith('/api')) {
      // The build sets base '/capability-graph/' for GitHub Pages, so asset
      // URLs carry that prefix; strip it when serving dist locally.
      const stripped = url.pathname.replace(/^\/capability-graph/, '') || '/';
      const filePath = stripped === '/' ? '/index.html' : stripped;
      const f = Bun.file('dist' + filePath);
      const exists = await f.exists();
      if (exists) return new Response(f, { headers });
    }

    return new Response('Not found', { status: 404, headers });
  },
});

console.log(`API server running on http://localhost:${API_PORT}`);
