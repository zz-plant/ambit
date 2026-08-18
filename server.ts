import { Database } from 'bun:sqlite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveDbPath } from './src/shared/db-path.ts';
import { migrate } from './src/engine/migrate.ts';
import { beginRun, endRun, addEvent, recordUse, recordIntervention, recordResource, recordOutcome } from './src/engine/telemetry.ts';
import { mintApproval } from './src/engine/approval.ts';

const CONFIG_PATH = Bun.env.OPENCODE_CONFIG || Bun.env.HOME + '/.config/opencode/opencode.json';
const REPO_PATH = Bun.env.REPO_PATH || Bun.env.HOME + '/Documents/GitHub';
// The graph the engine builds. Its default lives beside the engine (and is what
// bootstrap.sh writes). Resolved through the shared helper so the engine, the
// MCP server and this API cannot drift onto three different files again.
const GRAPH_DB_PATH = resolveDbPath();
const INFRA_MANIFEST_PATH = Bun.env.INFRA_MANIFEST || Bun.env.HOME + '/.config/opencode/infrastructure.json';
const API_PORT = 3001;

import type {
  InfrastructureNode,
  InfrastructureLink,
  InfrastructureFinding,
  InfraHealth,
} from './src/shared/types.ts';

type InfraNode = InfrastructureNode;
type InfraLink = InfrastructureLink;
type InfraFinding = InfrastructureFinding;

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
/**
 * SSE subscribers of /api/events. The graph is polled; work is pushed. Every
 * /api/telemetry observation is broadcast to the open connections so the AG-UI
 * stream narrates real work as it happens, not only graph changes.
 */
const eventClients = new Set<ReadableStreamDefaultController>();
const eventEncoder = new TextEncoder();
function broadcast(payload: Record<string, unknown>): void {
  const frame = eventEncoder.encode(`data: ${JSON.stringify({ ...payload, timestamp: Date.now() })}\n\n`);
  for (const controller of [...eventClients]) {
    try {
      controller.enqueue(frame);
    } catch {
      eventClients.delete(controller);
    }
  }
}

/**
 * Records a work observation from the /api/telemetry payload.
 *
 * The body is structured around the ledger's verbs so an adapter says what it
 * means rather than fighting a foreign schema: { run: {...} } begins a run,
 * { end: {...} } closes it, { event | use | intervention | resource | outcome }
 * each record one row. Everything is written to the graph database, which the
 * server opens like every other reader, and which the telemetry recorder's
 * driver-agnostic surface lets this Bun process write as easily as the Node
 * engine does.
 */
function ingestTelemetry(graph: Database, body: any): Record<string, unknown> {
  const db = graph as unknown as Parameters<typeof beginRun>[0];
  if (body.run) return beginRun(db, body.run);
  if (body.end) return endRun(db, body.end.runId, body.end.outcome, body.end.outcomeValueCents);
  if (body.event) return addEvent(db, body.event.runId, body.event);
  if (body.use) return recordUse(db, body.use.runId, body.use.capabilityId, body.use);
  if (body.intervention) {
    const i = body.intervention;
    return recordIntervention(db, i.runId, i.actorId, i);
  }
  if (body.resource) {
    const r = body.resource;
    return recordResource(db, r.runId, r.resourceId, r.kind, r);
  }
  if (body.outcome) {
    const o = body.outcome;
    return recordOutcome(db, o.runId, o.achieved, o);
  }
  return { error: 'Nothing to record. Send one of: run, end, event, use, intervention, resource, outcome.' };
}

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return true; // same-origin and non-browser clients send no Origin
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/** Editable fields, by entry kind. Anything else in a payload is dropped. */
const AGENT_FIELDS = ['description', 'model'] as const;
const COMMAND_FIELDS = ['description'] as const;

/**
 * True only for a real, own entry. A plain `bag[name]` truth test would accept
 * '__proto__' or 'constructor' — inherited from Object.prototype — and the
 * assignment that followed would pollute every object in the process.
 */
