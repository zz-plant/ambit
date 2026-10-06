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
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, type Db } from '../engine/db.ts';
import { migrate } from '../engine/migrate.ts';
import { resolveDbPath } from '../shared/db-path.ts';
import {
  techTreeView,
  frontierHistoryView,
  unmappedView,
  graphSummary,
  recentProposals,
  interventionHeatmap,
  loopView,
  auditView,
  machineView,
  runView,
} from '../engine/views.ts';
import { decideDraft, decideShown, ensureActor } from '../engine/governance.ts';
import { briefingText, TOKEN_BUDGET } from '../engine/briefing.ts';
import {
  beginRun,
  endRun,
  addEvent,
  recordUse,
  recordIntervention,
  recordResource,
  recordOutcome,
} from '../engine/telemetry.ts';
import { captureFailure } from '../engine/failures.ts';
import {
  CONFIG_PATH,
  INFRA_MANIFEST_PATH,
  mayEditConfig,
  AGENT_FIELDS,
  COMMAND_FIELDS,
  readConfig,
  readConfigFile,
  writeConfig,
  ownEntry,
  pick,
  isAllowedHost,
  isAllowedOrigin,
  corsHeaders,
  apiPort,
  apiToken,
  pagePorts,
} from './config.ts';
import { buildInfrastructureScan } from './infrastructure.ts';
import { scanRepos } from './repos.ts';
import { isOpencodeV2, mcpEntries } from '../shared/opencode.ts';
import type {
  ApiError,
  ApproveResponse,
  AttentionResponse,
  AuditResponse,
  BriefingResponse,
  LoopResponse,
  ConfigApplyRequest,
  ConfigApplyResponse,
  ConfigResponse,
  FrontierHistoryResponse,
  HealthResponse,
  InfrastructureScanResponse,
  McpSnippetResponse,
  ProposalsResponse,
  QueueDecisionRequest,
  QueueDecisionResponse,
  RejectRequest,
  RejectResponse,
  RunResponse,
  TechTreeResponse,
  UnmappedResponse,
} from '../shared/api.ts';

/**
 * Who a browser decision is recorded as. The client's copy.ts carries the same
 * id; the panel shows it as "you".
 */
const WEB_ACTOR = 'human:web';
const WEB_ACTOR_NAME = 'you, at the browser';
const WEB_ACTOR_ROLE =
  'The person at this machine, deciding from the web view over the loopback API';

/** The hash a decision names, from whatever body the request sent. */
function shownHash(body: unknown): string | undefined {
  const hash = (body as { proposalHash?: unknown } | null)?.proposalHash;
  return typeof hash === 'string' ? hash : undefined;
}

/** A proposal that is not what the page showed is a conflict; the rest is a bad request. */
function refusalStatus(kind: 'missing' | 'not-draft' | 'changed' | 'unnamed' | 'engine'): number {
  return kind === 'not-draft' || kind === 'changed' ? 409 : 400;
}

const API_PORT = apiPort();

/**
 * The built page, two levels above this file in either layout: `src/server`
 * in a checkout, `dist-cli/server` in an installed copy, both beside `dist/`.
 * It was `dist` under the working directory, which is right only for a
 * checkout started from its root, so an installed `ambit web` would have
 * served whatever `dist/` sat in the directory it was typed in.
 */
const WEB_ROOT =
  process.env.AMBIT_WEB_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const GRAPH_DB_PATH = resolveDbPath();

/**
 * Opens the graph and brings its schema up to date.
 *
 * The visualiser is a first-class reader, not a guest of the CLI, so it
 * migrates the database itself. Starting the server against a graph seeded by
 * an older Ambit otherwise queried columns that did not exist yet and returned
 * 500 until some other command happened to migrate it.
 *
 * Kept warm across requests: reopening SQLite and running 19 PRAGMA checks and
 * 447 lines of DDL every two seconds per connected SSE client produced massive
 * statement compilation overhead and lock contention.
 */
let warmDb: Db | null = null;
function getWarmGraph(): Db {
  if (!warmDb) {
    warmDb = getDb(GRAPH_DB_PATH);
    migrate(warmDb as never);
  }
  return warmDb;
}

process.on('exit', () => {
  if (warmDb) {
    try {
      warmDb.close();
    } catch {}
    warmDb = null;
  }
});

