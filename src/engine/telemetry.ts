import type {
  RunAsk,
  RunEvent,
  RunResponse,
  RunSummary,
  RunUse,
  UnmappedEntry,
  UnmappedResponse,
} from '../shared/api.ts';
import type { Db } from './db.ts';
import { attribute } from './failures.ts';
import type { Migratable } from './migrate.ts';
import { PROVISION_EDGES } from './ontology.ts';
import { loadTechTree, telemetryBridgeInstall } from './paths.ts';
import type {
  CapabilityRow,
  CapabilityUseRow,
  HumanInterventionRow,
  OutcomeRow,
  WorkEventRow,
  WorkRunRow,
} from './rows.ts';
import { GATE_KINDS } from './vocabulary.ts';

/**
 * The work ledger: one row per run of actual effort, the events inside it, the
 * capabilities it exercised, the times a human had to intervene, and the
 * resources it consumed.
 *
 * This is the observation the economic loop runs on. `session_learning` records
 * what the configuration did; these tables record what the *work* was — and a
 * recurring intervention, a long elapsed time, or a resource bill per goal is
 * exactly what an opportunity is a projection of. Nothing here moves
 * `capabilities.state`; the frontier stays structural.
 *
 * Most runs are recorded by an adapter or the AG-UI ingestion path (WP-2), not
 * by a person. The recorder exists so every surface speaks one vocabulary and
 * so a run can be entered by hand when no adapter saw it.
 *
 * Like migrate.ts, the recorder is deliberately free of any `node:sqlite` or
 * driver import: the engine records through the CLI, the visualiser API
 * records under Bun, and both can, because the whole surface used here is
 * `prepare(...).run/get/all`.
 */

/**
 * SQLite's datetime('now') shape, which is not ISO: space, not T, no zone.
 *
 * Either spelling with no zone is UTC, which is how SQLite reads it. Date.parse
 * reads an ISO date-time with no zone as local time, so one stored with a `T`
 * and no zone moved by the process's offset. `isoTime` in audit.ts reads it
 * the same way.
 */
function toEpoch(value?: string | null): number | undefined {
  if (!value) return undefined;
  const text = value.trim().replace(' ', 'T');
  const t = Date.parse(/T[\d:.]+$/.test(text) ? `${text}Z` : text);
  return Number.isFinite(t) ? t : undefined;
}

function durationSeconds(started?: string | null, ended?: string | null): number | undefined {
  const s = toEpoch(started);
  const e = ended ? toEpoch(ended) : Date.now();
  if (s === undefined || e === undefined) return undefined;
  return Math.max(0, Math.round((e - s) / 1000));
}

export interface BeginRunInput {
  id?: string;
  goal?: string;
  goalId?: string;
  runType?: string;
  source?: string;
}

// Date.now() has millisecond resolution, and runs begun in the same
// millisecond would collide on the primary key. The counter is process-local
// and enough: two run ids from one process cannot collide.
let runCounter = 0;

function beginRun(db: Migratable, input: BeginRunInput = {}) {
  const id = input.id || `run-${Date.now().toString(36)}-${runCounter++}`;
  db.prepare(
    'INSERT INTO work_runs (id, goal, goal_id, run_type, source) VALUES (?, ?, ?, ?, ?)'
  ).run(
    id,
    input.goal || null,
    input.goalId || null,
    input.runType || 'task',
    input.source || 'manual'
  );
  return {
    run: id,
    started_at: db
      .prepare('SELECT started_at FROM work_runs WHERE id = ?')
      .get<Pick<WorkRunRow, 'started_at'>>(id)?.started_at,
  };
}

function endRun(db: Migratable, runId: string, outcome: string, outcomeValueCents?: number) {
  const row = db.prepare('SELECT id FROM work_runs WHERE id = ?').get(runId);
  if (!row) return { error: `No run ${runId}. Begin one first.` };
  db.prepare(
    "UPDATE work_runs SET ended_at = datetime('now'), outcome = ?, outcome_value_cents = ? WHERE id = ?"
  ).run(outcome, outcomeValueCents ?? null, runId);
  return {
    run: runId,
    outcome,
    ended_at: db
      .prepare('SELECT ended_at FROM work_runs WHERE id = ?')
      .get<Pick<WorkRunRow, 'ended_at'>>(runId)?.ended_at,
  };
}

export interface EventInput {
  kind: string;
  actor?: string;
  capabilityId?: string;
  action?: string;
  detail?: string;
}