function ownEntry(bag: any, name: unknown): boolean {
  return (
    typeof name === 'string' &&
    !!bag &&
    Object.prototype.hasOwnProperty.call(bag, name) &&
    typeof bag[name] === 'object' &&
    bag[name] !== null
  );
}

function pick(updates: unknown, allowed: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!updates || typeof updates !== 'object') return out;
  for (const key of allowed) {
    const value = (updates as Record<string, unknown>)[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
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
      // This endpoint may only edit entries that already exist, and only the
      // fields listed below. It deliberately cannot create an entry: a new MCP
      // server carries a `command` array that OpenCode executes, which would
      // make an HTTP request a way to run code on this machine. Adding a server
      // is a hand edit to opencode.json — see /api/config/mcp-snippet.
      if (body.disableMcp) {
        for (const name of body.disableMcp) {
          if (ownEntry(raw.mcp, name)) raw.mcp[name].enabled = false;
        }
      }
      if (body.enableMcp) {
        for (const name of body.enableMcp) {
          if (ownEntry(raw.mcp, name)) raw.mcp[name].enabled = true;
        }
      }
      if (body.updateAgent) {
        const { name, updates } = body.updateAgent;
        if (ownEntry(raw.agent, name)) {
          Object.assign(raw.agent[name], pick(updates, AGENT_FIELDS));
        }
      }
      if (body.updateCommand) {
        const { name, updates } = body.updateCommand;
        if (ownEntry(raw.command, name)) {
          Object.assign(raw.command[name], pick(updates, COMMAND_FIELDS));
        }
      }
      const ok = await writeConfig(raw);
      if (!ok) {
        return Response.json({ error: 'Write failed' }, { status: 500, headers });
      }
      return Response.json({ ok: true }, { headers });
    }

    // POST /api/config/mcp-snippet — format an MCP entry for the user to paste.
    // Deliberately returns text instead of writing: an MCP entry is executable,
    // so it crosses into the config only by a human's own hand.
    if (url.pathname === '/api/config/mcp-snippet' && req.method === 'POST') {
      const body = await req.json() as any;
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!name) return Response.json({ error: 'name required' }, { status: 400, headers });
      return Response.json({
        configPath: CONFIG_PATH,
        snippet: JSON.stringify({ mcp: { [name]: { ...body.config, enabled: true } } }, null, 2),
      }, { headers });
    }


    // GET /api/events — AG-UI shaped state stream.
    //
    // AG-UI is the Agent-User Interaction protocol: an event stream over SSE
    // carrying state between an agentic backend and a front end. Ambit
    // implements its state and run subset — StateSnapshot on connect, and
    // StateDelta (RFC 6902 patches) when the graph changes — which makes the
    // visualiser live and, more usefully, means the transport for an agent
    // proposing a capability change and a human approving it already speaks a
    // standard vocabulary rather than one invented here. See ROADMAP §11.
    //
    // Runs are bounded: every connection opens a run with RunStarted and closes
    // it with RunFinished (or RunError if the stream fails). Messages narrate
    // the run in the protocol's own words. Tool calls and reasoning events are
    // not emitted — Ambit does not execute agent steps, it models the
    // environment those steps would run in, so fabricating them would be noise.
    if (url.pathname === '/api/events' && req.method === 'GET') {
      const encoder = new TextEncoder();
      let timer: ReturnType<typeof setInterval> | undefined;
      let ctrl: ReadableStreamDefaultController | undefined;

      const stream = new ReadableStream({
        start(controller) {
          ctrl = controller as ReadableStreamDefaultController;
          eventClients.add(ctrl);
          const send = (type: string, payload: Record<string, unknown>) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type, timestamp: Date.now(), ...payload })}\n\n`)
            );
          };

          const snapshot = () => {
            if (!existsSync(GRAPH_DB_PATH)) return { reached: 0, total: 0, observations: 0 };
            const graph = new Database(GRAPH_DB_PATH);
            // Queried separately and guarded separately. A single try around
            // both meant a database predating frontier_snapshots threw on the
            // second query and zeroed the counts from the first — reporting an
            // empty graph for a full one.
            let reached = 0, total = 0, observations = 0;
            try {
              const counts = graph.query(
                "SELECT COUNT(*) AS total, SUM(CASE WHEN state != 'locked' THEN 1 ELSE 0 END) AS reached FROM capabilities"
              ).get() as any;
              total = counts?.total ?? 0;
              reached = counts?.reached ?? 0;
            } catch { /* no capabilities table yet */ }
            try {
              observations = (graph.query("SELECT COUNT(*) AS n FROM frontier_snapshots").get() as any)?.n ?? 0;
            } catch { /* ledger predates this database */ }
            graph.close();
            return { reached, total, observations };
          };

          // RFC 6902 diff of a flat state object. `replace` ops for every key
          // whose value changed; nothing else can differ in a flat object, so
          // this is a complete patch.
          const diffState = (a: Record<string, number>, b: Record<string, number>) => {
            const ops: any[] = [];
            for (const key of Object.keys({ ...a, ...b })) {
              if (a[key] !== b[key]) ops.push({ op: 'replace', path: `/${key}`, value: b[key] });
            }
            return ops;
          };

          const runId = `ambit-${Date.now()}`;
          let last = snapshot();
          send('RunStarted', { runId, threadId: 'ambit' });
          send('StateSnapshot', { snapshot: last });
          send('TextMessageChunk', { messageId: runId, role: 'assistant', delta: `watching the graph — ${last.total} capabilities, ${last.reached} reached, ${last.observations} observations` });

          // The graph changes when something re-seeds it, which is an external
          // process — so this polls rather than being notified. Every change
          // after the connect snapshot is an RFC 6902 delta: the client has the
          // snapshot it was given on connect, and a delta is the difference
          // from it. This is the protocol's reason for existing — a patch is
          // smaller than a snapshot — and a client that kept the connect
          // snapshot can apply it.
          // A quiet stream is indistinguishable from a dead one to every proxy
          // between the server and the page — vite's dev proxy drops an SSE
          // connection with no traffic for ~15s, silently, with no error event
          // on the client. An SSE comment line is traffic that no client
          // parses as an event, so it keeps the connection alive everywhere
          // without appearing anywhere.
          let ticks = 0;
          timer = setInterval(() => {
            if (++ticks % 5 === 0) controller.enqueue(encoder.encode(`: keepalive\n\n`));
            const next = snapshot();
            if (JSON.stringify(next) === JSON.stringify(last)) return;
            const delta = diffState(last, next);
            if (delta.length) send('StateDelta', { delta });
            const gained = next.reached - last.reached;
            const direction = gained >= 0 ? 'gained' : 'lost';
            const verb = gained === 0 ? 'changed' : `${direction} ${Math.abs(gained)}`;
            send('TextMessageChunk', { messageId: runId, delta: `graph ${verb}: reached ${last.reached} → ${next.reached}` });
            last = next;
          }, 2000);
        },
        cancel() {
          if (ctrl) eventClients.delete(ctrl);
          if (timer) clearInterval(timer);
        },
      });

      return new Response(stream, {
        headers: {
          ...headers,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // POST /api/telemetry — record a work observation from a runtime adapter or
    // an AG-UI ingestion path. Loopback and origin-allowlisted like everything
    // else; the payload is the ledger's own verbs (run, end, event, use,
    // intervention, resource, outcome), never a command. The observation is
    // written to the graph database and broadcast to open /api/events
    // connections so the stream narrates work as it happens.
    if (url.pathname === '/api/telemetry' && req.method === 'POST') {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
      }
      if (!body || typeof body !== 'object') {
        return Response.json({ error: 'Invalid payload' }, { status: 400, headers });
      }
      const graph = new Database(GRAPH_DB_PATH, { create: true });
      try {
        migrate(graph as unknown as Parameters<typeof migrate>[0]);
        const result = ingestTelemetry(graph, body);
        broadcast({ type: 'WorkEvent', ...body });
        return Response.json(result, { headers });
      } finally {
        graph.close();
      }
    }

    // POST /api/proposals/:id/approve — the browser approval broker.
    //
    // Approves a proposal and mints the signed artifact the executor verifies.
    // That is all it does: it never applies, never writes a command, and never
    // carries anything an agent could spend without the executor's checks. The
    // separation between proposing more capability and granting more authority
    // is the artifact — apply (CLI-only) is the only thing that can spend it.
    const approveMatch = url.pathname.match(/^\/api\/proposals\/([^/]+)\/approve$/);
    if (approveMatch && req.method === 'POST') {
      const proposalId = approveMatch[1];
      let body: any = {};
      try { body = await req.json(); } catch { /* a body is optional */ }
      const actor = typeof body?.actor === 'string' && body.actor ? body.actor : 'human:kanav';

      const graph = new Database(GRAPH_DB_PATH, { create: true });
      try {
        migrate(graph as unknown as Parameters<typeof migrate>[0]);
        const person = graph.query("SELECT id FROM capabilities WHERE id = ? AND category = 'human'").get(actor) as any;
        if (!person) {
          return Response.json({ error: `${actor} is not a person in the graph. Approval has to come from someone accountable.` }, { status: 400, headers });
        }
        const row = graph.query("SELECT * FROM proposals WHERE id = ?").get(proposalId) as any;
        if (!row) return Response.json({ error: `No proposal ${proposalId}.` }, { status: 404, headers });
        if (row.status === 'approved') {
          return Response.json({ error: `${proposalId} is already approved by ${row.approved_by}.` }, { status: 409, headers });
        }
        graph.query("UPDATE proposals SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?")
          .run(actor, proposalId);
        graph.query("INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('approval', ?, 'approved', 1, ?)")
          .run(actor, `${proposalId}: ${row.goal}`);

        const minted = mintApproval(graph as unknown as Parameters<typeof mintApproval>[0], proposalId, {
          actor,
          budgetCents: typeof body?.budgetCents === 'number' ? body.budgetCents : undefined,
          ttlHours: typeof body?.ttlHours === 'number' ? body.ttlHours : 24,
        });
        broadcast({ type: 'ProposalApproved', proposalId, actor, scope: minted.artifact?.scope_exclude });
        return Response.json({ proposal: proposalId, approved_by: actor, artifact: minted.artifact }, { headers });
      } finally {
        graph.close();
      }
    }

    // GET /api/tech-tree — the engine's capability graph, including the curated
    // tech tree, in the shape the visualizer already renders.
    if (url.pathname === '/api/tech-tree' && req.method === 'GET') {
      if (!existsSync(GRAPH_DB_PATH)) {
        return Response.json(
          { error: 'No graph yet. Run ./bootstrap.sh to seed one.', items: [], connections: [] },
          { status: 404, headers }
        );
      }
      // Not { readonly: true }: the engine puts this database in WAL mode, and
      // SQLite must write the -shm sidecar even to read one, so a readonly
      // handle fails with SQLITE_CANTOPEN.
      const graph = new Database(GRAPH_DB_PATH);
      try {
        // The visualizer is a first-class reader of the graph, not a guest of
        // the CLI, so it brings the schema up to date itself. Starting the
        // server against a database seeded by an older Ambit otherwise queried
        // columns that did not exist yet and returned 500 until some other
        // command happened to migrate it. This and the WAL sidecar are the only
        // writes on this path; everything below is a SELECT.
        migrate(graph as unknown as Parameters<typeof migrate>[0]);

        // Actions conferred by a capability are excluded deliberately. A
        // capability confers several, so including them would multiply the node
        // count without changing what the picture says — the era columns and
        // the three states are a designed visual grammar, and legibility is the
        // product. The finer vocabulary is answered by `tt actions`, which asks
        // for one capability's actions rather than all of them at once.
        //
        // Actions a *person* supplies stay: there are few of them, and they are
        // the only thing connecting a human node to the rest of the graph.
        const caps = graph.query(
          `SELECT id, name, domain, description, category, state, unlock_cost_setup
           FROM capabilities c WHERE c.kind != 'action' OR NOT EXISTS (
             SELECT 1 FROM dependencies d JOIN capabilities p ON p.id = d.from_capability
             WHERE d.to_capability = c.id AND d.kind = 'provides' AND p.kind = 'capability'
           )`
        ).all() as any[];
        const visible = new Set(caps.map(c => c.id));
        const deps = (graph.query(
          'SELECT from_capability, to_capability, is_hard_requisite FROM dependencies'
        ).all() as any[]).filter(d => visible.has(d.from_capability) && visible.has(d.to_capability));

        // Era and the "researchable now" state are what make this read as a
        // tech tree rather than a list: Civ's whole grammar is reached / can be
        // researched next / still locked, laid out left to right by era.
        let tree: any = { nodes: [], eras: {} };
        try {
          tree = JSON.parse(readFileSync(join(import.meta.dir, 'src', 'engine', 'techtree.json'), 'utf8'));
        } catch { /* tech tree optional */ }
        const eraById = new Map<string, number>(
          (tree.nodes || []).map((n: any) => [`combo:${n.id}`, n.era])
        );

        const stateById = new Map<string, string>(caps.map(c => [c.id, c.state]));
        const hardPrereqs = new Map<string, string[]>();
        for (const d of deps) {
          if (!d.is_hard_requisite) continue;
          if (!hardPrereqs.has(d.to_capability)) hardPrereqs.set(d.to_capability, []);
          hardPrereqs.get(d.to_capability)!.push(d.from_capability);
        }
        /** Locked, but everything it requires is already reached. */
        const isNext = (id: string, state: string) =>
          state === 'locked' &&
          (hardPrereqs.get(id) || []).every(p => stateById.get(p) !== 'locked');

        const items = caps.map(c => ({
          id: c.id,
          name: c.name,
          // Locked tech-tree nodes render as the 'specified' (wireframe) state,
          // which is how the visualizer already draws something not yet built.
          type: c.category === 'combo' ? 'possibility' : (c.category === 'mcp' ? 'mcp-server' : c.category),
          status: c.state === 'locked' ? 'specified' : 'built',
          description: c.description,
          position: { x: 0, y: 0, z: 0 },
          meta: {
            domain: c.domain,
            state: c.state,
            setupSeconds: c.unlock_cost_setup,
            era: eraById.get(c.id),
            eraName: eraById.has(c.id) ? tree.eras?.[String(eraById.get(c.id))] : undefined,
            next: isNext(c.id, c.state),
          },
        }));
        const connections = deps.map(d => ({
          from: d.from_capability,
          to: d.to_capability,
          type: d.is_hard_requisite ? 'hard-dep' : 'soft-dep',
        }));
        return Response.json({ items, connections }, { headers });
      } finally {
        graph.close();
      }
    }

    // GET /api/infrastructure/scan — read-only device/service topology
    if (url.pathname === '/api/infrastructure/scan' && req.method === 'GET') {
      const scan = await buildInfrastructureScan();
      return Response.json(scan, { headers });
    }

    // GET /api/health — return server status
    if (url.pathname === '/api/health' && req.method === 'GET') {
      const configExists = await Bun.file(CONFIG_PATH).exists();
      return Response.json({
        status: 'ok',
        configPath: CONFIG_PATH,
        configExists,
        infraManifestPath: INFRA_MANIFEST_PATH,
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

    // Serve built SPA whenever dist exists; Vite dev still proxies /api separately.
    if (url.pathname === '/' || !url.pathname.startsWith('/api')) {
      // The build sets base '/ambit/' for GitHub Pages, so asset URLs carry
      // that prefix; strip it when serving dist locally.
      const stripped = url.pathname.replace(/^\/ambit/, '') || '/';
      const filePath = stripped === '/' ? '/index.html' : stripped;
      const f = Bun.file('dist' + filePath);
      const exists = await f.exists();
      if (exists) return new Response(f, { headers });
    }

    return new Response('Not found', { status: 404, headers });
  },
});

console.log(`API server running on http://localhost:${API_PORT}`);
