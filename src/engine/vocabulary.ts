/**
 * The words the engine counts with, in one place.
 *
 * Several modules had grown their own copy of the same handful of facts: which
 * states mean *reached*, which lifecycles mean *failing*, which kinds of human
 * intervention are middleware and which are keepers. Each copy was correct
 * when written and each was a place the next change could miss — the
 * visualiser already counted reached as *not locked* where every other surface
 * counted it as *unlocked or active*, which agree only because a third state
 * has never been added.
 *
 * A vocabulary that lives in one file cannot drift. Anything that needs it in
 * SQL takes the fragment from here rather than spelling the list again.
 */

/** States that mean the system can reach a capability. */
const REACHED_STATES = ['unlocked', 'active'] as const;

/** Lifecycles that mean configured-but-not-working. */
const FAILING = ['degraded', 'broken'] as const;

/** Lifecycles that mean a check has passed. */
const PROVEN = ['verified', 'reliable'] as const;

/** A quoted, comma-separated list for an SQL `IN (…)`. */
const sqlList = (values: readonly string[]) => values.map(v => `'${v}'`).join(',');

/** `state IN ('unlocked','active')`, so no surface has to spell it again. */
const REACHED_SQL = `state IN (${sqlList(REACHED_STATES)})`;
const FAILING_SQL = `lifecycle IN (${sqlList(FAILING)})`;
const PROVEN_SQL = `lifecycle IN (${sqlList(PROVEN)})`;

/**
 * The counts every summary reports, from one query.
 *
 * `ambit status`, the briefing, the MCP stats and context tools and the
 * visualiser's live stream each carried their own copy of this, two of them
 * byte-identical. Action nodes are excluded from reach because an action is
 * conferred by a capability rather than acquired, and counting both would
 * report the same thing twice.
 */
interface GraphCounts {
  total: number;
  reached: number;
  proven: number;
  failing: number;
}

function graphCounts(db: { prepare(sql: string): { get(...p: unknown[]): any } }): GraphCounts {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN ${REACHED_SQL} THEN 1 ELSE 0 END) AS reached,
                SUM(CASE WHEN ${PROVEN_SQL} THEN 1 ELSE 0 END) AS proven,
                SUM(CASE WHEN ${FAILING_SQL} THEN 1 ELSE 0 END) AS failing
         FROM capabilities WHERE kind != 'action'`
      )
      .get();
    return {
      total: row?.total ?? 0,
      reached: row?.reached ?? 0,
      proven: row?.proven ?? 0,
      failing: row?.failing ?? 0,
    };
  } catch {
    return { total: 0, reached: 0, proven: 0, failing: 0 };
  }
}

/**
 * What a person is told when the graph has never been built here.
 *
 * There were four of these, offering three different fixes — the CLI seeded
 * silently, the briefing said `ambit seed`, the MCP server said seed or
 * bootstrap, and the API said bootstrap. A reader who saw two of them had to
 * work out which was current. The fix varies by surface, so it stays a
 * parameter; the meaning does not, so it does not.
 */
const NOT_SEEDED =
  'Ambit has not run here. This is not an environment without capabilities — do not report the stack as empty.';

function notSeeded(fix = 'ambit seed') {
  return { graph: 'not seeded', meaning: NOT_SEEDED, fix };
}

/**
 * Kinds of human intervention.
 *
 * Middleware kinds are the human acting as a duct: recurring instances are a
 * fixable gap. Judgment and knowledge are what a person is actually for, and
 * nothing may ever propose removing them however often they recur. This list
 * existed twice under two names and a third time as a subset.
 */
const MIDDLEWARE_KINDS = new Set([
  'clerical',
  'exception',
  'physical',
  'authority',
  'approval',
  'application',
  'permission block',
]);

const KEEPER_KINDS = new Set(['judgment', 'knowledge']);

/** The middleware kinds that are a person being asked for permission. */
const GATE_KINDS = ['authority', 'approval', 'permission block'] as const;

export {
  REACHED_STATES,
  FAILING,
  PROVEN,
  REACHED_SQL,
  FAILING_SQL,
  PROVEN_SQL,
  sqlList,
  graphCounts,
  type GraphCounts,
  NOT_SEEDED,
  notSeeded,
  MIDDLEWARE_KINDS,
  KEEPER_KINDS,
  GATE_KINDS,
};