function addEvent(db: Migratable, runId: string, event: EventInput) {
  const row = db.prepare('SELECT id FROM work_runs WHERE id = ?').get(runId);
  if (!row) return { error: `No run ${runId}. Begin one first.` };
  db.prepare(
    'INSERT INTO work_events (run_id, kind, actor, capability_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    runId,
    event.kind,
    event.actor || null,
    event.capabilityId || null,
    event.action || null,
    event.detail || null
  );
  return {
    run: runId,
    kind: event.kind,
    at: db
      .prepare('SELECT at FROM work_events WHERE id = last_insert_rowid()')
      .get<Pick<WorkEventRow, 'at'>>()?.at,
  };
}

function recordUse(
  db: Migratable,
  runId: string,
  capabilityId: string,
  input: { durationSeconds?: number; source?: string } = {}
) {
  if (!db.prepare('SELECT id FROM work_runs WHERE id = ?').get(runId)) {
    return { error: `No run ${runId}. Begin one first.` };
  }
  db.prepare(
    'INSERT INTO capability_use (run_id, capability_id, duration_seconds, source) VALUES (?, ?, ?, ?)'
  ).run(runId, capabilityId, input.durationSeconds ?? null, input.source || 'event');
  return { run: runId, capability: capabilityId };
}

export interface InterventionInput {
  kind: string;
  startedAt?: string;
  endedAt?: string;
  activeSeconds?: number;
  waitingSeconds?: number;
  capabilityId?: string;
  action?: string;
  outcome?: string;
}

