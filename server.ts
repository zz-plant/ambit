/**
 * The visualiser's API.
 *
 * It is a *reader* of the capability graph, not a second implementation of it:
 * every projection below comes from an engine module, through the same
 * node:sqlite handle the CLI uses. This file used to open the database with a
 * second driver and hand-write the tech-tree query, the frontier counts and the
 * approval path in SQL — three copies of the model, drifting apart, one of them
 * only reachable under a runtime that could not load the engine at all.
 *
 * Loopback only. It reads and writes the agent config, so it must not be
 * reachable from the LAN or over Tailscale.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { getDb, type Db } from './src/engine/db.ts';
import { migrate } from './src/engine/migrate.ts';
import { resolveDbPath } from './src/shared/db-path.ts';
import {
  techTreeView,
  graphSummary,
  recentProposals,
  interventionHeatmap,
} from './src/engine/views.ts';
import { approveProposal } from './src/engine/governance.ts';
import {
  beginRun,
  endRun,
  addEvent,
  recordUse,
  recordIntervention,
  recordResource,
  recordOutcome,
} from './src/engine/telemetry.ts';
import {
  CONFIG_PATH,
  INFRA_MANIFEST_PATH,
  mayEditConfig,
  AGENT_FIELDS,
  COMMAND_FIELDS,
  readConfig,
  writeConfig,
  ownEntry,
  pick,
  isAllowedOrigin,
  corsHeaders,
} from './src/server/config.ts';
import { buildInfrastructureScan } from './src/server/infrastructure.ts';
import { scanRepos } from './src/server/repos.ts';
import type {
  ApiError,
  ApproveResponse,
  AttentionResponse,
  ConfigApplyRequest,
  ConfigApplyResponse,
  ConfigResponse,
  HealthResponse,
  McpSnippetResponse,
  ProposalsResponse,
  TechTreeResponse,
} from './src/shared/api.ts';

const API_PORT = Number(process.env.AMBIT_API_PORT || 3001);
const GRAPH_DB_PATH = resolveDbPath();

/**
 * Opens the graph and brings its schema up to date.
 *
 * The visualiser is a first-class reader, not a guest of the CLI, so it
 * migrates the database itself. Starting the server against a graph seeded by
 * an older Ambit otherwise queried columns that did not exist yet and returned
 * 500 until some other command happened to migrate it.
 */
function openGraph(): Db {
  const db = getDb(GRAPH_DB_PATH);
  migrate(db as never);
  return db;
}

