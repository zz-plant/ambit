/**
 * What the ledger recorded in the last few hours, as a short receipt.
 *
 * It used to count every capability whose check is failing as an intercepted
 * loop worth 28,000 tokens, so a graph nobody had used yet printed dollars
 * saved. Its two ledger queries also named columns those tables do not have,
 * failed, and were caught as zero, so that estimate was the only figure it
 * ever showed. It now counts what was recorded and prices none of it: nothing
 * records what a stopped call would have cost, and an absent value is never
 * rendered as a value (AGENTS.md rule 16).
 */
import type { Db } from './db.ts';
import { telemetryBridgeInstall } from './paths.ts';
import { FAILING_SQL, REACHED_SQL, graphCounts } from './vocabulary.ts';

export interface SessionReceipt {
  timestamp: string;
  hours: number;
  summary: string;
  /** Distinct capabilities the ledger recorded a use of in the window. */
  capabilities_used: number;
  /**
   * Calls stopped before they ran: an `ambit can` or `ambit_can` refusal, or
   * a control plane block. Only what was recorded, so a gate that answered
   * and wrote nothing is not in it.
   */
  intercepted: number;
  /** Failures a runtime reported after a call had run. */
  failures_reported: number;
  verified_ratio: string;
  /** Reached capabilities whose check is failing now: a fact about the graph, not the window. */
  failing_now: string[];
  note?: string;
}

/** One count from the ledger, or zero for a graph whose ledger tables are older than the query. */
function count(db: Db, sql: string, hours: number): number {
  try {
    return (db.prepare(sql).get(`-${hours} hours`) as { n?: number } | undefined)?.n ?? 0;
  } catch {
    return 0;
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function runReceipt(db: Db, hours = 1): SessionReceipt {
  const counts = graphCounts(db);

  const used = count(
    db,
    `SELECT COUNT(DISTINCT capability_id) AS n FROM capability_use
     WHERE used_at >= datetime('now', ?)`,
    hours
  );
  // A refusal from the decision API is filed as a failure signal from `can`,
  // and the control plane writes an `intercept` event when it blocks a call.
  // Both happened before anything ran, so they are the interceptions. Every
  // other failure signal is a call that ran and failed.
  const refused = count(
    db,
    `SELECT COUNT(*) AS n FROM failure_signals
     WHERE source = 'can' AND timestamp >= datetime('now', ?)`,
    hours
  );
  const blocked = count(
    db,
    `SELECT COUNT(*) AS n FROM work_events
     WHERE kind = 'intercept' AND at >= datetime('now', ?)`,
    hours
  );
  const failed = count(
    db,
    `SELECT COUNT(*) AS n FROM failure_signals
     WHERE source != 'can' AND timestamp >= datetime('now', ?)`,
    hours
  );
  const intercepted = refused + blocked;

  let failingNow: string[] = [];
  try {
    failingNow = db
      .prepare(
        `SELECT name FROM capabilities WHERE ${REACHED_SQL} AND ${FAILING_SQL} ORDER BY name`
      )
      .all<{ name: string }>()
      .map(r => r.name);
  } catch {
    failingNow = [];
  }

  const window = hours === 1 ? 'the last hour' : `the last ${hours} hours`;
  const nothing = used === 0 && intercepted === 0 && failed === 0;
  const summary = nothing
    ? `Ambit Session Receipt: nothing recorded in ${window}.`
    : `Ambit Session Receipt for ${window}: ${plural(used, 'capability', 'capabilities')} used, ${plural(intercepted, 'call', 'calls')} stopped before running, ${plural(failed, 'failure', 'failures')} reported.`;

  return {
    timestamp: new Date().toISOString(),
    hours,
    summary,
    capabilities_used: used,
    intercepted,
    failures_reported: failed,
    verified_ratio: `${counts.proven}/${counts.reached}`,
    failing_now: failingNow,
    ...(nothing
      ? {
          note: `Use and failures reach the ledger through a telemetry bridge, and a refusal through ambit can or the control plane. In OpenCode: ${telemetryBridgeInstall()}`,
        }
      : {}),
  };
}
