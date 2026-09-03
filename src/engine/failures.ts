/**
 * Failures the runtime already reports, turned into deficits nobody had to
 * remember to record. Roadmap §12.2.
 *
 * `ambit record` has always existed and has always depended on a person or an
 * agent stopping to use it. That is the wrong moment to ask: work is blocked,
 * the human is watching, and recording the block is the least urgent thing in
 * the room. So the ledger stayed empty, and every report that reads it —
 * deficits, attention, opportunities — opened by saying nothing had been
 * observed.
 *
 * Nothing here reads free text for meaning. The signals are the ones a runtime
 * states outright: a non-zero exit with a shell's own message for a missing
 * binary, an MCP error kind, a permission refusal. Anything else is recorded as
 * `unclassified` rather than guessed at, because a wrong classification is
 * worse than an honest count.
 */
import type { Db } from './db.ts';
import { loadTechTree } from './paths.ts';
import { type BLOCK_CLASSES, blockedAction } from './plan/deficits.ts';

type BlockClass = (typeof BLOCK_CLASSES)[number];

/**
 * What a runtime hands over. Every field is optional because every runtime
 * reports a different subset, and a signal with only an exit code is still
 * worth counting.
 */
interface RawFailure {
  /** Which bridge observed it — `opencode`, `claude-code`, `api`. */
  source?: string;
  sessionId?: string;
  /** The tool or command that failed, as the runtime names it. */
  tool?: string;
  exitCode?: number | null;
  /** stderr, an MCP error message, a runtime's refusal text. */
  message?: string;
  /** An error kind the runtime states rather than one inferred from text. */
  errorKind?: string;
  /** A capability id, when the caller already knows it. */
  capabilityId?: string;
}

/**
 * The signals, in the order they are tested, each with the §6 class it means.
 *
 * These match what a shell, a package manager or an MCP client *emits*, not
 * what a failure is about. `command not found` is a missing tool whatever the
 * command was trying to do; `EACCES` is a permission whoever asked for it.
 * Order matters only where two could match — a permission error mentioning a
 * missing file is a permission error.
 */
const SIGNALS: Array<{ re: RegExp; signal: string; class: BlockClass }> = [
  {
    re: /\bcommand not found\b|\bnot found\b.*\bcommand\b/i,
    signal: 'command-not-found',
    class: 'tool',
  },
  { re: /\bENOENT\b|no such file or directory/i, signal: 'enoent', class: 'tool' },
  {
    re: /\bexecutable file not found\b|is not recognized as an internal/i,
    signal: 'no-executable',
    class: 'tool',
  },
  {
    re: /\bEACCES\b|permission denied|operation not permitted/i,
    signal: 'permission-denied',
    class: 'permission',
  },
  {
    re: /\b(401|403)\b|unauthorized|forbidden|requires? authentication|invalid (api )?key|not authoris?ed/i,
    signal: 'unauthorized',
    class: 'permission',
  },
  {
    re: /\bECONNREFUSED\b|connection refused|\bEHOSTUNREACH\b|\bENOTFOUND\b|could not resolve host/i,
    signal: 'unreachable',
    class: 'infrastructure',
  },
  {
    re: /\bETIMEDOUT\b|\btimed? ?out\b|deadline exceeded/i,
    signal: 'timeout',
    class: 'infrastructure',
  },
  {
    re: /\b(429|5\d\d)\b|rate limit|too many requests|service unavailable|internal server error/i,
    signal: 'upstream-error',
    class: 'reliability',
  },
  {
    re: /\bENOSPC\b|no space left|out of memory|\bOOM\b/i,
    signal: 'resource-exhausted',
    class: 'infrastructure',
  },
  {
    re: /tool .* not found|unknown tool|no such tool|method not found/i,
    signal: 'no-such-tool',
    class: 'tool',
  },
];

/**
 * The class an error kind states outright, when a runtime states one.
 *
 * A runtime that names its own error is a better source than a regex over its
 * message, so these are checked first.
 */
const ERROR_KINDS: Record<string, BlockClass> = {
  permission_denied: 'permission',
  permission: 'permission',
  unauthorized: 'permission',
  forbidden: 'permission',
  not_found: 'tool',
  tool_not_found: 'tool',
  missing_tool: 'tool',
  network: 'infrastructure',
  unreachable: 'infrastructure',
  timeout: 'infrastructure',
  rate_limit: 'reliability',
  server_error: 'reliability',
};

/**
 * What kind of failure this is, or nothing.
 *
 * Returns null for a failure whose shape says nothing — a test that failed, a
 * compile error, an agent's own mistake. Those are work, not capability
 * deficits, and counting them would drown the signal this exists to find.
 */
function classifySignal(input: RawFailure): { class: BlockClass; signal: string } | null {
  const kind = input.errorKind?.toLowerCase().replace(/[\s-]/g, '_');
  if (kind && ERROR_KINDS[kind]) return { class: ERROR_KINDS[kind], signal: kind };
  const text = input.message || '';
  if (text) {
    for (const s of SIGNALS) {
      if (s.re.test(text)) return { class: s.class, signal: s.signal };
    }
  }
  // A non-zero exit with nothing to read is a failure Ambit cannot classify.
  // 127 is the exception every shell agrees on: the command does not exist.
  if (input.exitCode === 127) return { class: 'tool', signal: 'command-not-found' };
  return null;
}

