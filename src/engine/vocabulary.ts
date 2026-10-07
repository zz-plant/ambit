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

import { NON_FRONTIER_KINDS } from './ontology.ts';

/** States that mean the system can reach a capability. */
const REACHED_STATES = ['unlocked', 'active'] as const;

/**
 * Lifecycles that mean configured-but-not-working: the last check failed.
 *
 * The latest check decides. `degraded` was on this list as well, so a
 * capability fixed after a token rotation stayed out of every plan,
 * permission and ranking until its last five runs had passed, each one typed
 * by hand. That protected nothing: the most recent run is the best evidence
 * of whether it works now.
 *
 * A plan's `degraded` list, `blocked_by_degraded`, and the `degraded` fields of
 * `ambit status`, `ambit doctor`, a near miss, a portfolio row and `/api/loop`
 * are older than this rule. They are wire names, kept so that nothing reading
 * them breaks, and they hold what this list says: the nodes whose last check
 * failed.
 */
const FAILING = ['broken'] as const;

/**
 * Lifecycles that mean recovering: the last check passed, and some of the
 * recent ones did not. Usable, because the latest check decides, and not
 * proven, because its evidence is mixed, so a summary counts it with the
 * unproven and says, where it names one, how many of its recent runs passed.
 */
const RECOVERING = ['degraded'] as const;

/** Lifecycles that mean a check has passed. */
const PROVEN = ['verified', 'reliable'] as const;

/** A quoted, comma-separated list for an SQL `IN (…)`. */
const sqlList = (values: readonly string[]) => values.map(v => `'${v}'`).join(',');

/** `state IN ('unlocked','active')`, so no surface has to spell it again. */
const REACHED_SQL = `state IN (${sqlList(REACHED_STATES)})`;

/** The same test in JavaScript, for a state read out of a stored observation. */
const isReached = (state: string | null | undefined): boolean =>
  (REACHED_STATES as readonly string[]).includes(state ?? '');
const FAILING_SQL = `lifecycle IN (${sqlList(FAILING)})`;
const RECOVERING_SQL = `lifecycle IN (${sqlList(RECOVERING)})`;
const PROVEN_SQL = `lifecycle IN (${sqlList(PROVEN)})`;

/**
 * What one run of a declared check is recorded as, in `session_learning.action`.
 *
 * A run passed or it failed; a capability that declares no check writes no row
 * at all. These are actions in the evidence table and not lifecycles, which is why
 * `verified` appears here and in PROVEN with two different meanings. Whatever
 * asks which rows are check runs takes the fragment, and whatever reads the
 * outcome of one takes the word.
 */
const CHECK_RUN = { passed: 'verified', failed: 'failed' } as const;
const CHECK_RUN_SQL = `action IN (${sqlList([CHECK_RUN.passed, CHECK_RUN.failed])})`;

/**
 * The capability a row of `session_learning` is about, as an SQL expression
 * over the row aliased `s`.
 *
 * A decision is filed under the person who made it: `capability_id` on an
 * approval or an apply holds `human:…`, which is how the audit trail finds a
 * person's acts. Reading that column as a capability made the person the
 * subject, and the opportunity ranking led with "Automate you, at the
 * browser". The proposal named in the row's notes says what the decision was
 * about: its goal, the last of its steps.
 */
const DECIDED_CAPABILITY_SQL = `CASE WHEN s.session_id IN ('approval', 'apply')
  THEN (SELECT json_extract(p.steps, '$[#-1].id') FROM proposals p
        WHERE substr(s.notes, 1, length(p.id) + 1) = p.id || ':')
  ELSE s.capability_id END`;

/**
 * The counts every summary reports, from one query.
 *
 * `ambit status`, the briefing, the MCP stats and context tools and the
 * visualiser's live stream each carried their own copy of this, two of them
 * byte-identical. Action nodes are excluded from reach because an action is
 * conferred by a capability and not acquired, and counting both would report
 * the same thing twice. The kinds the frontier leaves out, a credential and a
 * person, are left out here too, so declaring either never moves a reach.
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
         FROM capabilities WHERE kind NOT IN (${sqlList(['action', ...NON_FRONTIER_KINDS])})`
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

/**
 * What the audit trail says came of an event, where the ledger recorded it.
 *
 * The tone is whether it went the way it was meant to, and the page draws it
 * as a shape beside the word, so an outcome is never told by colour alone. An
 * event whose record states no result is given no outcome at all.
 */
const AUDIT_OUTCOMES = {
  signed: { word: 'signed', tone: 'good' },
  passed: { word: 'check passed', tone: 'good' },
  failed: { word: 'check failed', tone: 'bad' },
  widened: { word: 'grant widened', tone: 'good' },
  narrowed: { word: 'grant narrowed', tone: 'bad' },
  upheld: { word: 'objection upheld', tone: 'neutral' },
  refused: { word: 'objection refused', tone: 'neutral' },
} as const;

/**
 * The acts whose verb is itself a result, and the outcome each one records: a
 * check writes `verified` or `failed`, and a grant that moved on evidence
 * writes `promoted` or `demoted`.
 */
const ACT_OUTCOMES: Readonly<Record<string, keyof typeof AUDIT_OUTCOMES>> = {
  verified: 'passed',
  failed: 'failed',
  promoted: 'widened',
  demoted: 'narrowed',
};

/**
 * How a run's recorded outcome reads. A producer writes its own word, such as
 * `completed`, `resolved` or `blocked_unauthorized`. A word on neither list
 * is shown as written and marked neither way: the trail does not guess.
 */
const RUN_SUCCEEDED = ['success', 'succeeded', 'completed', 'resolved', 'recovered', 'achieved'];
const RUN_FAILED = ['failure', 'failed', 'error', 'abandoned', 'blocked_unauthorized'];

export {
  REACHED_STATES,
  FAILING,
  RECOVERING,
  PROVEN,
  REACHED_SQL,
  isReached,
  FAILING_SQL,
  RECOVERING_SQL,
  PROVEN_SQL,
  CHECK_RUN,
  CHECK_RUN_SQL,
  DECIDED_CAPABILITY_SQL,
  sqlList,
  graphCounts,
  type GraphCounts,
  NOT_SEEDED,
  notSeeded,
  MIDDLEWARE_KINDS,
  KEEPER_KINDS,
  GATE_KINDS,
  AUDIT_OUTCOMES,
  ACT_OUTCOMES,
  RUN_SUCCEEDED,
  RUN_FAILED,
};
