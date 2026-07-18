import { Database } from 'bun:sqlite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DB_PATH = Bun.env.HOME + '/.config/opencode/toolchain-viz.db';
const CONFIG_PATH = Bun.env.HOME + '/.config/opencode/opencode.json';
const REPO_PATH = Bun.env.HOME + '/Documents/GitHub';
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

    nodes,
    links,
    findings,
    summary,
  };
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
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
  async fetch(req) {
    const url = new URL(req.url);
    const headers = corsHeaders(req.headers.get('Origin') || '*');

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
      const body = await req.json();
      const raw = await readConfig();
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
      const rows = db.query('SELECT id, label, timestamp FROM snapshots ORDER BY timestamp DESC').all();
      return Response.json({ snapshots: rows }, { headers });
    }

    // POST /api/snapshots — create
    if (url.pathname === '/api/snapshots' && req.method === 'POST') {
      const body = await req.json();
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
      const row = db.query('SELECT * FROM snapshots WHERE id = ?').get(id);
      if (!row) return Response.json({ error: 'Not found' }, { status: 404, headers });
      return Response.json({ snapshot: { ...row, items: JSON.parse(row.items), connections: JSON.parse(row.connections) } }, { headers });
    }

    // GET /api/consultant/history
    if (url.pathname === '/api/consultant/history' && req.method === 'GET') {
      const rows = db.query('SELECT * FROM consultant_log ORDER BY timestamp DESC LIMIT 50').all();
      return Response.json({ history: rows.map(r => ({ ...r, findings: JSON.parse(r.findings) })) }, { headers });
    }

    // POST /api/consultant/log
    if (url.pathname === '/api/consultant/log' && req.method === 'POST') {
      const body = await req.json();
      db.run('INSERT INTO consultant_log (consultant_id, timestamp, score, findings, item_count) VALUES (?, ?, ?, ?, ?)',
        [body.consultantId, new Date().toISOString(), body.score, JSON.stringify(body.findings), body.itemCount]);
      return Response.json({ ok: true }, { headers });
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
      const cached = db.query('SELECT * FROM trends ORDER BY score DESC LIMIT 30').all();
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
          const data = await res.json();
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
          const npmData = await npmRes.json();
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