/** Cached so a session recording forty signals compiles the model's patterns once. */
let detectors: Array<{ id: string; res: RegExp[] }> | null = null;

/**
 * The capability a tool belongs to, using the curated model's own `detect`
 * vocabulary.
 *
 * This is the same matching that turns a config file into a graph, pointed at a
 * tool name instead. Reusing it means attribution cannot drift from detection:
 * if `\bgit\b` is what makes a git MCP server Version Control, it is also what
 * makes a failing `git push` a Version Control deficit.
 */
function attribute(db: Db, tool?: string): string | null {
  if (!tool) return null;
  // An MCP tool names its server: mcp__github__create_issue → mcp:github.
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(tool);
  if (mcp) {
    const id = `mcp:${mcp[1].replace(/_/g, '-')}`;
    if (db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(id)) return id;
  }
  if (!detectors) {
    try {
      detectors = (loadTechTree().nodes || [])
        .filter((n: any) => n.detect?.any?.length)
        .map((n: any) => ({
          id: `combo:${n.id}`,
          res: n.detect.any.map((p: string) => new RegExp(p, 'i')),
        }));
    } catch {
      detectors = [];
    }
  }
  for (const d of detectors ?? []) {
    if (d.res.some(re => re.test(tool))) {
      if (db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(d.id)) return d.id;
    }
  }
  return null;
}

/**
 * Records one observed failure, and — when it can be attributed — the deficit
 * that goes with it.
 *
 * Two writes on purpose. The signal is always kept, so the unattributed count
 * is honest; the `session_learning` row is written only when there is a real
 * capability to hang it on, so `ambit status` and `ambit deficits` keep meaning
 * what they meant. Best-effort throughout: telemetry must never take down the
 * session that produced it.
 */
function captureFailure(db: Db, input: RawFailure) {
  const classified = classifySignal(input);
  if (!classified) return { recorded: false, reason: 'no capability signal in this failure' };

  const capability =
    (input.capabilityId &&
      db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(input.capabilityId) &&
      input.capabilityId) ||
    attribute(db, input.tool);

  db.prepare(
    `INSERT INTO failure_signals (source, session_id, tool, class, signal, capability_id, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.source || 'unknown',
    input.sessionId || null,
    input.tool || null,
    classified.class,
    classified.signal,
    capability,
    (input.message || '').slice(0, 300) || null
  );

  if (capability) {
    db.prepare(
      `INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes)
       VALUES (?, ?, ?, 0, ?)`
    ).run(
      input.sessionId || 'observed',
      capability,
      blockedAction(classified.class),
      `${classified.signal}${input.tool ? ` · ${input.tool}` : ''}`
    );
  }

  return {
    recorded: true,
    class: classified.class,
    signal: classified.signal,
    capability: capability || 'unattributed',
  };
}

/**
 * What has been failing, without anyone having recorded anything.
 *
 * The unattributed half is deliberately prominent: a tool failing repeatedly
 * that the model cannot name is a gap in the model, and hiding it would make
 * Ambit look more complete than it is.
 */
function signalReport(db: Db, days = 30) {
  const window = `-${Number(days) > 0 ? Number(days) : 30} days`;
  const total = db
    .prepare("SELECT COUNT(*) AS n FROM failure_signals WHERE timestamp >= datetime('now', ?)")
    .get(window);
  if (!total?.n) {
    return {
      note: 'No failure signals observed. Install the telemetry bridge (plugins/ambit-telemetry.js) and the ledger fills itself.',
      observed: 0,
    };
  }
  const byClass = db
    .prepare(
      `SELECT class, signal, COUNT(*) AS times FROM failure_signals
       WHERE timestamp >= datetime('now', ?)
       GROUP BY class, signal ORDER BY times DESC`
    )
    .all(window);
  const unattributed = db
    .prepare(
      `SELECT tool, class, COUNT(*) AS times, MAX(timestamp) AS last_seen FROM failure_signals
       WHERE capability_id IS NULL AND timestamp >= datetime('now', ?)
       GROUP BY tool, class ORDER BY times DESC LIMIT 10`
    )
    .all(window);
  return {
    observed: total.n,
    window_days: Number(days) || 30,
    by_signal: byClass,
    unattributed: unattributed.length ? unattributed : undefined,
    note: unattributed.length
      ? 'Unattributed signals are tools the curated model does not know. Repeated ones are a gap in the model, not in the environment.'
      : undefined,
  };
}

/**
 * Records the deficit behind a refusal, wherever the refusal was asked for.
 *
 * The MCP tool recorded one and the CLI did not, so the same question had
 * different consequences depending on which surface asked it — and the CLI is
 * where a person asks on an agent's behalf, which is exactly the case worth
 * counting. Both call this now.
 */
function recordRefusal(
  db: Db,
  decision: {
    verdict?: string;
    capability?: string;
    action?: string;
    reason?: string;
    missing?: string[];
  },
  tool?: string
) {
  if (decision.verdict !== 'no') return undefined;
  const recorded = captureFailure(db, {
    source: 'can',
    tool: tool || decision.action,
    errorKind: decision.missing?.length ? 'missing_tool' : 'permission_denied',
    message: decision.reason,
    capabilityId: decision.capability,
  });
  return recorded.recorded ? recorded.class : false;
}

export {
  classifySignal,
  attribute,
  captureFailure,
  recordRefusal,
  signalReport,
  SIGNALS,
  type RawFailure,
};