function recordIntervention(
  db: Migratable,
  runId: string | null,
  actorId: string,
  input: InterventionInput
) {
  const ended = input.endedAt;
  const active =
    input.activeSeconds ?? (input.startedAt ? durationSeconds(input.startedAt, ended) : undefined);
  const waiting = input.waitingSeconds;
  db.prepare(
    `INSERT INTO human_intervention (run_id, actor_id, kind, started_at, ended_at, active_seconds, waiting_seconds, capability_id, action, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    runId,
    actorId,
    input.kind,
    input.startedAt || new Date().toISOString().slice(0, 19).replace('T', ' '),
    ended || null,
    active ?? null,
    waiting ?? null,
    input.capabilityId || null,
    input.action || null,
    input.outcome || null
  );
  return { actor: actorId, kind: input.kind, active_seconds: active };
}

function recordResource(
  db: Migratable,
  runId: string | null,
  resourceId: string,
  kind: string,
  input: { quantity?: number; unit?: string; costCents?: number } = {}
) {
  db.prepare(
    'INSERT INTO resource_consumption (run_id, resource_id, kind, quantity, unit, cost_cents) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(runId, resourceId, kind, input.quantity ?? 0, input.unit || null, input.costCents ?? null);
  return { resource: resourceId, kind };
}

function recordOutcome(
  db: Migratable,
  runId: string,
  achieved: string,
  input: { objectiveMetric?: number; objectiveName?: string; valueCents?: number } = {}
) {
  if (!db.prepare('SELECT id FROM work_runs WHERE id = ?').get(runId)) {
    return { error: `No run ${runId}. Begin one first.` };
  }
  db.prepare(
    'INSERT INTO outcomes (run_id, achieved, objective_metric, objective_name, value_cents) VALUES (?, ?, ?, ?, ?)'
  ).run(
    runId,
    achieved,
    input.objectiveMetric ?? null,
    input.objectiveName || null,
    input.valueCents ?? null
  );
  return { run: runId, achieved };
}

// ─── Reports ──────────────────────────────────────────────────────────────────

/**
 * The runs themselves, each with what it cost.
 *
 *   ambit work
 *   ambit work 10
 *
 * Elapsed time is measured from the run's own timestamps. Everything else is
 * counted from the run's events, interventions, uses and consumption — so the
 * report is an aggregation of the ledger, not a second copy of it.
 */
function workReport(db: Migratable, limit = 20): any {
  const runs = db
    .prepare(
      'SELECT id, goal, goal_id, run_type, source, started_at, ended_at, outcome, outcome_value_cents FROM work_runs ORDER BY started_at DESC LIMIT ?'
    )
    .all<WorkRunRow>(limit);
  if (runs.length === 0)
    return { note: 'No runs recorded. Begin one with a runtime adapter, or ambit record work.' };

  const nameOf = new Map(
    db
      .prepare('SELECT id, name FROM capabilities')
      .all<Pick<CapabilityRow, 'id' | 'name'>>()
      .map(c => [c.id, c.name] as const)
  );

  return runs.map(r => {
    const elapsed = durationSeconds(r.started_at, r.ended_at);
    const events = db
      .prepare('SELECT COUNT(*) n FROM work_events WHERE run_id = ?')
      .get<{ n: number }>(r.id)!.n;
    const uses = db
      .prepare(
        'SELECT capability_id, SUM(duration_seconds) total FROM capability_use WHERE run_id = ? GROUP BY capability_id'
      )
      .all<{ capability_id: string; total: number | null }>(r.id);
    const interventions = db
      .prepare(
        'SELECT kind, COUNT(*) n, SUM(active_seconds) active FROM human_intervention WHERE run_id = ? GROUP BY kind'
      )
      .all<{ kind: string; n: number; active: number | null }>(r.id);
    const resources = db
      .prepare(
        'SELECT kind, SUM(cost_cents) cost, COUNT(*) n FROM resource_consumption WHERE run_id = ? GROUP BY kind'
      )
      .all<{ kind: string; cost: number | null; n: number }>(r.id);
    const outcome = db
      .prepare('SELECT * FROM outcomes WHERE run_id = ? ORDER BY recorded_at DESC LIMIT 1')
      .get<OutcomeRow>(r.id);
    return {
      run: r.id,
      goal: r.goal || (r.goal_id ? nameOf.get(r.goal_id) || r.goal_id : undefined),
      type: r.run_type,
      started: r.started_at,
      elapsed_seconds: elapsed,
      outcome: r.outcome ?? undefined,
      outcome_value_cents: r.outcome_value_cents ?? undefined,
      events,
      capabilities: uses.map(u => ({
        capability: nameOf.get(u.capability_id) || u.capability_id,
        duration_seconds: u.total,
      })),
      interventions: interventions.map(i => ({
        kind: i.kind,
        times: i.n,
        active_seconds: i.active,
      })),
      resources: resources.map(r2 => ({ kind: r2.kind, cost_cents: r2.cost, items: r2.n })),
      achieved: outcome ? outcome.achieved : undefined,
      objective_metric: outcome ? outcome.objective_metric : undefined,
      objective_name: outcome ? outcome.objective_name : undefined,
      value_cents: outcome ? outcome.value_cents : undefined,
    };
  });
}

// ─── One run, in time ─────────────────────────────────────────────────────────

/** How much of a long run is sent; the totals say how much there was. */
const MAX_EVENTS = 1000;
const MAX_USES = 300;
const MAX_ASKS = 200;

/** Either spelling of an instant the ledger holds, read as UTC and written as ISO. */
function isoOf(value?: string | null): string | undefined {
  const t = toEpoch(value);
  return t === undefined ? undefined : new Date(t).toISOString();
}

/**
 * What one ask took, in seconds, where anything measured it.
 *
 * The recorded active and waiting time when there is any, else the span from
 * the ask to its answer. Nothing otherwise, and that includes the zero a
 * recorder writes because it cannot see the reply. A person does not take
 * exactly no time, so a zero with no end is a recorder that did not know, and
 * reading it as a measurement would put a wait of nothing on a page that
 * exists to say where time went.
 */
function askSeconds(
  i: Pick<HumanInterventionRow, 'started_at' | 'ended_at' | 'active_seconds' | 'waiting_seconds'>
): number | null {
  const recorded = Math.max(0, i.active_seconds ?? 0) + Math.max(0, i.waiting_seconds ?? 0);
  if (recorded > 0) return recorded;
  const from = toEpoch(i.started_at);
  const to = toEpoch(i.ended_at);
  return from !== undefined && to !== undefined && to >= from
    ? Math.round((to - from) / 1000)
    : null;
}

/**
 * A run laid out in time, from what was recorded and no more.
 *
 * The run's start and end, the capabilities it used with how long each lasted,
 * the events inside it as points, and every time a person was asked, each with
 * what it took where a figure exists. Nothing is inferred: a bridge that could
 * not see the reply reports the ask and no end, and the ask stays untimed
 * here, because deciding when a person answered is the engine's to infer later
 * and a bridge that judged would be a second copy of the rule (AGENTS.md
 * rule 8). Untimed is a state the page draws as itself, never as zero.
 *
 * Which asks are permission asks comes from `GATE_KINDS`, so the page does not
 * hold a list of its own. Events are the one table a sync file does not carry,
 * so a run that arrived in one has uses and asks and no events.
 *
 * With no id it is the newest run that recorded an ask, since the page is
 * about where a person's time went, and the newest run overall is often a
 * session that was never asked anything.
 */
function runTimeline(db: Migratable, id?: string): RunResponse {
  const nameOf = new Map(
    db
      .prepare('SELECT id, name FROM capabilities')
      .all<Pick<CapabilityRow, 'id' | 'name'>>()
      .map(c => [c.id, c.name] as const)
  );

  const recent: RunSummary[] = db
    .prepare(
      `SELECT r.id, r.goal, r.goal_id, r.started_at, r.ended_at,
              (SELECT COUNT(*) FROM human_intervention WHERE run_id = r.id) AS asks,
              (SELECT COUNT(*) FROM work_events WHERE run_id = r.id) AS events
       FROM work_runs r ORDER BY r.started_at DESC, r.rowid DESC LIMIT 20`
    )
    .all<
      Pick<WorkRunRow, 'id' | 'goal' | 'goal_id' | 'started_at' | 'ended_at'> & {
        asks: number;
        events: number;
      }
    >()
    .map(r => ({
      id: r.id,
      goal: r.goal || (r.goal_id ? nameOf.get(r.goal_id) || r.goal_id : undefined),
      started_at: isoOf(r.started_at) ?? r.started_at,
      ended_at: isoOf(r.ended_at) ?? null,
      asks: r.asks,
      events: r.events,
    }));
  if (!recent.length) return { recent, run: null };

  const wanted = id ?? (recent.find(r => r.asks > 0) ?? recent[0]).id;
  const row = db
    .prepare('SELECT id, goal, goal_id, started_at, ended_at, outcome FROM work_runs WHERE id = ?')
    .get<Pick<WorkRunRow, 'id' | 'goal' | 'goal_id' | 'started_at' | 'ended_at' | 'outcome'>>(
      wanted
    );
  if (!row) return { recent, run: null };

  const count = (table: string) =>
    db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE run_id = ?`).get<{ n: number }>(wanted)!.n;

  // A figure of nothing is not a duration: a use that lasted zero seconds is a
  // point in time, like one with no figure at all.
  const measured = (s: number | null) => (s != null && s > 0 ? s : null);

  const uses: RunUse[] = db
    .prepare(
      `SELECT capability_id, used_at, duration_seconds FROM capability_use
       WHERE run_id = ? ORDER BY used_at DESC, id DESC LIMIT ?`
    )
    .all<Pick<CapabilityUseRow, 'capability_id' | 'used_at' | 'duration_seconds'>>(wanted, MAX_USES)
    .reverse()
    .flatMap(u => {
      const at = isoOf(u.used_at);
      return at
        ? [
            {
              capability: nameOf.get(u.capability_id) || u.capability_id,
              capability_id: u.capability_id,
              at,
              seconds: measured(u.duration_seconds),
            },
          ]
        : [];
    });

  const events: RunEvent[] = db
    .prepare(
      `SELECT at, kind, action, actor FROM work_events
       WHERE run_id = ? ORDER BY at DESC, id DESC LIMIT ?`
    )
    .all<Pick<WorkEventRow, 'at' | 'kind' | 'action' | 'actor'>>(wanted, MAX_EVENTS)
    .reverse()
    .flatMap(e => {
      const at = isoOf(e.at);
      return at
        ? [
            {
              at,
              kind: e.kind,
              action: e.action ?? undefined,
              actor: e.actor ?? undefined,
            },
          ]
        : [];
    });

  const allAsks = db
    .prepare(
      `SELECT kind, actor_id, started_at, ended_at, active_seconds, waiting_seconds,
              capability_id, action, outcome
       FROM human_intervention WHERE run_id = ? ORDER BY id`
    )
    .all<
      Pick<
        HumanInterventionRow,
        | 'kind'
        | 'actor_id'
        | 'started_at'
        | 'ended_at'
        | 'active_seconds'
        | 'waiting_seconds'
        | 'capability_id'
        | 'action'
        | 'outcome'
      >
    >(wanted);

  // The total is over every ask, drawn or not, and counts only those something
  // timed: a sum over a set that includes unmeasured waits would state a figure
  // the ledger does not hold.
  const human = { seconds: 0, timed: 0, untimed: 0 };
  for (const a of allAsks) {
    const s = askSeconds(a);
    if (s === null) human.untimed++;
    else {
      human.timed++;
      human.seconds += s;
    }
  }

  const asks: RunAsk[] = allAsks
    .flatMap(a => {
      const at = isoOf(a.started_at);
      if (!at) return [];
      const end = isoOf(a.ended_at);
      return [
        {
          kind: a.kind,
          actor: a.actor_id,
          at,
          // An end before the start is a clock that disagrees, not an answer.
          ended_at: end && end >= at ? end : null,
          seconds: askSeconds(a),
          gate: (GATE_KINDS as readonly string[]).includes(a.kind),
          capability: a.capability_id ? nameOf.get(a.capability_id) || a.capability_id : undefined,
          action: a.action ?? undefined,
          outcome: a.outcome ?? undefined,
        },
      ];
    })
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-MAX_ASKS);

  return {
    recent,
    run: {
      id: row.id,
      goal: row.goal || (row.goal_id ? nameOf.get(row.goal_id) || row.goal_id : undefined),
      started_at: isoOf(row.started_at) ?? row.started_at,
      ended_at: isoOf(row.ended_at) ?? null,
      outcome: row.outcome ?? undefined,
      uses,
      uses_total: count('capability_use'),
      events,
      events_total: count('work_events'),
      asks,
      asks_total: allAsks.length,
      human,
    },
  };
}

