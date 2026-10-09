/**
 * What an agent knows about this environment before its first tool call.
 * Roadmap §12.1, and the heartbeat of §12.7.
 *
 * Every other command in this project answers a question. This one answers the
 * question nobody asks, because the agent that most needs the answer does not
 * know Ambit is there: it hits a missing binary mid-task, works around it, and
 * hits the same one next week. A briefing is what a colleague gets on their
 * first morning — what works, what is broken, what is waiting on you, what we
 * are doing next — and it has to arrive unrequested to be worth anything.
 *
 * Two constraints shape it. It has to be short enough to sit in a system prompt
 * without displacing the work, so it is capped and the cap is enforced rather
 * than hoped for. And every line has to be actionable or absent: a briefing
 * that lists thirty reached capabilities teaches an agent to skip briefings.
 */
import type { Db } from './db.ts';
import { evaluatePromotions } from './assure/promote.ts';
import { recovering } from './assure/lifecycle.ts';
import { listProposals } from './governance.ts';
import { ledgerSince } from './ledger.ts';
import { andList, nextSteps } from './next.ts';
import { council, councilLines } from './council.ts';
import { signalReport } from './failures.ts';
import { CHARS_PER_TOKEN, FAILING_SQL, REACHED_SQL, graphCounts, notSeeded } from './vocabulary.ts';

const TOKEN_BUDGET = 1200;

/** When this environment was last briefed, so "since" means something. */
function lastBriefingAt(db: Db): string | null {
  try {
    return (
      db.prepare("SELECT value FROM schema_meta WHERE key = 'last-briefing'").get()?.value ?? null
    );
  } catch {
    return null;
  }
}

function markBriefed(db: Db) {
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('last-briefing', datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = datetime('now')`
  ).run();
}

/**
 * The briefing, as data.
 *
 * Composed from the reports that already exist rather than from new queries, so
 * a briefing cannot disagree with the command a reader runs to check it. The
 * one thing it does that a report does not is apply pending authority
 * thresholds — asking what the environment is like is the right moment for a
 * promotion someone already authorised to take effect.
 */
function briefing(db: Db, options: { mark?: boolean } = {}) {
  const seeded = db.prepare('SELECT COUNT(*) AS n FROM capabilities').get()?.n ?? 0;
  if (!seeded) return { environment: 'not seeded', ...notSeeded() };

  const g = graphCounts(db);

  // A contract action whose check fails is the finest-grained thing this model
  // can say is broken, so the list below names it. It is not counted with the
  // capabilities, though: the figure beside "reached" is a count of those, the
  // one `ambit status` and `ambit_stats` print, and an agent that reads two
  // numbers for "failing" on one machine believes neither. A failing action is
  // counted after it instead, which also keeps "0 failing" from sitting above
  // a list that names one.
  const broken = db
    .prepare(
      `SELECT id, name, kind FROM capabilities
       WHERE ${REACHED_SQL} AND ${FAILING_SQL} ORDER BY kind, name LIMIT 5`
    )
    .all<any>();
  const failingActions =
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM capabilities
         WHERE kind = 'action' AND ${REACHED_SQL} AND ${FAILING_SQL}`
      )
      .get<any>()?.n ?? 0;

  const back = recovering(db).slice(0, 5);

  // A threshold a person set earlier takes effect here. The alternative is a
  // promotion that waits for someone to run a command, which is the
  // confirmation prompt it was meant to replace.
  const authority = evaluatePromotions(db);

  const proposals = listProposals(db);
  const waiting = Array.isArray(proposals)
    ? (proposals as any[]).filter(p => p.status === 'draft' || p.status === 'approved')
    : [];

  const since = lastBriefingAt(db);
  const moved = since ? (ledgerSince(db, since) as any) : null;

  // What the last stretch of work ran into, whether or not anyone recorded it
  // deliberately. The unattributed count is kept: repeated failures Ambit
  // cannot name are a gap in the model, and hiding them would flatter it.
  const signals = signalReport(db, 7) as any;
  const recent = db
    .prepare(
      `SELECT c.name, COUNT(*) AS times FROM session_learning s
       JOIN capabilities c ON c.id = s.capability_id
       WHERE (s.action = 'blocked' OR s.action LIKE 'blocked:%')
         AND s.timestamp >= datetime('now', '-7 days')
       GROUP BY s.capability_id ORDER BY times DESC LIMIT 3`
    )
    .all<any>();

  const curriculum = nextSteps(db, 3) as any;
  // The seats that are against the first step, if any. The frontier's
  // recommendation and the fragility report were two reports read at different
  // times; an agent about to draft a proposal should hear both at once.
  const seats = councilLines(council(db));

  if (options.mark) markBriefed(db);

  return {
    environment:
      `${g.reached}/${g.total} capabilities reached · ${g.proven} proven · ${g.failing} failing` +
      (failingActions
        ? ` · ${failingActions} failing ${failingActions === 1 ? 'action' : 'actions'}`
        : ''),
    broken: broken.length ? broken.map(b => ({ id: b.id, name: b.name })) : undefined,
    // Usable, and counted as such above. Named, so an agent that meets a
    // failure from one knows its record was already mixed.
    recovering: back.length ? back : undefined,
    waiting_on_a_person: waiting.length
      ? waiting.slice(0, 3).map(p => ({ id: p.id, goal: p.goal, status: p.status }))
      : undefined,
    blocked_recently: recent.length ? recent.map(r => `${r.name} ×${r.times}`) : undefined,
    unattributed_failures: signals.unattributed?.length
      ? signals.unattributed.slice(0, 3).map((u: any) => `${u.tool || 'unknown'} ×${u.times}`)
      : undefined,
    next: curriculum.next?.slice(0, 3),
    council: seats.length ? seats[0] : undefined,
    since_last_briefing:
      moved?.gained?.length || moved?.emergent?.length
        ? {
            gained: moved.gained.map((c: any) => c.name).slice(0, 5),
            emergent: moved.emergent.map((c: any) => c.name).slice(0, 5),
            diminished: moved.diminished?.map((c: any) => c.name).slice(0, 5),
          }
        : undefined,
    authority_changed:
      authority.promoted.length || authority.demoted.length ? authority : undefined,
    before_acting:
      'Call ambit_can with the capability before running a tool you have not used this session. yes: act. ask: put it to the person. no: it records the deficit, so do not retry it under another name.',
  };
}