/** Runs `fn` against the graph using the warm handle. */
function withGraph<T>(fn: (db: Db) => T): T {
  const db = getWarmGraph();
  return fn(db);
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
 *
 * { failure } is the §12.2 verb: a tool failed, here is what the runtime said
 * about it. Ambit classifies it rather than the bridge doing so — a bridge that
 * decides what counts as a permission error is a second place for that rule to
 * live, and it would drift.
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
  if (body.failure) {
    return captureFailure(db, { source: 'api', ...body.failure });
  }
  return {
    error:
      'Nothing to record. Send one of: run, end, event, use, intervention, resource, outcome, failure.',
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
    existsSync(GRAPH_DB_PATH)
      ? withGraph(graphSummary)
      : { reached: 0, total: 0, observations: 0, proven: 0, failing: 0, drafts: 0 };

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
  '.woff': 'font/woff',
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
  const root = WEB_ROOT;
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
    const file = await readConfigFile();
    if (!file) return json({ error: `${CONFIG_PATH} was not found.` }, 404);
    if (!file.plain)
      return json<ConfigApplyResponse>(
        {
          error: `${CONFIG_PATH} has comments, and writing it would delete them. Edit it by hand.`,
        },
        409
      );
    const raw = file.raw;

    // Into the shape the file already has: OpenCode 2 keeps servers under
    // `mcp.servers` and says `disabled`, and a V1 field written into a V2 file
    // is one OpenCode warns about and a person has to clean up.
    const servers = mcpEntries(raw);
    const setMcp = (name: string, on: boolean) => {
      if (!ownEntry(servers.bag, name)) return;
      const entry = (servers.bag as Record<string, any>)[name];
      if (servers.v2 && !('enabled' in entry)) entry.disabled = !on;
      else entry.enabled = on;
    };
    for (const name of body.disableMcp || []) setMcp(name, false);
    for (const name of body.enableMcp || []) setMcp(name, true);

    // An entry is edited under whichever name the file holds it by; a file with
    // both is read with the V2 name winning, so that is the one edited.
    const own = (v1: string, v2: string, name: unknown) =>
      ownEntry(raw[v2], name) ? raw[v2] : ownEntry(raw[v1], name) ? raw[v1] : null;
    const agents = body.updateAgent && own('agent', 'agents', body.updateAgent.name);
    if (body.updateAgent && agents) {
      Object.assign(agents[body.updateAgent.name], pick(body.updateAgent.updates, AGENT_FIELDS));
    }
    const commands = body.updateCommand && own('command', 'commands', body.updateCommand.name);
    if (body.updateCommand && commands) {
      Object.assign(
        commands[body.updateCommand.name],
        pick(body.updateCommand.updates, COMMAND_FIELDS)
      );
    }
    return (await writeConfig(raw))
      ? json<ConfigApplyResponse>({ ok: true })
      : json<ConfigApplyResponse>(
          { error: `Could not write ${CONFIG_PATH}, or keep a copy of it beside it first.` },
          500
        );
  }

  // Returns text instead of writing: an MCP entry is executable, so it crosses
  // into the config only by a person's own hand.
  if (pathname === '/api/config/mcp-snippet' && method === 'POST') {
    const body = await readJsonBody(req);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) return json({ error: 'name required' }, 400);
    // In the shape the config is already written in, so the paste fits it.
    const file = await readConfigFile();
    const entry = { ...body.config };
    const snippet =
      file && isOpencodeV2(file.raw)
        ? { mcp: { servers: { [name]: { ...entry, disabled: false } } } }
        : { mcp: { [name]: { ...entry, enabled: true } } };
    return json<McpSnippetResponse>({
      configPath: CONFIG_PATH,
      snippet: JSON.stringify(snippet, null, 2),
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
    // The body is what a runtime reported, and it does not get to say what kind
    // of event this is: a `type` in it used to win, so anything that could post
    // here could put a ProposalApproved on every open page's stream.
    broadcast({ ...body, type: 'WorkEvent' });
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

  // The frontier through time, for the map's timeline. Read only: every tick
  // is an observation the ledger already recorded, and nothing here writes one.
  if (pathname === '/api/frontier' && method === 'GET') {
    if (!existsSync(GRAPH_DB_PATH)) {
      return json<FrontierHistoryResponse>({ ticks: [], movedSinceLast: null });
    }
    return json<FrontierHistoryResponse>(withGraph(frontierHistoryView));
  }

  // What was used and is not on the map. Read-only: the overlay it carries is
  // text for a person to paste, and nothing here writes a file.
  if (pathname === '/api/unmapped' && method === 'GET') {
    if (!existsSync(GRAPH_DB_PATH))
      return json<UnmappedResponse>({ days: 30, seen: 0, unmapped: [] });
    return json<UnmappedResponse>(withGraph(db => unmappedView(db)));
  }

  if (pathname === '/api/proposals' && method === 'GET') {
    if (!existsSync(GRAPH_DB_PATH)) return json<ProposalsResponse>({ proposals: [] });
    return json<ProposalsResponse>({ proposals: withGraph(db => recentProposals(db)) as never });
  }

  // The trail, one line per event. Read-only: it projects the ledger and
  // writes nothing, and a check's printed output is not part of it. Asking
  // before any graph exists must not create one, so that is an empty trail.
  if (pathname === '/api/audit' && method === 'GET') {
    const opts = {
      days: Number(url.searchParams.get('days')) || undefined,
      limit: Number(url.searchParams.get('limit')) || undefined,
    };
    return json<AuditResponse>(
      existsSync(GRAPH_DB_PATH) ? withGraph(db => auditView(db, opts)) : auditView(null, opts)
    );
  }

  if (pathname === '/api/attention' && method === 'GET') {
    if (!existsSync(GRAPH_DB_PATH)) return json<AttentionResponse>({ interventions: [] });
    return json<AttentionResponse>({ interventions: withGraph(interventionHeatmap) as never });
  }

  // Where a person's time went, and what would buy it back. Every figure is a
  // projection of a report the CLI already prints, so the page and the
  // terminal cannot disagree about one ledger.
  if (pathname === '/api/loop' && method === 'GET') {
    if (!existsSync(GRAPH_DB_PATH)) {
      return json({ error: 'No graph yet. Run ./bootstrap.sh to seed one.' }, 404);
    }
    return json<LoopResponse>(withGraph(loopView));
  }

  // The queue: several drafts, each approved or turned down on its own. The
  // actor is the web actor whatever the body says, each id is bound to the
  // hash the page showed, and the answer is per id, since one refusal does
  // not undo the rest. Approving never applies. Both paths are config routes
  // (src/server/config.ts), so a request with no browser behind it needs the
  // token: one of these decides up to fifty where the per-id routes decide one.
  const queue =
    pathname === '/api/proposals/approve'
      ? 'approve'
      : pathname === '/api/proposals/reject'
        ? 'reject'
        : null;
  if (queue && method === 'POST') {
    let body: QueueDecisionRequest;
    try {
      body = await readJsonBody(req);
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }
    const result = withGraph(db => {
      ensureActor(db, WEB_ACTOR, WEB_ACTOR_NAME, WEB_ACTOR_ROLE);
      return decideShown(db, queue, body?.items, WEB_ACTOR);
    });
    if ('error' in result) return json(result, 400);
    for (const r of result.results) {
      if (!r.decided) continue;
      broadcast({
        type: queue === 'approve' ? 'ProposalApproved' : 'ProposalRejected',
        proposalId: r.id,
        actor: WEB_ACTOR,
      });
    }
    return json<QueueDecisionResponse>({
      decision: queue === 'approve' ? 'approved' : 'rejected',
      decided_by: WEB_ACTOR,
      results: result.results,
    });
  }

  // One run, in time, from what the ledger recorded. Read-only, and the same
  // projection every surface reads. An id that names no run is a 404, and no id
  // is the newest run that recorded an ask.
  if (pathname === '/api/run' && method === 'GET') {
    if (!existsSync(GRAPH_DB_PATH)) {
      return json({ error: 'No graph yet. Run ./bootstrap.sh to seed one.' }, 404);
    }
    const wanted = url.searchParams.get('id') || undefined;
    const view = withGraph(db => runView(db, wanted));
    if (wanted && !view.run) return json({ error: `No run ${wanted}.` }, 404);
    return json<RunResponse>(view);
  }

  // The browser approval broker. It approves and mints the signed artifact the
  // executor verifies — that is all. It never applies, and never carries
  // anything an agent could spend without the executor's checks. Approving more
  // capability and granting more authority stay separate acts, and `apply`
  // (CLI-only) is the only thing that can spend the artifact.
  //
  // The web actor is declared on the way in. The engine refuses a decision
  // from a person the graph does not know, and the browser's person is the
  // one at this machine's loopback port, whom no config had declared, so the
  // one-click approval failed on every machine that had not typed them in.
  //
  // It is that person and nobody else. The body used to be allowed to name the
  // actor, which let anything that could make a loopback request sign an
  // approval as any person the graph knew, and the control plane accepts a
  // signed artifact for the person it asks for. The body names the hash the
  // card was drawn from instead, and the decision is the same guarded one the
  // queue makes: a draft that still hashes to what was shown, decided in a
  // transaction of its own. Like the queue it is a config route, so a request
  // with no browser behind it needs the token (src/server/config.ts).
  const approve = pathname.match(/^\/api\/proposals\/([^/]+)\/approve$/);
  if (approve && method === 'POST') {
    const body = await readJsonBody(req).catch(() => ({}));
    const decided = withGraph(db => {
      ensureActor(db, WEB_ACTOR, WEB_ACTOR_NAME, WEB_ACTOR_ROLE);
      return decideDraft(
        db,
        'approve',
        { id: approve[1], proposalHash: shownHash(body) },
        WEB_ACTOR
      );
    });
    if (!decided.ok) return json({ error: decided.refused }, refusalStatus(decided.kind));
    broadcast({ type: 'ProposalApproved', proposalId: approve[1], actor: WEB_ACTOR });
    return json<ApproveResponse>({
      proposal: approve[1],
      approved_by: WEB_ACTOR,
      artifact: decided.result.artifact,
    });
  }

  // The other half of every decision. Refusal was recordable from the
  // terminal and not from the panel that asks for the decision, so a no made
  // in the browser vanished, and the record the next draft learns from was
  // one-sided. The reason is optional and is the most valuable part of the row.
  const reject = pathname.match(/^\/api\/proposals\/([^/]+)\/reject$/);
  if (reject && method === 'POST') {
    const body = (await readJsonBody(req).catch(() => ({}))) as Partial<RejectRequest>;
    const reason =
      typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined;
    const decided = withGraph(db => {
      ensureActor(db, WEB_ACTOR, WEB_ACTOR_NAME, WEB_ACTOR_ROLE);
      return decideDraft(
        db,
        'reject',
        { id: reject[1], proposalHash: shownHash(body) },
        WEB_ACTOR,
        reason
      );
    });
    if (!decided.ok) return json({ error: decided.refused }, refusalStatus(decided.kind));
    broadcast({ type: 'ProposalRejected', proposalId: reject[1], actor: WEB_ACTOR });
    return json<RejectResponse>({ proposal: reject[1], rejected_by: WEB_ACTOR, reason });
  }

  // What an agent is told at connect, shown to the person it describes the
  // machine to. Reading it applies any authority threshold the evidence now
  // supports, as the MCP resource and `ambit briefing` do, since asking what
  // the environment is like is the moment a promotion someone already
  // authorised should take effect. It does not mark the environment briefed:
  // the person reading it is not the agent.
  if (pathname === '/api/briefing' && method === 'GET') {
    if (!existsSync(GRAPH_DB_PATH)) {
      return json({ error: 'No graph yet. Run ./bootstrap.sh to seed one.' }, 404);
    }
    return json<BriefingResponse>({
      text: withGraph(db => briefingText(db, { mark: false })),
      budget: TOKEN_BUDGET,
    });
  }

  // The scan is a reading taken now, and what an agent may do on each machine
  // it found is the gate's answer for that machine, from this graph's grants.
  if (pathname === '/api/infrastructure/scan' && method === 'GET') {
    const scan = await buildInfrastructureScan();
    const devices = scan.nodes.filter(n => n.kind === 'device').map(n => n.id);
    const machines = existsSync(GRAPH_DB_PATH) ? withGraph(db => machineView(db, devices)) : [];
    return json<InfrastructureScanResponse>({ ...scan, machines });
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

  // Who the request was addressed to comes before who sent it. A page that
  // rebinds its own name to this address is the same origin as this server in
  // the browser's eyes, so no origin check can stop it, but the name it asked
  // for is still its own. See isAllowedHost.
  if (!isAllowedHost(req.headers.host)) {
    res.writeHead(403, headers).end('Forbidden host');
    return;
  }

  // CORS headers only stop a browser from *reading* a cross-origin response; a
  // simple request is still delivered and executed. Reject it outright so a
  // foreign page cannot rewrite the config it is not allowed to read.
  if (!isAllowedOrigin(origin)) {
    // Which ports are accepted is no secret, and a dev server started on a
    // port the API was not told about otherwise fails with nothing to go on.
    res
      .writeHead(403, headers)
      .end(
        `Forbidden origin. A page on localhost is accepted from port ${pagePorts().join(' or ')}; a dev server elsewhere sets AMBIT_WEB_PORT for both processes.`
      );
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

// The token is made now, not at the first request that checks one. A bridge
// that posts telemetry finds it in the file, and nothing else would make it:
// the page never needs it, and a request without the header is refused before
// the token is read.
try {
  apiToken();
} catch (error: any) {
  console.error(
    `No API token could be written, so token clients will be refused: ${error?.message}`
  );
}

server.listen(API_PORT, '127.0.0.1', () => {
  console.log(`API server running on http://127.0.0.1:${API_PORT}`);
});