/** Runs `fn` against the graph and always closes the handle. */
function withGraph<T>(fn: (db: Db) => T): T {
  const db = openGraph();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

// ── The live stream ──────────────────────────────────────────────────────────

/**
 * SSE subscribers of /api/events. The graph is polled; work is pushed. Every
 * /api/telemetry observation is broadcast to the open connections so the AG-UI
 * stream narrates real work as it happens, not only graph changes.
 */
const eventClients = new Set<ServerResponse>();

function broadcast(payload: Record<string, unknown>): void {
  const frame = `data: ${JSON.stringify({ ...payload, timestamp: Date.now() })}\n\n`;
  for (const res of [...eventClients]) {
    try {
      res.write(frame);
    } catch {
      eventClients.delete(res);
    }
  }
}

/**
 * Records a work observation from the /api/telemetry payload.
 *
 * The body is structured around the ledger's verbs so an adapter says what it
 * means rather than fighting a foreign schema: { run } begins a run, { end }
 * closes it, and event / use / intervention / resource / outcome each record
 * one row. Never a command.
 */
function ingestTelemetry(db: Db, body: any): Record<string, unknown> {
  const ledger = db as never;
  if (body.run) return beginRun(ledger, body.run);
  if (body.end) return endRun(ledger, body.end.runId, body.end.outcome, body.end.outcomeValueCents);
  if (body.event) return addEvent(ledger, body.event.runId, body.event);
  if (body.use) return recordUse(ledger, body.use.runId, body.use.capabilityId, body.use);
  if (body.intervention) {
    const i = body.intervention;
    return recordIntervention(ledger, i.runId, i.actorId, i);
  }
  if (body.resource) {
    const r = body.resource;
    return recordResource(ledger, r.runId, r.resourceId, r.kind, r);
  }
  if (body.outcome) {
    const o = body.outcome;
    return recordOutcome(ledger, o.runId, o.achieved, o);
  }
  return {
    error: 'Nothing to record. Send one of: run, end, event, use, intervention, resource, outcome.',
  };
}

/**
 * The AG-UI state stream: a StateSnapshot on connect, RFC 6902 StateDelta
 * patches when the graph changes. Runs are bounded — RunStarted on connect,
 * RunFinished or RunError at the end. Tool-call and reasoning events are not
 * emitted: Ambit models the environment agent steps run in, it does not execute
 * them, so fabricating those would be noise. See docs/roadmap.md §11.
 */
function openEventStream(res: ServerResponse, headers: Record<string, string>): void {
  res.writeHead(200, {
    ...headers,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  eventClients.add(res);

  const send = (type: string, payload: Record<string, unknown>) =>
    res.write(`data: ${JSON.stringify({ type, timestamp: Date.now(), ...payload })}\n\n`);

  const snapshot = () =>
    existsSync(GRAPH_DB_PATH) ? withGraph(graphSummary) : { reached: 0, total: 0, observations: 0 };

  /** RFC 6902 diff of a flat state object: `replace` for every changed key. */
  const diffState = (a: Record<string, number>, b: Record<string, number>) =>
    Object.keys({ ...a, ...b })
      .filter(key => a[key] !== b[key])
      .map(key => ({ op: 'replace', path: `/${key}`, value: b[key] }));

  const runId = `ambit-${Date.now()}`;
  let last = snapshot();
  send('RunStarted', { runId, threadId: 'ambit' });
  send('StateSnapshot', { snapshot: last });
  send('TextMessageChunk', {
    messageId: runId,
    role: 'assistant',
    delta: `watching the graph — ${last.total} capabilities, ${last.reached} reached, ${last.observations} observations`,
  });

  // The graph changes when something else re-seeds it, so this polls rather
  // than being notified. A quiet stream is indistinguishable from a dead one to
  // every proxy in between — vite's dev proxy drops an idle SSE connection
  // after ~15s, silently. An SSE comment line is traffic no client parses as an
  // event, so it keeps the connection alive without appearing anywhere.
  let ticks = 0;
  const timer = setInterval(() => {
    if (++ticks % 5 === 0) res.write(': keepalive\n\n');
    const next = snapshot();
    if (JSON.stringify(next) === JSON.stringify(last)) return;
    const delta = diffState(last, next);
    if (delta.length) send('StateDelta', { delta });
    const gained = next.reached - last.reached;
    const verb =
      gained === 0 ? 'changed' : `${gained >= 0 ? 'gained' : 'lost'} ${Math.abs(gained)}`;
    send('TextMessageChunk', {
      messageId: runId,
      delta: `graph ${verb}: reached ${last.reached} → ${next.reached}`,
    });
    last = next;
  }, 2000);

  res.on('close', () => {
    clearInterval(timer);
    eventClients.delete(res);
  });
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────

interface Reply {
  status?: number;
  body: unknown;
}

/**
 * Every reply is one of the shapes declared in src/shared/api.ts, or an error.
 * The client imports the same declarations, so a route that changes shape is a
 * compile error on both sides rather than an empty panel in a browser.
 */
const json = <T>(body: T | ApiError, status = 200): Reply => ({ status, body });

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // A local tool has no reason to accept a large body, and an unbounded read
    // is a way to exhaust this process's memory from a page the user visited.
    if (size > 1_000_000) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/**
 * Serves the built SPA. The path is normalised and confined to dist/ — without
 * that, `GET /../../etc/passwd` reads whatever the process can.
 */
async function serveStatic(
  pathname: string,
  res: ServerResponse,
  headers: Record<string, string>
): Promise<boolean> {
  // The build sets base '/ambit/' for GitHub Pages, so asset URLs carry that
  // prefix; strip it when serving dist locally.
  const stripped = pathname.replace(/^\/ambit/, '') || '/';
  const relative = normalize(stripped === '/' ? '/index.html' : stripped).replace(
    /^(\.\.[/\\])+/,
    ''
  );
  const root = join(process.cwd(), 'dist');
  const filePath = join(root, relative);
  if (!filePath.startsWith(root + '/')) return false;

  try {
    await access(filePath);
    if (!statSync(filePath).isFile()) return false;
  } catch {
    return false;
  }
  res.writeHead(200, {
    ...headers,
    'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
  });
  createReadStream(filePath).pipe(res);
  return true;
}

// ── Routes ───────────────────────────────────────────────────────────────────

async function route(req: IncomingMessage, url: URL): Promise<Reply | null> {
  const { pathname } = url;
  const method = req.method || 'GET';

  if (pathname === '/api/health' && method === 'GET') {
    return json<HealthResponse>({
      status: 'ok',
      configPath: CONFIG_PATH,
      configExists: existsSync(CONFIG_PATH),
      infraManifestPath: INFRA_MANIFEST_PATH,
    });
  }

  if (pathname === '/api/config' && method === 'GET') {
    const raw = await readConfig();
    if (!raw) return json({ error: 'Config not found at ' + CONFIG_PATH }, 404);
    return json<ConfigResponse>({ config: raw });
  }

  // Edits an entry that already exists, and only the fields named above. It
  // deliberately cannot create one — see src/server/config.ts.
  if (pathname === '/api/config/apply' && method === 'POST') {
    const body: ConfigApplyRequest = await readJsonBody(req);
    const raw = (await readConfig()) as any;
    if (!raw) return json({ error: 'Config not found' }, 404);

    for (const name of body.disableMcp || []) {
      if (ownEntry(raw.mcp, name)) raw.mcp[name].enabled = false;
    }
    for (const name of body.enableMcp || []) {
      if (ownEntry(raw.mcp, name)) raw.mcp[name].enabled = true;
    }
    if (body.updateAgent && ownEntry(raw.agent, body.updateAgent.name)) {
      Object.assign(raw.agent[body.updateAgent.name], pick(body.updateAgent.updates, AGENT_FIELDS));
    }
    if (body.updateCommand && ownEntry(raw.command, body.updateCommand.name)) {
      Object.assign(
        raw.command[body.updateCommand.name],
        pick(body.updateCommand.updates, COMMAND_FIELDS)
      );
    }
    return (await writeConfig(raw))
      ? json<ConfigApplyResponse>({ ok: true })
      : json<ConfigApplyResponse>({ error: 'Write failed' }, 500);
  }

  // Returns text instead of writing: an MCP entry is executable, so it crosses
  // into the config only by a person's own hand.
  if (pathname === '/api/config/mcp-snippet' && method === 'POST') {
    const body = await readJsonBody(req);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) return json({ error: 'name required' }, 400);
    return json<McpSnippetResponse>({
      configPath: CONFIG_PATH,
      snippet: JSON.stringify({ mcp: { [name]: { ...body.config, enabled: true } } }, null, 2),
    });
  }

  if (pathname === '/api/telemetry' && method === 'POST') {
    let body: any;
    try {
      body = await readJsonBody(req);
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }
    if (!body || typeof body !== 'object') return json({ error: 'Invalid payload' }, 400);
    const result = withGraph(db => ingestTelemetry(db, body));
    broadcast({ type: 'WorkEvent', ...body });
    return json(result);
  }

  if (pathname === '/api/tech-tree' && method === 'GET') {
    if (!existsSync(GRAPH_DB_PATH)) {
      return json(
        { error: 'No graph yet. Run ./bootstrap.sh to seed one.', items: [], connections: [] },
        404
      );
    }
    return json<TechTreeResponse>(withGraph(techTreeView));
  }

  if (pathname === '/api/proposals' && method === 'GET') {
    if (!existsSync(GRAPH_DB_PATH)) return json<ProposalsResponse>({ proposals: [] });
    return json<ProposalsResponse>({ proposals: withGraph(db => recentProposals(db)) as never });
  }

  if (pathname === '/api/attention' && method === 'GET') {
    if (!existsSync(GRAPH_DB_PATH)) return json<AttentionResponse>({ interventions: [] });
    return json<AttentionResponse>({ interventions: withGraph(interventionHeatmap) as never });
  }

  // The browser approval broker. It approves and mints the signed artifact the
  // executor verifies — that is all. It never applies, and never carries
  // anything an agent could spend without the executor's checks. Approving more
  // capability and granting more authority stay separate acts, and `apply`
  // (CLI-only) is the only thing that can spend the artifact.
  const approve = pathname.match(/^\/api\/proposals\/([^/]+)\/approve$/);
  if (approve && method === 'POST') {
    const body = await readJsonBody(req).catch(() => ({}));
    const actor = typeof body?.actor === 'string' && body.actor ? body.actor : 'human:kanav';
    const result = withGraph(db => approveProposal(db, approve[1], actor)) as any;
    if (result.error) {
      return json(result, /already approved/.test(result.error) ? 409 : 400);
    }
    broadcast({ type: 'ProposalApproved', proposalId: approve[1], actor });
    return json<ApproveResponse>({
      proposal: approve[1],
      approved_by: actor,
      artifact: result.artifact,
    });
  }

  if (pathname === '/api/infrastructure/scan' && method === 'GET') {
    return json(await buildInfrastructureScan());
  }

  if (pathname === '/api/repos/scan' && method === 'GET') {
    const scan = await scanRepos();
    return json(scan, scan.error ? 400 : 200);
  }

  return null;
}

// ── The server ───────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${API_PORT}`);
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);

  // CORS headers only stop a browser from *reading* a cross-origin response; a
  // simple request is still delivered and executed. Reject it outright so a
  // foreign page cannot rewrite the config it is not allowed to read.
  if (!isAllowedOrigin(origin)) {
    res.writeHead(403, headers).end('Forbidden origin');
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers).end();
    return;
  }

  // The origin allow-list only constrains browsers. Reading or rewriting the
  // agent config from anything else needs the token — see src/server/config.ts.
  if (
    !mayEditConfig(
      url.pathname,
      origin,
      req.headers['x-ambit-token'] as string | undefined,
      req.headers['sec-fetch-site'] as string | undefined
    )
  ) {
    res.writeHead(401, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error:
          'This route needs the local API token. Send it as X-Ambit-Token; it is in ~/.config/opencode/ambit-api.token.',
      })
    );
    return;
  }

  if (url.pathname === '/api/events' && req.method === 'GET') {
    openEventStream(res, headers);
    return;
  }

  try {
    const reply = await route(req, url);
    if (reply) {
      res.writeHead(reply.status ?? 200, {
        ...headers,
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(reply.body));
      return;
    }
  } catch (error: any) {
    res.writeHead(500, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error?.message || 'internal error' }));
    return;
  }

  if (!url.pathname.startsWith('/api') && (await serveStatic(url.pathname, res, headers))) return;

  res.writeHead(404, headers).end('Not found');
});

server.listen(API_PORT, '127.0.0.1', () => {
  console.log(`API server running on http://localhost:${API_PORT}`);
});