/**
 * Where capability effort actually went, over a window.
 *
 *   ambit usage
 *   ambit usage 30
 *
 * The raw material of the opportunity engine: a capability that is exercised
 * often, for long, or by an intervention-heavy pattern of runs is a candidate
 * for "make this cheaper". Counts and seconds only — economic value is WP-4.
 */
function usageReport(db: Migratable, days = 30): any {
  const rows = db
    .prepare(
      `SELECT u.capability_id, COUNT(*) times, SUM(u.duration_seconds) duration_seconds
     FROM capability_use u
     WHERE u.used_at >= datetime('now', ?)
     GROUP BY u.capability_id ORDER BY times DESC`
    )
    .all<{ capability_id: string; times: number; duration_seconds: number | null }>(
      `-${days} days`
    );
  if (rows.length === 0) return { note: `No capability use recorded in the last ${days} days.` };

  const nameOf = new Map(
    db
      .prepare('SELECT id, name FROM capabilities')
      .all<Pick<CapabilityRow, 'id' | 'name'>>()
      .map(c => [c.id, c.name] as const)
  );
  const byRun = new Map<string, number>();
  const byIntervention = new Map<string, number>();
  for (const r of db
    .prepare(
      "SELECT capability_id, COUNT(*) n FROM human_intervention WHERE started_at >= datetime('now', ?) GROUP BY capability_id"
    )
    .all<{ capability_id: string | null; n: number }>(`-${days} days`)) {
    // An intervention with no capability cannot be attributed to a use.
    if (r.capability_id) byIntervention.set(r.capability_id, r.n);
  }
  for (const r of db
    .prepare(
      "SELECT run_id, COUNT(*) n FROM work_events WHERE at >= datetime('now', ?) GROUP BY run_id"
    )
    .all<{ run_id: string; n: number }>(`-${days} days`)) {
    byRun.set(r.run_id, r.n);
  }

  return rows.map(r => ({
    capability: nameOf.get(r.capability_id) || r.capability_id,
    id: r.capability_id,
    times: r.times,
    duration_seconds: r.duration_seconds,
    interventions: byIntervention.get(r.capability_id) || 0,
  }));
}

