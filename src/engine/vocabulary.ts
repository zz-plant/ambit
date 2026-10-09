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

import { shellQuote } from '../shared/shell.ts';
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

/** The lifecycle of a reached node no check has run against yet. */
const CONFIGURED = 'configured';

/**
 * Lifecycles that mean reached and not proven: no check has run yet, or the
 * last one passed after recent failures. With PROVEN and FAILING this is
 * every lifecycle a reached node can be derived into; a reached node with
 * none of them carries no check of its own (an MCP server, a model, a
 * runtime), and a check runs on the capability it provides.
 */
const UNPROVEN = [CONFIGURED, ...RECOVERING] as const;

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
const UNPROVEN_SQL = `lifecycle IN (${sqlList(UNPROVEN)})`;

/**
 * The kinds a summary counts: everything but an action, a credential and a
 * person. An action is conferred by a capability and counted through it, and
 * the kinds the frontier leaves out are left out here, so declaring either
 * never moves a reach. The head of a report, its evidence rows and its domain
 * totals take this one fragment, so they count one set of nodes.
 */
const COUNTED_SQL = `kind NOT IN (${sqlList(['action', ...NON_FRONTIER_KINDS])})`;

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
 * The command that runs a node's check again, as a surface prints it.
 *
 * A device or service the infrastructure manifest names has no command for
 * `ambit verify` to run: its check is `ambit incidents` asking the URL the
 * manifest gives it. The seed names those nodes `device:` and `svc:`, and
 * nothing else writes either prefix, so the id is enough to tell. Everything
 * else is `ambit verify`, with the id made safe to paste.
 */
const PROBE_COMMAND = 'ambit incidents';

function recheckCommand(id: string): string {
  if (id.startsWith('device:') || id.startsWith('svc:')) return PROBE_COMMAND;
  return `ambit verify ${shellQuote(id.replace(/^combo:/, ''))}`;
}

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
 * byte-identical. The nodes counted are the ones `COUNTED_SQL` names.
 *
 * Proven, unproven, failing and entries split the reached figure four ways,
 * so a report that prints all four prints a column that adds up to its head.
 * Reached counts the config's own entries as well as the curated capabilities
 * they provide, and the evidence rows under it counted only what carries a
 * check, so `ambit status` read "39 reached" over rows summing to 15. An
 * entry is the rest: reached, with no check of its own.
 */
interface GraphCounts {
  total: number;
  reached: number;
  proven: number;
  unproven: number;
  failing: number;
  entries: number;
}

function graphCounts(db: { prepare(sql: string): { get(...p: unknown[]): any } }): GraphCounts {
  const of = (test: string) => `SUM(CASE WHEN ${REACHED_SQL} AND ${test} THEN 1 ELSE 0 END)`;
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN ${REACHED_SQL} THEN 1 ELSE 0 END) AS reached,
                ${of(PROVEN_SQL)} AS proven,
                ${of(UNPROVEN_SQL)} AS unproven,
                ${of(FAILING_SQL)} AS failing,
                ${of(`lifecycle NOT IN (${sqlList([...PROVEN, ...UNPROVEN, ...FAILING])})`)} AS entries
         FROM capabilities WHERE ${COUNTED_SQL}`
      )
      .get();
    return {
      total: row?.total ?? 0,
      reached: row?.reached ?? 0,
      proven: row?.proven ?? 0,
      unproven: row?.unproven ?? 0,
      failing: row?.failing ?? 0,
      entries: row?.entries ?? 0,
    };
  } catch {
    return { total: 0, reached: 0, proven: 0, unproven: 0, failing: 0, entries: 0 };
  }
}

/**
 * Characters to a token, for every token count the engine states.
 *
 * Roughly four, which is close enough to hold a budget and to compare one
 * tool server's listing with another's. The briefing caps itself with it and
 * `ambit weigh` estimates with it, so the two figures are on one scale; a
 * tokenizer would be more exact and a different one per model.
 */
const CHARS_PER_TOKEN = 4;

/** A token estimate from a length in characters, rounded up. */
const tokensOf = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

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

/**
 * The runtime a run's `source` says recorded its tokens, as a surface names it.
 * A Claude Code session's run is begun by whichever reaches it first, the
 * plugin's hooks or the reading of its transcript, and each agent whose
 * session logs are read (src/engine/session-logs.ts) writes its own, so the
 * token figure can say whose counts it draws. A source on no list is shown as
 * written.
 */
const TOKEN_SOURCES: Readonly<Record<string, string>> = {
  'claude-code-hook': 'Claude Code',
  'claude-code-log': 'Claude Code',
  'codex-log': 'Codex',
  'opencode-log': 'OpenCode',
  'amp-log': 'Amp',
};

export {
  REACHED_STATES,
  FAILING,
  RECOVERING,
  PROVEN,
  CONFIGURED,
  UNPROVEN,
  REACHED_SQL,
  isReached,
  FAILING_SQL,
  RECOVERING_SQL,
  PROVEN_SQL,
  UNPROVEN_SQL,
  COUNTED_SQL,
  CHECK_RUN,
  CHECK_RUN_SQL,
  PROBE_COMMAND,
  recheckCommand,
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
  CHARS_PER_TOKEN,
  tokensOf,
  TOKEN_SOURCES,
};