/**
 * One next step as the agent hears it: what it costs, how often it has
 * blocked work, and what reaching it would let the agent reach. `why` says the
 * same about "it" for a person reading `ambit next`; this says it to the
 * reader who would do the reaching, so the step reads as an after it can
 * picture and put to the person. Three names at most, the rest counted, since
 * the line shares a budget with what is broken.
 */
function nextSentence(n: any): string {
  const reaches: string[] = n.reaches ?? [];
  const opens: string[] = n.opens ?? [];
  const becomes = (names: string[]) =>
    `${andList(names, 3)} would become ${names.length === 1 ? 'a next step' : 'next steps'}`;
  const after = reaches.length
    ? `With it you would also reach ${andList(reaches, 3)}${opens.length ? `, and ${becomes(opens)}` : ''}.`
    : opens.length
      ? `With it, ${becomes(opens)}.`
      : '';
  if (!after) return `${n.capability} (${n.cost}): ${n.why}`;
  const blocked = n.blocked_times
    ? `It has blocked work ${n.blocked_times} ${n.blocked_times === 1 ? 'time' : 'times'}. `
    : '';
  return `${n.capability} (${n.cost}): ${blocked}${after}`;
}

/** One line, or nothing. Keeps the composition below free of empty bullets. */
function line(label: string, value?: string | null): string | null {
  return value ? `${label}: ${value}` : null;
}

/**
 * The briefing as the prose an agent is given.
 *
 * Prose with ids rather than JSON: an agent quotes a sentence and a person
 * skims one, where both have to parse a nested object. Truncated to the token
 * budget from the bottom, because the order below is the order of usefulness —
 * what is broken outranks what we might do next.
 */
function briefingText(db: Db, options: { mark?: boolean } = {}): string {
  const b = briefing(db, options) as any;
  if (b.environment === 'not seeded') {
    return `Ambit has not run in this environment. Run \`ambit seed\` before reporting what this system can do — an unseeded graph is not an environment without capabilities.`;
  }

  const parts: Array<string | null> = [
    `Ambit · ${b.environment}.`,
    line(
      'Broken',
      b.broken?.map((x: any) => `${x.name} (${x.id})`).join(', ') &&
        `${b.broken.map((x: any) => `${x.name} (${x.id})`).join(', ')} — configured, failing their checks, excluded from plans and authority until re-verified`
    ),
    line(
      'Recovering',
      b.recovering
        ?.map((x: any) => `${x.name} (${x.id}), ${x.recent}`)
        .join('; ')
        .concat(' — usable, their last check passed after a failure')
    ),
    line(
      'Waiting on a person',
      b.waiting_on_a_person?.map((p: any) => `${p.goal} [${p.id}, ${p.status}]`).join('; ')
    ),
    line('Blocked recently', b.blocked_recently?.join(', ')),
    line(
      'Failing without a name',
      b.unattributed_failures?.length
        ? `${b.unattributed_failures.join(', ')} — tools the model does not know yet`
        : null
    ),
    line(
      'Since the last briefing',
      b.since_last_briefing
        ? [
            b.since_last_briefing.gained?.length
              ? `gained ${b.since_last_briefing.gained.join(', ')}`
              : null,
            b.since_last_briefing.emergent?.length
              ? `emerged ${b.since_last_briefing.emergent.join(', ')}`
              : null,
            b.since_last_briefing.diminished?.length
              ? `diminished ${b.since_last_briefing.diminished.join(', ')}`
              : null,
          ]
            .filter(Boolean)
            .join('; ')
        : null
    ),
    line(
      'Authority changed',
      b.authority_changed
        ? [
            ...b.authority_changed.promoted.map(
              (p: any) => `${p.capability} ${p.action} now runs unattended on ${p.on_evidence}`
            ),
            ...b.authority_changed.demoted.map(
              (d: any) => `${d.capability} ${d.action} is back to confirm — ${d.reason}`
            ),
          ].join('; ')
        : null
    ),
    b.next?.length ? `Next: ${b.next.map(nextSentence).join(' · ')}` : null,
    b.council || null,
    b.before_acting,
  ];

  let text = parts.filter(Boolean).join('\n');
  const cap = TOKEN_BUDGET * CHARS_PER_TOKEN;
  if (text.length > cap) {
    // Trim whole lines from the bottom, never mid-sentence: half a sentence
    // about what is broken is worse than no sentence about what is next.
    const kept: string[] = [];
    let used = 0;
    for (const l of text.split('\n')) {
      if (used + l.length + 1 > cap) break;
      kept.push(l);
      used += l.length + 1;
    }
    text = kept.join('\n');
  }
  return text;
}

export { briefing, briefingText, lastBriefingAt, TOKEN_BUDGET };