/**
 * What the agents used in the last `days` that the map has no node for.
 *
 * The map can only show the range the curated tree names, so a tool used
 * every day and matched by nothing on it was invisible, and the range looked
 * smaller than it is. A tool is placed the way a failing one is attributed
 * (`attribute` in failures.ts, the tree's own `detect` patterns), so what
 * counts as on the map cannot drift from detection: a tool on the map is one
 * attributed to a tree node, or to an entry that supplies a node specific to
 * it. Five Cloudflare servers supplying only Tool Protocol are five servers
 * whose work the map does not show.
 *
 * Presence, not frequency. AGENTS.md rule 4 tracks configuration decisions,
 * not invocation counts, so this says what was used and when last, and never
 * how often. The overlay is text for a person to paste into
 * .ambit/techtree.json: a node matched to the entry by its id, which runs
 * nothing (rule 7), and nothing here writes it.
 */
function unmappedUse(db: Db, days = 30): UnmappedResponse {
  let tools: { tool: string; last: string }[] = [];
  try {
    tools = db
      .prepare(
        `SELECT action AS tool, MAX(at) AS last FROM work_events
         WHERE kind = 'tool' AND action IS NOT NULL AND action != 'unknown'
           AND at >= datetime('now', ?)
         GROUP BY action ORDER BY action`
      )
      .all<{ tool: string; last: string }>(`-${days} days`);
  } catch {
    /* a graph with no ledger yet */
  }
  if (!tools.length) {
    return {
      days,
      seen: 0,
      unmapped: [],
      note: `No tool use recorded in the last ${days} days. In OpenCode the telemetry bridge records it: ${telemetryBridgeInstall()}`,
    };
  }

  const provisions = (PROVISION_EDGES as string[]).map(() => '?').join(', ');
  const supplied = db.prepare(
    `SELECT c.id FROM dependencies d JOIN capabilities c ON c.id = d.to_capability
     WHERE d.from_capability = ? AND d.kind IN (${provisions}) AND c.kind = 'capability'`
  );
  const nameOf = db.prepare('SELECT name FROM capabilities WHERE id = ?');
  const entryExists = db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?');
  // A node whose every detect pattern matches the bare kind ("mcp:") would
  // match any entry of that kind: Tool Protocol is "at least one MCP server".
  // Supplying it says nothing about what this one server does, so it does
  // not put the server's work on the map.
  const detectOf = new Map<string, RegExp[]>();
  try {
    for (const n of loadTechTree().nodes || []) {
      if (n.detect?.any?.length) {
        detectOf.set(
          `combo:${n.id}`,
          n.detect.any.map((p: string) => new RegExp(p, 'i'))
        );
      }
    }
  } catch {
    /* no curated tree: every supplied node counts */
  }
  const generic = (node: string, entry: string) => {
    const res = detectOf.get(node);
    const kind = entry.slice(0, entry.indexOf(':') + 1);
    return Boolean(res && kind && res.every(re => re.test(kind)));
  };
  const onMap = (id: string) =>
    id.startsWith('combo:') ||
    supplied
      .all<{ id: string }>(id, ...(PROVISION_EDGES as string[]))
      .some(n => !generic(n.id, id));

  const groups = new Map<string, UnmappedEntry>();
  for (const t of tools) {
    // A built-in tool is its own entry (`tool:bash`), and the tree detects the
    // entry, not the tool's name; `attribute` resolves MCP names only.
    const placed =
      attribute(db, t.tool) ?? (entryExists.get(`tool:${t.tool}`) ? `tool:${t.tool}` : null);
    if (placed && onMap(placed)) continue;
    const key = placed ?? `tool:${t.tool}`;
    const group = groups.get(key) ?? {
      ...(placed
        ? { entry: { id: placed, name: String(nameOf.get(placed)?.name ?? placed) } }
        : {}),
      tools: [],
      lastUsed: t.last,
    };
    group.tools.push(t.tool);
    if (t.last > group.lastUsed) group.lastUsed = t.last;
    groups.set(key, group);
  }
  const unmapped = [...groups.values()].sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));

  // Only an entry can be matched by a node: detect patterns are tested
  // against capability ids, and a bare tool name is not one.
  const nodes = unmapped
    .filter(u => u.entry)
    .map(u => {
      const slug = u.entry!.id.replace(/^[a-z]+:/, '').replace(/[^a-z0-9-]+/gi, '-');
      return {
        id: slug,
        name: u.entry!.name,
        era: 3,
        description: `What ${u.entry!.name} does for your agents. Used: ${u.tools.join(', ')}.`,
        detect: { any: [`^${u.entry!.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`] },
        requires: u.entry!.id.startsWith('mcp:') ? ['tool-protocol'] : [],
      };
    });

  return {
    days,
    seen: tools.length,
    unmapped,
    ...(nodes.length
      ? {
          overlay: JSON.stringify({ nodes }, null, 2),
          overlay_note:
            'Paste into .ambit/techtree.json, rename and describe each node, then run ambit seed. Era 3 is Tool Use; move a node if it belongs elsewhere.',
        }
      : {}),
  };
}

export {
  beginRun,
  endRun,
  addEvent,
  recordUse,
  recordIntervention,
  recordResource,
  recordOutcome,
  workReport,
  runTimeline,
  usageReport,
  unmappedUse,
};
