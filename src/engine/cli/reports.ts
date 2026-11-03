/**
 * The two reports the CLI composes itself rather than delegating to the engine,
 * and the glossary behind `ambit help <term>`.
 *
 * `statusReport` is what `ambit status` answers with; `evidenceReport` is the
 * part of it that separates what the graph can prove from what it merely
 * lists. Both read several engine modules and shape one answer, which is why
 * they live beside the CLI rather than in the engine. `renderStatus` is how
 * that answer looks to a person; `--json` and the tests get the data.
 * `briefReport` and `renderBrief` are the short screen bare `ambit` shows:
 * what was read, what one more step opens, and what to check before leaning
 * on it, with the rest of `status` one command away.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shellQuote } from '../../shared/shell.ts';
import { formatCount } from '../../shared/format.ts';
import { ENGINE_DIR, loadTechTree } from '../paths.ts';
import { findBottlenecks, singlePointsOfFailure } from '../inference.ts';
import { ledgerHistory, ledgerSince } from '../ledger.ts';
import { deficits } from '../planning.ts';
import { listProposals } from '../governance.ts';
import { nextSteps, readableCost } from '../next.ts';
import { C, formatGeneric, terminalPalette, type Palette } from './output.ts';
import { commandHelp } from './help.ts';
import { ALIASES, commandWords } from './groups.ts';
import type { DoctorReport } from '../doctor.ts';
import { markSeen, movedLines, unseenSince } from './seed.ts';
import { seedSources } from '../discovery.ts';
import { checkableNames, recovering } from '../assurance.ts';
import type { usageWindows } from '../telemetry.ts';
import {
  CHECK_RUN_SQL,
  COUNTED_SQL,
  FAILING_SQL,
  PROBE_COMMAND,
  REACHED_SQL,
  graphCounts,
  isReached,
  ownReached,
  reachPhrase,
  recheckCommand,
} from '../vocabulary.ts';

/** "2h ago" from a SQLite timestamp, because a raw ISO string answers nothing at a glance. */
function ago(ts: string | null | undefined): string | undefined {
  if (!ts) return undefined;
  const ms = Date.now() - new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z').getTime();
  if (!(ms >= 0)) return undefined;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / (60 * 24))}d ago`;
}

/**
 * What the graph can prove versus what it merely lists.
 *
 * Reached nodes split by the worth of their evidence: verified (check passed),
 * unverified (configured and never checked, or recovering: the last run passed
 * and recent ones did not), failing (the last check failed), and entries,
 * which carry no check of their own. The four are `graphCounts`'s, so they add
 * up to the reached figure the head prints. The unverified-with-a-declared-check
 * set is named, because it is the one a single command turns into evidence —
 * and an inventory that cannot say "installed is not working" is the failure
 * this project exists to prevent.
 */
function evidenceReport(db: any, checkable: string[] = checkableNames(db)) {
  const { proven, unproven, failing, entries, reached } = graphCounts(db);
  // What every runtime brings: entries, and in no one's config, so the row
  // that counts entries says how many of them these are.
  const builtIn = reached - graphCounts(db, 'tree').reached - ownReached(db);
  // The unproven, split by what would move each: a check never run, a check
  // passing again after failures, or no check at all. The third is the
  // remainder, which is why `checkableNames` and `recovering` count over the
  // same nodes.
  const recoveringNow = recovering(db).length;

  const last = db
    .prepare(`SELECT MAX(timestamp) AS t FROM session_learning WHERE ${CHECK_RUN_SQL}`)
    .get();

  return {
    proven,
    unproven,
    failing,
    entries,
    built_in: builtIn,
    recovering: recoveringNow,
    no_check: unproven - recoveringNow - checkable.length,
    last_check: ago(last?.t) || 'never',
    provable_now: checkable,
    note: checkable.length
      ? `configured is not working — ambit verify would turn ${checkable.length} of the unverified into evidence`
      : undefined,
  };
}

/**
 * What is wrong, as the short phrases a summary line joins, in the order a
 * person would fix them. The report's `summary` and the line `renderStatus`
 * draws both take their worries from here, so the two cannot disagree about
 * what counted.
 */
function worries(found: { failing: number; spofs?: unknown; pending?: unknown[] }): string[] {
  return [
    found.failing ? `${found.failing} failing` : null,
    Array.isArray(found.spofs) && found.spofs.length
      ? `${found.spofs.length} with a single provider`
      : null,
    found.pending?.length ? `${found.pending.length} awaiting approval` : null,
  ].filter((w): w is string => w !== null);
}

/** One command to type, and the sentence that says why it is that one. */
interface NextMove {
  command: string;
  why: string;
}

/**
 * The one thing to type after reading the report, taken from what the report
 * found and not from a list of tips.
 *
 * In the order a person would fix things. A check that fails comes first,
 * because nothing built on it can be trusted. A draft waiting on a decision
 * comes next, since an agent stays idle until someone makes it. Then the
 * checks that turn configured into verified, which is the whole of a fresh
 * install. Last is the capability `ambit next` ranks first. Absent when none
 * of them has anything to say, and the report then ends without the line.
 */
function nextMove(
  db: any,
  found: { degraded: { id: string; name: string }[]; drafts: number; checkable: number }
): NextMove | undefined {
  const [first] = found.degraded;
  if (first) {
    // One failing check is named; several are re-run together, since the
    // fix for one (a token, a server) is often the fix for the rest. When
    // every one of them is a probe of the manifest, the one command that
    // re-runs them all is the probe.
    const probesOnly = found.degraded.every(d => recheckCommand(d.id) === PROBE_COMMAND);
    return {
      command:
        found.degraded.length === 1
          ? recheckCommand(first.id)
          : probesOnly
            ? PROBE_COMMAND
            : 'ambit verify --failing',
      why:
        found.degraded.length === 1
          ? `${first.name} is configured and failing its check`
          : `${found.degraded.length} capabilities are configured and failing their check, starting with ${first.name}`,
    };
  }
  if (found.drafts) {
    return {
      command: 'ambit proposals --pending',
      why:
        found.drafts === 1
          ? '1 proposal is waiting on a decision'
          : `${found.drafts} proposals are waiting on a decision`,
    };
  }
  if (found.checkable) {
    return {
      command: 'ambit verify',
      why: `turns ${found.checkable} of the unverified into evidence`,
    };
  }
  // The hint is the least important line of a health report, so a failure
  // ranking it must never be the reason the report does not print.
  try {
    const top = (nextSteps(db) as any).next?.[0];
    if (top) {
      return {
        command: `ambit goal ${shellQuote(top.id.replace(/^combo:/, ''))}`,
        why: `${top.capability} is the best next step${top.cost === 'unknown' ? '' : `, about ${top.cost}`}`,
      };
    }
  } catch {
    /* no ranking, no line */
  }
  return undefined;
}

// The report `status` composes. One surface for "how are we doing", so the
// person does not have to learn six commands to answer one question.
function statusReport(db: any) {
  const counts = graphCounts(db);
  const g = { ...counts, verified: counts.proven };
  // Over the nodes the head counts, so the domains' totals add up to its total.
  const domains = db
    .prepare(
      `SELECT domain, COUNT(*) as total, SUM(CASE WHEN ${REACHED_SQL} THEN 1 ELSE 0 END) as reached
       FROM capabilities WHERE ${COUNTED_SQL} GROUP BY domain ORDER BY domain`
    )
    .all();
  const actions = db
    .prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN ${REACHED_SQL} THEN 1 ELSE 0 END) as reached
       FROM capabilities WHERE kind = 'action'`
    )
    .get();

  // Configured but not working: the decision-relevant reading of "decay". A
  // capability whose last check failed is a repair, not an acquisition. These
  // are the nodes `graphCounts` counts as failing, by name, so the head, the
  // evidence row and the line the report ends on all count one set. An action
  // is left out as the summary leaves it out; the capability that confers it
  // is what the report names. The key is `degraded` because scripts read it;
  // the head said "1 failing · 1 degraded" of one node, and says it once now.
  const degraded = db
    .prepare(
      `SELECT id, name, domain FROM capabilities
       WHERE ${COUNTED_SQL} AND ${REACHED_SQL} AND ${FAILING_SQL} ORDER BY id`
    )
    .all();

  const recorded = deficits(db);
  const proposals = listProposals(db);
  const pending = Array.isArray(proposals)
    ? proposals.filter((p: any) => p.status === 'draft' || p.status === 'approved')
    : [];

  // A sentence before the dump. `status` knew the worst thing about the
  // environment — the failing checks, the sole-provider capabilities, the
  // approvals waiting on a person — and made the reader assemble it from
  // eleven nested sections. The fields below still carry all of it.
  // Two more ways things happen without a person. `status` is the one report
  // that claims to say how the environment stands, so it has to count them.
  let sandboxes = 0;
  let budgets = 0;
  try {
    sandboxes = db.prepare('SELECT COUNT(*) AS n FROM sandboxes').get()?.n ?? 0;
  } catch {
    /* database predates sandboxes */
  }
  try {
    budgets = db.prepare('SELECT COUNT(*) AS n FROM budgets WHERE budget_cents > 0').get()?.n ?? 0;
  } catch {
    /* database predates budgets */
  }

  const spofs = singlePointsOfFailure(db);
  const recoveringNow = recovering(db);
  const worried = worries({ failing: g.failing, spofs, pending });
  const checkable = checkableNames(db);

  const reach = reachPhrase(db);
  return {
    // The same sentence the head prints. It read "39/70 capabilities reached",
    // the graph's own count, beside a head saying "15 of 46" of the same setup,
    // so a script and a person were told two different headlines.
    summary: `${reach} · ${worried.length ? worried.join(' · ') : 'nothing failing'}`,
    reach,
    reached: g.reached,
    total: g.total,
    verified: g.verified,
    failing: g.failing,
    // A scalar, not a nested pair. Now that the formatter renders nested
    // objects rather than dropping them, two numbers in a box cost four lines
    // of a report whose job is to be read at a glance.
    actions: actions?.total ? `${actions.reached}/${actions.total} reached` : undefined,
    // An array of one, not an object: the generic renderer prints nested rows
    // and skips nested objects, and this block must reach the reader.
    unattended:
      sandboxes || budgets
        ? [
            {
              sandboxes: sandboxes || undefined,
              standing_budgets: budgets || undefined,
              note: 'ambit authority lists what each one covers.',
            },
          ]
        : undefined,
    evidence: [evidenceReport(db, checkable)],
    domains,
    degraded: degraded.length ? degraded : undefined,
    // Counted with the unverified above, and named here with how their recent
    // runs went, since a pass after a failure reads as fixed.
    recovering: recoveringNow.length ? recoveringNow : undefined,
    spofs,
    // Only what the ranking calls a bottleneck: the rest were rows saying
    // `is bottleneck: false` under the heading that promised bottlenecks.
    bottlenecks: findBottlenecks(db)
      .filter(b => b.is_bottleneck)
      .slice(0, 10),
    // The empty case belongs to `ambit deficits`, which explains how they get
    // recorded. Here it would be a paragraph of advice inside a health report.
    deficits: Array.isArray(recorded) ? recorded : undefined,
    frontier: ledgerHistory(db).slice(-5),
    pending,
    // Last, because it is what the report ends on when a person reads it.
    next: nextMove(db, {
      degraded,
      drafts: pending.filter((p: any) => p.status === 'draft').length,
      checkable: checkable.length,
    }),
  };
}

type StatusReport = ReturnType<typeof statusReport>;

/** The four columns every report in this CLI indents by. */
const GUTTER = '    ';

/**
 * `ambit status` as a person reads it, as lines.
 *
 * The head carries the two numbers that matter, reached and verified, and the
 * worries the report's own summary names. Under a rule come the evidence
 * counts in one aligned column that adds up to the reached figure, with a
 * marker on the one that wants a person: a failing check before an unverified
 * one, since a repair comes before an acquisition. The marker is a character
 * and colour only adds to it, so the row is found in a pipe and by someone
 * who cannot tell the colours apart. A row whose number another line repeats
 * in part says which part, so "11 of the unverified" on the last line has its
 * 11 above it. Whatever else the report found follows as it always has, and
 * the last line is the one thing to type next, taken from the report's `next`.
 *
 * Pure: the palette comes in as a parameter and nothing here reads the
 * terminal, which is what lets a test ask for both renderings.
 */
function renderStatus(report: StatusReport, c: Palette = C): string[] {
  const ev = report.evidence[0];
  // Eighty columns hold the head without its noun, and the rows say what is counted.
  const lead = `${report.reach.replace(' capabilities reached', ' reached')} · ${ev.proven} verified`;
  const worried = worries(report);
  const tail = worried.length ? worried.join(' · ') : 'nothing failing';

  const unprovenParts = [
    ev.provable_now.length ? `${ev.provable_now.length} provable now` : null,
    ev.recovering ? `${ev.recovering} recovering` : null,
    ev.no_check ? `${ev.no_check} with no check` : null,
  ].filter(Boolean);
  const rows: [label: string, value: string, gloss?: string][] = [
    ['verified', String(ev.proven)],
    ['unverified', String(ev.unproven), unprovenParts.join(' · ') || undefined],
    ['failing', String(ev.failing)],
    [
      'entries',
      String(ev.entries),
      !ev.entries
        ? undefined
        : ev.built_in >= ev.entries
          ? 'built into the runtime; checks run on what they provide'
          : ev.built_in
            ? `from your config, and ${ev.built_in} built into the runtime`
            : 'from your config; checks run on what they provide',
    ],
    ['last check', ev.last_check],
  ];
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  const valueWidth = Math.max(...rows.map(([, value]) => value.length));
  const wants = ev.failing ? 'failing' : ev.unproven ? 'unverified' : undefined;

  const head = [
    `${GUTTER}${c.bold}${lead}${c.reset} · ${tail}`,
    `${GUTTER}${c.grey}${'─'.repeat(Math.min(`${lead} · ${tail}`.length, 72))}${c.reset}`,
    ...rows.map(([label, value, gloss]) => {
      const cells = `${label.padEnd(labelWidth)}  ${value.padStart(valueWidth)}`;
      const said = gloss ? `  ${c.grey}${gloss}${c.reset}` : '';
      if (label === wants) return `  ${c.accent}${c.bold}› ${cells}${c.reset}${said}`;
      return label === 'last check'
        ? `${GUTTER}${c.grey}${cells}${c.reset}`
        : `${GUTTER}${c.grey}${label.padEnd(labelWidth)}${c.reset}  ${value.padStart(valueWidth)}${said}`;
    }),
  ];

  // What the head does not say, a row per finding. It fell through to the
  // generic formatter, which printed every field of every record: rows saying
  // `is bottleneck: false` under the bottlenecks heading, Shell Execution twice
  // (the capability and the tool that provides it), `provider id: tool:bash`.
  // The totals of actions and of the frontier ledger led a line each and
  // competed with the head; they stay in `--json`. Each list stops at five and
  // counts the rest, which `--json` holds whole.
  const details: string[] = [];
  const section = (title: string, rows: string[], total = rows.length) => {
    if (!rows.length) return;
    details.push('', `${GUTTER}${c.bold}${title}${c.reset}`);
    for (const row of rows.slice(0, 5)) details.push(`${GUTTER}  ${row}`);
    if (total > 5)
      details.push(`${GUTTER}  ${c.grey}… ${total - 5} more · --json for all${c.reset}`);
  };
  const width = (names: string[]) => Math.min(Math.max(0, ...names.map(n => n.length)), 28);
  const named = (name: string, w: number, rest: string) =>
    `${name.padEnd(w)}  ${c.grey}${rest}${c.reset}`;

  if (ev.provable_now.length) {
    const shown = ev.provable_now.slice(0, 8).join(', ');
    const more = ev.provable_now.length > 8 ? ` and ${ev.provable_now.length - 8} more` : '';
    details.push('', `${GUTTER}${c.bold}Provable now${c.reset}  ${shown}${more}`);
  }
  // The bars are the generic formatter's; the heading is this report's.
  const [, ...domains] = formatGeneric({ domains: report.domains }, c).filter(l => l !== '');
  if (domains.length) details.push('', `${GUTTER}${c.bold}By domain${c.reset}`, ...domains);

  const degraded = (report.degraded ?? []) as { id: string; name: string }[];
  const dw = width(degraded.map(d => d.name));
  section(
    'Not working',
    degraded.map(d => named(d.name, dw, recheckCommand(d.id)))
  );
  const recoveringNow = (report.recovering ?? []) as { name: string; recent: string }[];
  const rw = width(recoveringNow.map(r => r.name));
  section(
    'Recovering',
    recoveringNow.map(r => named(r.name, rw, r.recent))
  );

  // A sole provider that is also a bottleneck is said once, with what it
  // unlocks; a bottleneck is said once by name, since the capability and the
  // tool that provides it often share one.
  const unlocks = new Map<string, number>();
  for (const b of report.bottlenecks as { name: string; unlocks_count: number }[]) {
    if (!unlocks.has(b.name)) unlocks.set(b.name, b.unlocks_count);
  }
  const spofs = (Array.isArray(report.spofs) ? report.spofs : []) as {
    capability: string;
    provider_id: string;
  }[];
  const sw = width(spofs.map(s => s.capability));
  section(
    'Single points of failure',
    spofs.map(s => {
      const n = unlocks.get(s.capability);
      return named(s.capability, sw, `only from ${s.provider_id}${n ? ` · unlocks ${n}` : ''}`);
    })
  );
  const sole = new Set(spofs.map(s => s.capability));
  const choke = [...unlocks].filter(([name]) => !sole.has(name));
  const bw = width(choke.map(([name]) => name));
  section(
    'Bottlenecks',
    choke.map(([name, n]) => named(name, bw, `unlocks ${n}`))
  );

  const recorded = (report.deficits ?? []) as {
    name: string;
    times_blocked: number;
    verdict: string;
    why?: string;
  }[];
  const fw = width(recorded.map(d => d.name));
  section(
    'Work blocked on',
    recorded.map(d =>
      named(d.name, fw, `${d.times_blocked}× · ${d.verdict}${d.why ? ` · last: ${d.why}` : ''}`)
    )
  );
  const pending = report.pending as { id: string; goal: string; status: string }[];
  section(
    'Waiting on a decision',
    pending.map(p => named(p.id, 0, `${p.status} · ${p.goal}`))
  );
  const unattended = report.unattended?.[0];
  if (unattended) {
    const parts = [
      unattended.sandboxes ? `${unattended.sandboxes} sandboxes` : null,
      unattended.standing_budgets ? `${unattended.standing_budgets} standing budgets` : null,
    ].filter(Boolean);
    details.push(
      '',
      `${GUTTER}${c.grey}Unattended${c.reset}  ${parts.join(' · ')} ${c.grey}· ambit authority lists what each one covers${c.reset}`
    );
  }
  while (details[0] === '') details.shift();

  const next = report.next
    ? `${GUTTER}${c.accent}${c.bold}Next${c.reset}  ${c.bold}${report.next.command}${c.reset} ${c.grey}· ${report.next.why}${c.reset}`
    : undefined;

  return [
    '',
    ...head,
    ...(details.length ? ['', ...details] : []),
    ...(next ? ['', next] : []),
    '',
  ];
}

/**
 * The short screen: where you are, what one more step would open, and what to
 * check before leaning on it.
 *
 * `status` is the whole report, and a first run that printed it opened on a
 * count of what was unverified and sixty lines of single providers and
 * bottlenecks, ending on a suggestion to run checks. That is the guardrail
 * shown before the purpose. This leads with the next steps `ambit next` ranks,
 * keeps a failing check and the unverified count as the two things worth
 * knowing first, and leaves the rest of the fragility detail to `status`.
 */
function briefReport(db: any) {
  const sources = seedSources(db);
  // Measured against the tree, as the map and the hosted page measure it: the
  // graph's own count took in the person's servers, so the same three servers
  // read "18 of 55" here and "9 of 46" on the page.
  const counts = graphCounts(db, 'tree');
  const checkable = checkableNames(db);
  const ev = evidenceReport(db, checkable);
  const failing = db
    .prepare(
      `SELECT id, name FROM capabilities
       WHERE ${COUNTED_SQL} AND ${REACHED_SQL} AND ${FAILING_SQL} ORDER BY id`
    )
    .all() as { id: string; name: string }[];
  // The ranking is the screen's purpose but never the reason it fails to print.
  let next: { capability: string; cost: string; why: string; command: string }[] = [];
  try {
    next = ((nextSteps(db, 2) as any).next ?? []).map((n: any) => ({
      capability: n.capability,
      cost: n.cost,
      why: n.why,
      command: n.plan,
    }));
  } catch {
    /* no ranking, no section */
  }
  // What moved since the person last looked: a seed in another terminal, the
  // tracker plugin, another session. Shown once, then marked as seen.
  const seen = unseenSince(db);
  const since = seen ? (ledgerSince(db, seen) as any) : null;
  if (seen) markSeen(db);
  return {
    // Null for a graph seeded before sources were recorded; [] when nothing
    // of the person's was found, which is an answer and changes the screen.
    read: sources,
    moved:
      since && !since.error
        ? { since: seen, gained: since.gained, emergent: since.emergent, lost: since.lost }
        : undefined,
    reached: counts.reached,
    total: counts.total,
    reach: reachPhrase(db),
    proven: ev.proven,
    unproven: ev.unproven,
    no_check: ev.no_check,
    failing: failing.map(f => ({
      name: f.name,
      command: recheckCommand(f.id),
    })),
    next,
  };
}

type BriefReport = ReturnType<typeof briefReport>;

/** "Claude Code (3 servers), Cursor (2 servers) and Ollama (4 models)". */
function readFrom(read: { label: string; servers: string[]; models?: string[] }[]): string {
  const parts = read.map(r => {
    const n = (r.models ?? r.servers).length;
    return `${r.label} (${n} ${r.models ? 'model' : 'server'}${n === 1 ? '' : 's'})`;
  });
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : parts[0];
}

/**
 * The short screen as lines; pure, like `renderStatus`.
 *
 * It is the readout every first surface gives, in one order: what was read,
 * how much of the tree it reaches, the next step and what it opens, what is
 * not verified yet, and one thing to do. The hosted page and `ambit web` say the
 * same five things about the same setup. `typed` writes a command the way the
 * person ran Ambit: under npx, `npx ambit-cli web`.
 */
function renderBrief(
  report: BriefReport,
  c: Palette = C,
  typed: (command: string) => string = command => command
): string[] {
  const heading = (text: string) => `${c.bold}${text}${c.reset}`;
  // No leading blank: the first run's seed report ends on one already.
  const lines = [heading('Where you are')];
  // One thing to do, marked, and where the rest are. It used to end on three
  // commands of equal weight after a command per step, so a first run offered
  // six places to go and said which mattered of none.
  const close = [
    '',
    `  ${c.accent}${c.bold}›${c.reset} ${c.bold}${typed('ambit web')}${c.reset}  ${c.grey}the same, on the map${c.reset}`,
    `${GUTTER}${c.grey}${typed('ambit status')} for the full report, ${typed('ambit --help')} for the commands${c.reset}`,
    '',
  ];

  if (report.read && report.read.length === 0) {
    // Counts here would describe the curated model and read as the person's.
    return [
      ...lines,
      `${GUTTER}Nothing of yours is in the graph yet.`,
      `${GUTTER}${c.grey}Add an agent config and run ${typed('ambit seed')}, which lists where it looks.${c.reset}`,
      '',
      `${GUTTER}${c.grey}${typed('ambit --help')} for the commands${c.reset}`,
      '',
    ];
  }

  if (report.read) lines.push(`${GUTTER}${c.grey}Read from ${readFrom(report.read)}${c.reset}`);
  lines.push(
    // The sentence every surface leads with, and the glossary's word for a
    // passing check: this line alone said "proven".
    `${GUTTER}${report.reach} · ${report.proven} verified`
  );
  const moved = report.moved ? movedLines(report.moved, c) : [];
  if (moved.length) {
    const when = ago(report.moved!.since);
    lines.push(
      `${GUTTER}${c.grey}Since you last looked${when ? `, ${when}` : ''}:${c.reset}`,
      ...moved
    );
  }

  const [first, ...rest] = report.next;
  if (first) {
    const about = (cost: string) => (cost === 'unknown' ? '' : ` · about ${cost}`);
    lines.push(
      '',
      heading('What one more step opens'),
      `  ${c.accent}${c.bold}›${c.reset} ${c.bold}${first.capability}${c.reset}${c.grey}${about(first.cost)}${c.reset}`,
      `${GUTTER}${first.why}`,
      `${GUTTER}${c.grey}${typed(first.command)}${c.reset}`
    );
    // The others are named and priced, and planned by the same command.
    if (rest.length) {
      const also = rest.map(n => `${n.capability}${about(n.cost)}`).join(', ');
      lines.push(`${GUTTER}${c.grey}Also one step away: ${also}${c.reset}`);
    }
  }

  if (report.failing.length || report.unproven) {
    lines.push('', heading('Before you lean on it'));
    if (report.failing.length) {
      const shown = report.failing
        .slice(0, 3)
        .map(f => f.name)
        .join(', ');
      const more = report.failing.length > 3 ? ` and ${report.failing.length - 3} more` : '';
      lines.push(
        `  ${c.yellow}!${c.reset} ${report.failing.length} configured and failing a check: ${shown}${more} ${c.grey}· ${typed(report.failing[0].command)}${c.reset}`
      );
    }
    if (report.unproven) {
      // `verify` runs the checks there are, so the line says how many of these
      // have one when some do not.
      const checked = report.unproven - report.no_check;
      const verify = typed('ambit verify');
      const how = !report.no_check
        ? `${verify} runs their checks`
        : checked
          ? `${verify} checks ${checked} of them`
          : 'none of them declares a check';
      lines.push(
        `${GUTTER}${report.unproven} configured and not yet verified ${c.grey}· ${how}${c.reset}`
      );
    }
  }
  return [...lines, ...close];
}

/** A step of a plan, as `planFor` returns it. */
interface PlanStep {
  id: string;
  name: string;
  setup_seconds?: number;
  requires_person?: string[];
  configured?: string[];
  options?: { name: string; recurring_cost?: string; note?: string }[];
}

/**
 * A plan as a checklist: what is already in place, then each step left in
 * order with its time, what to do, and the ways to do it.
 *
 * `ambit goal launch-ready` is the question a person building alone asks, and
 * it printed as nested records: `setup seconds: 900` under an id. The data is
 * unchanged for `--json`; this is how it reads. `asked` is the sentence a
 * free-form goal was routed from, said first so the reader can see what the
 * words were taken to mean.
 */
function renderPlan(
  plan: {
    goal: string;
    steps?: number;
    estimated_setup?: string;
    order?: PlanStep[];
    requires_person?: string[];
    degraded?: { id: string; name: string }[];
    note?: string;
  },
  c: Palette = C,
  asked?: { sentence: string; others: string[] }
): string[] {
  const tree = loadTechTree();
  const nodeOf = (id: string) => tree.nodes?.find((n: any) => `combo:${n.id}` === id);
  const goalNode = tree.nodes?.find((n: any) => n.name === plan.goal);
  // A capstone is reached by its steps and is not a step of its own.
  const steps = (plan.order ?? []).filter(s => !nodeOf(s.id)?.detect?.requires_met);
  const lines = [''];
  if (asked) {
    lines.push(
      `${GUTTER}${c.grey}“${asked.sentence}” reads as${c.reset} ${c.bold}${plan.goal}${c.reset}`
    );
  }
  if (!steps.length && !plan.degraded?.length) {
    lines.push(`${GUTTER}${c.bold}${plan.goal}${c.reset} is already reached.`, '');
    return lines;
  }
  const seconds = steps.reduce((sum, s) => sum + (s.setup_seconds || 0), 0);
  const time = seconds ? ` · about ${readableCost(seconds)}` : '';
  lines.push(
    `${GUTTER}${c.bold}${plan.goal}${c.reset} ${c.grey}· ${steps.length} ${steps.length === 1 ? 'step' : 'steps'} left${time}${c.reset}`
  );

  // What is already in place among the goal's own prerequisites, so a long
  // checklist also says how far along it is.
  const left = new Set([...steps.map(s => s.id), ...(plan.degraded ?? []).map(d => d.id)]);
  const done = (goalNode?.requires ?? [])
    .filter((r: string) => !left.has(`combo:${r}`))
    .map((r: string) => nodeOf(`combo:${r}`)?.name ?? r);
  if (done.length) {
    lines.push('', ...done.map((name: string) => `  ${c.green}✓${c.reset} ${name}`));
  }
  for (const d of plan.degraded ?? []) {
    lines.push(
      `  ${c.yellow}!${c.reset} ${d.name} is configured and failing its check ${c.grey}· ${recheckCommand(d.id)}${c.reset}`
    );
  }

  steps.forEach((step, i) => {
    const node = nodeOf(step.id);
    const cost = step.setup_seconds
      ? ` ${c.grey}· about ${readableCost(step.setup_seconds)}${c.reset}`
      : '';
    lines.push('', `  ${c.bold}${i + 1}. ${step.name}${c.reset}${cost}`);
    // Half done already: what is configured counts once the steps before it land.
    if (step.configured?.length) {
      const waits = (node?.requires ?? [])
        .map((r: string) => steps.find(s => s.id === `combo:${r}`)?.name)
        .filter(Boolean);
      const once = waits.length ? `, and counts once ${waits.join(' and ')} is in place` : '';
      lines.push(
        `     ${c.green}✓${c.reset} ${step.configured.join(', ')} is already configured${once}`
      );
    } else {
      const what = node?.hint || node?.description;
      if (what) lines.push(`     ${what}`);
    }
    for (const o of step.configured?.length ? [] : (step.options ?? [])) {
      const said = [o.name, o.recurring_cost, o.note].filter(Boolean).join(' · ');
      lines.push(`     ${c.grey}› ${said}${c.reset}`);
    }
    if (step.requires_person?.length) {
      lines.push(`     ${c.accent}› needs ${step.requires_person.join(', ')}${c.reset}`);
    }
  });

  const first = steps[0];
  lines.push('');
  if (asked?.others.length) {
    lines.push(`${GUTTER}${c.grey}Also matched: ${asked.others.join(', ')}${c.reset}`);
  }
  if (first) lines.push(stepLine(first, c));
  lines.push('');
  return lines;
}

/**
 * The line a plan ends on: the first step as a command to type. It named the
 * step and stopped, so the last line of a plan was the one line with nothing
 * to paste. `ambit fix` prints the ways to set the step up, with each patch,
 * and writes nothing, which is the next move a person makes by hand.
 */
function stepLine(step: { id: string; name: string }, c: Palette): string {
  const fix = `ambit fix ${shellQuote(step.id.replace(/^combo:/, ''))}`;
  return `${GUTTER}${c.accent}${c.bold}Next${c.reset}  ${c.bold}${fix}${c.reset}${c.grey} · the ways to set up ${step.name}, then ambit seed: the list moves as each step lands${c.reset}`;
}

/** What `specGoal` returns for a spec it could read. */
interface SpecReport {
  spec: string;
  format: 'spec-kit' | 'openspec' | 'markdown';
  tasks: number;
  routed: number;
  needs: {
    id: string;
    name: string;
    status?: 'reached' | 'failing' | 'next' | 'blocked';
    tasks: string[];
    plan?: string[];
  }[];
  steps: (PlanStep & { for?: string[] })[];
  setup_seconds?: number;
  failing: { id: string; name: string; check: string }[];
  unrouted: {
    id?: string;
    text: string;
    suggested?: { name: string; probability?: number; similarity?: number };
  }[];
  judged?: { error?: string; asked?: string };
}

const FORMAT_NAME = { 'spec-kit': 'Spec Kit', openspec: 'OpenSpec', markdown: 'a task list' };

/** How many unrouted tasks a terminal shows before counting the rest. */
const UNROUTED_ROWS = 6;

/**
 * `ambit goal --spec` as a person reads it: what the spec's tasks need and the
 * gap, laid out as one goal's plan is (reached, failing, then the steps in the
 * order they close), and then the tasks nothing routed. Each need says which
 * tasks, or which line of the plan, put it there, so a route that looks wrong
 * can be traced to the words that made it.
 */
function renderSpec(report: SpecReport, c: Palette = C): string[] {
  const ids = (tasks: string[]) => {
    const named = tasks.every(t => /^(T\d+|N?FR-\d+|\d+(\.\d+)*)$/.test(t));
    if (!named) return `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`;
    return tasks.length > 4
      ? `${tasks.slice(0, 4).join(', ')} +${tasks.length - 4}`
      : tasks.join(', ');
  };
  const why = (n: { tasks: string[]; plan?: string[] }) =>
    [n.tasks.length ? ids(n.tasks) : '', n.plan?.length ? `plan: ${n.plan.join(', ')}` : '']
      .filter(Boolean)
      .join(' · ');
  const byId = new Map(report.needs.map(n => [n.id, n]));
  const count = (status: string) => report.needs.filter(n => n.status === status).length;

  const lines = [''];
  lines.push(
    `${GUTTER}${c.bold}${report.spec}${c.reset} ${c.grey}· ${FORMAT_NAME[report.format]} · ${report.tasks} ${report.tasks === 1 ? 'task' : 'tasks'}, ${report.routed} routed${c.reset}`
  );
  const time = report.setup_seconds ? `, about ${readableCost(report.setup_seconds)}` : '';
  const tally = [
    `${report.needs.length} ${report.needs.length === 1 ? 'capability' : 'capabilities'} needed`,
    `${count('reached')} reached`,
    ...(report.failing.length ? [`${report.failing.length} failing`] : []),
    ...(report.steps.length
      ? [`${report.steps.length} ${report.steps.length === 1 ? 'step' : 'steps'} left${time}`]
      : []),
  ];
  lines.push(`${GUTTER}${tally.join(' · ')}`);

  const reached = report.needs.filter(n => n.status === 'reached');
  if (reached.length) lines.push('');
  for (const n of reached)
    lines.push(`  ${c.green}✓${c.reset} ${n.name}  ${c.grey}${why(n)}${c.reset}`);
  for (const f of report.failing) {
    lines.push(
      `  ${c.yellow}!${c.reset} ${f.name} is configured and failing its check ${c.grey}· ${f.check}${c.reset}`
    );
  }

  report.steps.forEach((step, i) => {
    const cost = step.setup_seconds
      ? ` ${c.grey}· about ${readableCost(step.setup_seconds)}${c.reset}`
      : '';
    const asked = byId.get(step.id);
    const said = asked ? `  ${c.grey}${why(asked)}${c.reset}` : '';
    lines.push('', `  ${c.bold}${i + 1}. ${step.name}${c.reset}${cost}${said}`);
    if (step.for?.length) lines.push(`     ${c.grey}needed by ${step.for.join(', ')}${c.reset}`);
    if (step.configured?.length) {
      lines.push(`     ${c.green}✓${c.reset} ${step.configured.join(', ')} is already configured`);
    }
    if (step.requires_person?.length) {
      lines.push(`     ${c.accent}› needs ${step.requires_person.join(', ')}${c.reset}`);
    }
  });
  // Routed to a node this graph has not seeded: the tree is newer than the graph.
  const unseeded = report.needs.filter(n => !n.status);
  if (unseeded.length) {
    lines.push(
      '',
      `${GUTTER}${c.grey}Not in this graph yet: ${unseeded.map(n => n.name).join(', ')} · ambit seed reads the tree again${c.reset}`
    );
  }

  if (report.unrouted.length) {
    lines.push('', `${GUTTER}${c.grey}Routed nowhere:${c.reset}`);
    for (const t of report.unrouted.slice(0, UNROUTED_ROWS)) {
      const text = t.text.length > 72 ? `${t.text.slice(0, 71)}…` : t.text;
      lines.push(`  ${c.grey}·${c.reset} ${t.id ? `${t.id} ` : ''}${text}`);
      // A probability and a similarity are different claims, and each is
      // named for what it is.
      const said =
        typeof t.suggested?.probability === 'number'
          ? `the judge suggests ${t.suggested.name} (${t.suggested.probability.toFixed(2)})`
          : typeof t.suggested?.similarity === 'number'
            ? `nearest in meaning: ${t.suggested.name} (similarity ${t.suggested.similarity.toFixed(2)})`
            : '';
      if (said) lines.push(`     ${c.grey}› ${said}${c.reset}`);
    }
    if (report.unrouted.length > UNROUTED_ROWS) {
      lines.push(
        `    ${c.grey}… ${report.unrouted.length - UNROUTED_ROWS} more · --json for all${c.reset}`
      );
    }
  }
  if (report.judged?.error) lines.push(`${GUTTER}${c.grey}${report.judged.error}${c.reset}`);

  lines.push('');
  const first = report.steps[0];
  if (first) lines.push(stepLine(first, c));
  else if (report.failing.length) {
    lines.push(
      `${GUTTER}${c.accent}${c.bold}Next${c.reset}  ${c.bold}${report.failing[0].check}${c.reset}`
    );
  } else if (report.needs.length) {
    lines.push(`${GUTTER}Everything these tasks need is reached.`);
  }
  lines.push('');
  return lines;
}

/** What `analyzeImpact` returns for a node the graph holds. */
interface ImpactReport {
  capability: string;
  decayed: {
    name: string;
    becomes_unavailable: boolean;
    also_provided_by?: number;
    but_all_share?: string;
  }[];
  /** Everything working now that would stop, however far down: the map's outage count. */
  stops?: string[];
  /** The actions those capabilities confer, which stop with them. */
  actions_stopped?: number;
}

/**
 * `ambit impact` as a person reads it: what stops working first, then what
 * survives and on what.
 *
 * It printed through the generic formatter, so the answer was
 * `becomes unavailable: false` and `also provided by: 5`, and every capability
 * a second time under `combos at risk`. Four kinds of answer, in the order
 * they matter: what ends; what survives only on providers that all present
 * one credential, which is not survival if that key goes; what survives on
 * others; and what loses an optional input. The row that ends something
 * carries the `›` that survives a pipe. `--json` gets the report unchanged.
 */
function renderImpact(report: ImpactReport, c: Palette = C): string[] {
  const seen = new Set<string>();
  const ends: string[] = [];
  const shared = new Map<string, string[]>();
  const survives: string[] = [];
  const weakened: string[] = [];
  for (const d of report.decayed) {
    if (seen.has(d.name)) continue;
    seen.add(d.name);
    if (d.becomes_unavailable) ends.push(d.name);
    else if (d.but_all_share) {
      if (!shared.has(d.but_all_share)) shared.set(d.but_all_share, []);
      shared.get(d.but_all_share)!.push(d.name);
    } else if (d.also_provided_by) {
      const n = d.also_provided_by;
      survives.push(
        `${d.name} ${c.grey}(${n} other ${n === 1 ? 'provider' : 'providers'})${c.reset}`
      );
    } else weakened.push(d.name);
  }

  const head = `If ${report.capability} went away`;
  const lines = [
    '',
    `${GUTTER}${c.bold}${head}${c.reset}`,
    `${GUTTER}${c.grey}${'─'.repeat(head.length)}${c.reset}`,
  ];
  if (!seen.size) {
    lines.push(`${GUTTER}Nothing on the graph depends on it.`, '');
    return lines;
  }
  const list = (names: string[]) => names.join(', ');
  // The whole cascade where the report has one: what stands on what stops
  // stops too, and a dependent that is not working now has nothing to lose.
  const stopping = report.stops ?? ends;
  if (stopping.length) {
    const actions = report.actions_stopped
      ? ` ${c.grey}· and the ${report.actions_stopped} ${report.actions_stopped === 1 ? 'action' : 'actions'} they confer${c.reset}`
      : '';
    lines.push(
      `  ${c.accent}${c.bold}›${c.reset} ${c.bold}Stops working${c.reset}  ${list(stopping)}${actions}`
    );
  } else {
    lines.push(`${GUTTER}Nothing stops working.`);
  }
  for (const [credential, names] of shared) {
    lines.push(
      `${GUTTER}${c.yellow}Survives on one key${c.reset}  ${list(names)} ${c.grey}· every other provider uses ${credential}${c.reset}`
    );
  }
  if (survives.length) lines.push(`${GUTTER}Survives  ${list(survives)}`);
  if (weakened.length) {
    lines.push(`${GUTTER}${c.grey}Loses an optional input  ${list(weakened)}${c.reset}`);
  }
  lines.push('');
  return lines;
}

/**
 * `ambit weigh` as a person reads it: what each runtime carries into every
 * session, then each server heaviest first, then what the ledger never saw
 * called, which is the line that wants a decision and carries the `›`.
 * `--json` gets the report unchanged.
 */
function renderCarry(report: any, c: Palette = C): string[] {
  const head = 'What your loadout carries';
  const lines = [
    '',
    `${GUTTER}${c.bold}${head}${c.reset}`,
    `${GUTTER}${c.grey}${'─'.repeat(head.length)}${c.reset}`,
  ];
  const tokens = (n: number) => formatCount(n);
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

  if (report.empty) lines.push(`${GUTTER}Nothing weighed yet.`);
  const runtimes: any[] = report.runtimes ?? [];
  const width = Math.max(0, ...runtimes.map(r => String(r.runtime).length));
  runtimes.forEach((r, i) => {
    const what = i === 0 ? ' of tool lists in every session' : '';
    lines.push(
      `${GUTTER}${String(r.runtime).padEnd(width)}  about ${c.bold}${tokens(r.tokens)}${c.reset} tokens${what} ${c.grey}· ${plural(r.servers, 'server')}${c.reset}`
    );
  });

  const servers: any[] = report.servers ?? [];
  if (servers.length) {
    lines.push('');
    const nameWidth = Math.max(...servers.map(s => String(s.name).length));
    const sizeWidth = Math.max(...servers.map(s => tokens(s.tokens).length));
    for (const s of servers) {
      const top = s.heaviest?.[0];
      const heaviest =
        top && s.tools > 1
          ? ` ${c.grey}· heaviest: ${top.name} (${tokens(top.tokens)})${c.reset}`
          : '';
      // Just weighed needs no date; one this run could not reach shows how old its figure is.
      const when = report.weighed_now?.includes(s.name) ? undefined : ago(s.measuredAt);
      lines.push(
        `${GUTTER}${String(s.name).padEnd(nameWidth)}  ${tokens(s.tokens).padStart(sizeWidth)}  ${c.grey}${plural(s.tools, 'tool')}${when ? `, weighed ${when}` : ''}${c.reset}${heaviest}`
      );
    }
  }

  const notCalled: string[] = report.not_called?.servers ?? [];
  if (notCalled.length) {
    const weight = new Map(servers.map(s => [s.name, s.tokens]));
    const named = notCalled.map(n => `${n} ${c.grey}(${tokens(weight.get(n) ?? 0)})${c.reset}`);
    lines.push(
      '',
      `  ${c.accent}${c.bold}›${c.reset} ${c.bold}Carried, not called in ${report.not_called.days} days${c.reset}  ${named.join(', ')}`
    );
  }
  const notWeighed: any[] = report.not_weighed ?? [];
  if (notWeighed.length) {
    lines.push('', `${GUTTER}${c.yellow}Not weighed${c.reset}`);
    for (const n of notWeighed) lines.push(`${GUTTER}  ${n.name}  ${c.grey}${n.reason}${c.reset}`);
  }
  const never: string[] = report.never_weighed ?? [];
  if (never.length && !report.weighed_now) {
    lines.push(
      '',
      `${GUTTER}${c.grey}Never weighed  ${never.join(', ')} · ambit weigh tries each local one${c.reset}`
    );
  }
  if (report.empty && !notWeighed.length)
    lines.push(`${GUTTER}${c.grey}${report.meaning}${c.reset}`);
  if (report.note) lines.push('', `${GUTTER}${c.grey}${report.note}${c.reset}`);
  lines.push('');
  return lines;
}

/** "2h 05m" from a count of seconds. */
function span(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
}

/** A paragraph cut into lines of about `width`, each after `indent`. */
function wrapped(text: string, indent: string, width = 76): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + word.length + 1 > width) {
      out.push(indent + line);
      line = '';
    }
    line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(indent + line);
  return out;
}

/**
 * `ambit usage --windows` as a person reads it: each runtime's five-hour
 * windows, newest first and in local time, the current one with the time left
 * in it, each model's tokens by part, then each runtime's last seven days. A
 * cost is shown only where a price was declared, and "unpriced" otherwise. The
 * note closes it, since it says what no window states: a limit. `--json` gets
 * the report, its times in UTC.
 */
function renderWindows(report: ReturnType<typeof usageWindows>, c: Palette = C): string[] {
  const { windows, last_7_days: week } = report;
  if (!windows || !week) return formatGeneric(report, c);
  const when = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const clock = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const count = (n: number) => Math.round(n).toLocaleString('en-US');
  const cost = (w: { spend_dollars?: number; unpriced?: true }) =>
    w.spend_dollars === undefined
      ? 'unpriced'
      : `$${w.spend_dollars.toFixed(2)} at declared prices${w.unpriced ? ', some unpriced' : ''}`;
  const head = `Five-hour windows, last ${report.days === 1 ? '24 hours' : `${report.days} days`}`;
  const lines = [
    '',
    `${GUTTER}${c.bold}${head}${c.reset}`,
    `${GUTTER}${c.grey}${'─'.repeat(head.length)}${c.reset}`,
  ];
  if (!windows.length) lines.push(`${GUTTER}No tokens were used in one.`);
  for (const runtime of [...new Set(windows.map(w => w.runtime))]) {
    lines.push(`${GUTTER}${c.bold}${runtime}${c.reset}`);
    for (const w of windows.filter(x => x.runtime === runtime)) {
      const range = `${when.format(new Date(w.start))} to ${clock.format(new Date(w.end))}`;
      const now = w.current ? `  ${c.bold}now, ${span(w.seconds_left ?? 0)} left${c.reset}` : '';
      lines.push(
        `${GUTTER}  ${range}${now}  ${count(w.tokens)} tokens ${c.grey}· ${cost(w)}${c.reset}`
      );
      for (const m of w.models) {
        const parts = [
          `input ${count(m.input)}`,
          `cache reads ${count(m.cached)}`,
          `output ${count(m.output)}`,
          ...(m.reasoning ? [`reasoning ${count(m.reasoning)}`] : []),
        ];
        lines.push(`${GUTTER}    ${c.grey}${m.model}  ${parts.join(' · ')}${c.reset}`);
      }
    }
  }
  if (week.length) {
    lines.push('', `${GUTTER}${c.bold}Last 7 days${c.reset}`);
    for (const r of week) {
      lines.push(
        `${GUTTER}  ${r.runtime}  ${count(r.tokens)} tokens ${c.grey}· ${cost(r)}${c.reset}`
      );
    }
  }
  lines.push('', ...wrapped(report.note, `${GUTTER}${c.grey}`).map(l => `${l}${c.reset}`), '');
  return lines;
}

/** What `nextSteps` returns, as much of it as a person reads. */
interface NextReport {
  basis?: string;
  note?: string;
  next: {
    capability: string;
    why: string;
    cost: string;
    privacy?: string;
    missing?: string[];
    note?: string;
    plan: string;
    propose: string;
    priced_case?: string;
  }[];
}

/**
 * `ambit next` as a person reads it: each step with its time and why, then the
 * two commands that act on it. It printed through the generic formatter, as
 * nested records keyed by `combo:` ids, so the command a first screen sends
 * people to read like debug output. `--json` gets the report unchanged.
 */
function renderNext(report: NextReport, c: Palette = C): string[] {
  const lines = [''];
  if (!report.next.length) {
    lines.push(`${GUTTER}${report.note ?? 'Nothing is one step away.'}`, '');
    return lines;
  }
  // How the list was ranked, from the label the JSON keeps before its dash.
  const basis = report.basis?.startsWith('observed')
    ? 'Ranked by what has blocked work, then by what each opens per hour of setup.'
    : report.basis
      ? 'Ranked by what each opens per hour of setup: nothing has been recorded blocking work yet.'
      : undefined;
  if (basis) lines.push(`${GUTTER}${c.grey}${basis}${c.reset}`, '');
  report.next.forEach((n, i) => {
    const cost = n.cost && n.cost !== 'unknown' ? ` ${c.grey}· about ${n.cost}${c.reset}` : '';
    const where = n.privacy ? ` ${c.grey}· ${n.privacy}${c.reset}` : '';
    lines.push(
      `  ${c.accent}${c.bold}${i + 1}.${c.reset} ${c.bold}${n.capability}${c.reset}${cost}${where}`
    );
    lines.push(`     ${n.why}`);
    if (n.missing?.length)
      lines.push(`     ${c.grey}Needs first: ${n.missing.join(', ')}${c.reset}`);
    if (n.note) lines.push(`     ${c.yellow}${n.note}${c.reset}`);
    lines.push(
      `     ${c.grey}${n.plan}  ·  ${n.propose}${n.priced_case ? `  ·  ${n.priced_case}` : ''}${c.reset}`
    );
  });
  if (report.note) lines.push('', `${GUTTER}${c.grey}${report.note}${c.reset}`);
  lines.push(
    '',
    `${GUTTER}${c.grey}ambit goal <step> lists what it takes; ambit propose <step> drafts it for your approval.${c.reset}`,
    ''
  );
  return lines;
}

/**
 * `ambit apply` where it wrote nothing: what stopped it, the `--to` that would
 * write, and each runtime's way by hand, a command or an entry to a line, so
 * what is printed is what gets pasted. The generic view joined the commands
 * with commas and flattened an entry's list of arguments into one word.
 * Anything else apply answers reads the generic way.
 */
function renderApply(result: any, c: Palette = C): string[] {
  if (!Array.isArray(result?.by_hand)) return formatGeneric(result, c);
  const lines = ['', `${GUTTER}${result.error ?? result.note ?? ''}`];
  if (result.apply_with?.length) {
    lines.push('', `${GUTTER}Name the runtime to write:`);
    for (const command of result.apply_with)
      lines.push(`  ${c.accent}${c.bold}›${c.reset} ${c.bold}${command}${c.reset}`);
  }
  lines.push('', `${GUTTER}${result.apply_with?.length ? 'Or by hand:' : 'By hand:'}`);
  for (const way of result.by_hand) {
    const head = `${GUTTER}${c.bold}${way.runtime}${c.reset}`;
    if (way.run) {
      lines.push(head, ...way.run.map((command: string) => `${GUTTER}  ${command}`));
    } else if (way.add) {
      lines.push(`${head} ${c.grey}· add to ${way.file}${c.reset}`);
      for (const line of JSON.stringify(way.add, null, 2).split('\n'))
        lines.push(`${GUTTER}  ${line}`);
    } else if (way.cannot) {
      lines.push(`${head} ${c.grey}· ${way.cannot}${c.reset}`);
    }
  }
  lines.push('');
  return lines;
}

/**
 * `ambit doctor` as a person reads it: the grade or why there is none, the
 * counts, which runtimes have Ambit connected, and what to do, one per line.
 * Its recommendations printed as one comma-joined string.
 */
function renderDoctor(report: DoctorReport, c: Palette = C): string[] {
  const cap = report.capabilities;
  const head = report.grade ? `${report.grade} (${report.score}/100)` : 'Not graded yet';
  const lines = [
    '',
    `${GUTTER}${c.bold}${head}${c.reset}`,
    `${GUTTER}${report.reach} · ${cap.proven} verified · ${cap.failing} failing · ${report.spofs.length} with a single provider`,
  ];
  if (!report.grade) {
    // "Not graded" said nothing of what a grade is, so the line says what it
    // scores and what would give it one.
    const why =
      'A grade, A to F, scores what passes its check against what fails, what rests on one provider, and whether Ambit is connected. No check has run yet: ambit verify runs them.';
    lines.push(...wrapped(why, GUTTER).map(l => `${c.grey}${l}${c.reset}`));
  }
  for (const d of cap.degraded.slice(0, 5)) {
    lines.push(`  ${c.yellow}!${c.reset} ${d.name} is failing its check`);
  }
  if (report.runtimes_detected.length) {
    const runtimes = report.runtimes_detected
      .map(r => `${r.label}${r.has_ambit ? '' : ` ${c.grey}(Ambit not connected)${c.reset}`}`)
      .join(', ');
    lines.push(`${GUTTER}Runtimes: ${runtimes}`);
  }
  if (report.bloat?.length) {
    lines.push('', `${GUTTER}${c.yellow}Context bloat warnings:${c.reset}`);
    for (const b of report.bloat) {
      const kTokens = (b.tokens / 1000).toFixed(1);
      lines.push(
        `  ${c.yellow}!${c.reset} ${b.runtime} carries ${c.bold}${kTokens}K tokens${c.reset} of tool schemas across ${b.servers} servers (${Math.round((b.tokens / b.ceiling) * 100)}% of ${b.ceiling / 1000}K ceiling)`
      );
    }
  }
  if (report.recommendations.length) {
    lines.push('', `${GUTTER}${c.bold}What to do${c.reset}`);
    report.recommendations.forEach((r, i) => {
      lines.push(`  ${c.accent}${i + 1}.${c.reset} ${r}`);
    });
  }
  lines.push('');
  return lines;
}

/**
 * `ambit fix <capability>` as a person reads it: what state it is in, the one
 * command that re-checks it, and — for something not yet reached — the ways to
 * acquire it, each with the config patch a person can paste.
 *
 * It prints and never writes. The point is to remove the "what do I type now?"
 * step, not to become a package manager.
 */
function renderFix(report: any, c: Palette = C): string[] {
  if (report.error) return formatGeneric(report, c);
  const head = `Fix ${report.capability}`;
  const lines = [
    '',
    `${GUTTER}${c.bold}${head}${c.reset}`,
    `${GUTTER}${c.grey}${'─'.repeat(head.length)}${c.reset}`,
  ];
  const row = (label: string, value: string) =>
    `${GUTTER}${c.grey}${label.padEnd(9)}${c.reset}  ${value}`;
  // In the glossary's words: `locked` is the store's, and a person reads a
  // next step or blocked. A lifecycle no check has set is no answer about it,
  // so it is left out (AGENTS.md rule 16), as is the re-check of what is not
  // reached.
  const reached = isReached(report.state);
  if (report.stands) {
    const behind = report.blocked_by?.length ? `, behind ${report.blocked_by.join(', ')}` : '';
    lines.push(row('state', `${report.stands}${behind}`));
  } else if (report.state) lines.push(row('state', String(report.state)));
  if (report.lifecycle && report.lifecycle !== 'unknown') {
    lines.push(row('lifecycle', String(report.lifecycle)));
  }
  if (report.lifecycle === 'broken') {
    lines.push(
      `${GUTTER}${c.yellow}Its last check failed.${c.reset} Re-run it, then look at what the check said:`
    );
  } else if (report.state && !reached) {
    lines.push(`${GUTTER}${c.grey}Not reached yet.${c.reset} The ways to acquire it are below.`);
  }
  if (report.check) {
    lines.push('', `${GUTTER}${c.bold}Check${c.reset}  ${c.bold}${report.check}${c.reset}`);
  }
  const options: any[] = report.options ?? [];
  if (options.length) {
    lines.push('', `${GUTTER}${c.bold}Ways to acquire it${c.reset}`);
    for (const o of options) {
      const cost = [
        o.setup ? `setup ${o.setup}` : null,
        o.total_first_year_dollars != null ? `$${o.total_first_year_dollars}/yr` : null,
        o.recurring_dollars_per_month != null ? `$${o.recurring_dollars_per_month}/mo` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      lines.push(
        `  ${c.accent}›${c.reset} ${o.provider}${cost ? ` ${c.grey}· ${cost}${c.reset}` : ''}`
      );
      if (o.install) {
        for (const line of o.install.split('\n')) lines.push(`     ${c.grey}${line}${c.reset}`);
      }
    }
  } else {
    lines.push(
      `${GUTTER}${c.grey}No catalogued acquisition. \`ambit goal ${shellQuote(report.id.replace(/^combo:/, ''))}\` routes the longer path.${c.reset}`
    );
  }
  lines.push(
    '',
    `${GUTTER}${c.grey}This command prints; it never writes. \`ambit apply\` is the only writer, and only for an approved proposal.${c.reset}`,
    ''
  );
  return lines;
}

/**
 * `ambit help <word>`: the glossary entry by that name, and the command by
 * that name, each printed whole; then the entries that only mention it, named.
 *
 * Every entry whose text held the word was printed in full, so `help
 * verified` opened on two other concepts and ran to fifty lines before the
 * one asked for. A concept the CLI and the map call different things still
 * finds its entry: keystone on the map is bottlenecks in `ambit status`, and
 * the entry says so, so `help bottlenecks` names Keystone. A command verb
 * prints its usage, the lines `help --all` holds for it.
 */
function explain(wanted: string): void {
  const { concepts } = JSON.parse(
    readFileSync(join(ENGINE_DIR, '..', 'shared', 'concepts.json'), 'utf8')
  );
  const words = (text: string) => text.toLowerCase().split(/[^a-z0-9-]+/);
  const exact = concepts.filter(
    (c: any) => c.key === wanted || String(c.term).toLowerCase() === wanted
  );
  const named = exact.length ? exact : concepts.filter((c: any) => words(c.term).includes(wanted));
  const verb = ALIASES[wanted]?.to ?? wanted;
  const usage = wanted && (commandWords().includes(verb) ? commandHelp(verb) : undefined);
  const mentioned = wanted
    ? concepts.filter(
        (c: any) =>
          !named.includes(c) &&
          [c.key, c.term, c.short, c.long, c.seen].join(' ').toLowerCase().includes(wanted)
      )
    : [];
  const picked = wanted ? named : concepts;
  // An agent asks what a term means as readily as a person does, and reads
  // the answer through a pipe.
  const paint = terminalPalette();
  if (!picked.length && !usage && !mentioned.length) {
    console.log(`${paint.yellow}No concept matching "${wanted}".${paint.reset}`);
    console.log(`Try: ${concepts.map((c: any) => c.key).join(', ')}`);
    return;
  }
  const wrap = (text: string, width = 76, indent = '  ') => {
    const out: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      if ((line + word).length > width) {
        out.push(indent + line.trim());
        line = '';
      }
      line += word + ' ';
    }
    if (line.trim()) out.push(indent + line.trim());
    return out.join('\n');
  };
  console.log('');
  for (const c of picked) {
    console.log(`${paint.bold}${c.term}${paint.reset} ${paint.grey}— ${c.short}${paint.reset}`);
    console.log(wrap(c.long));
    console.log(`  ${paint.grey}Where you see it: ${c.seen}${paint.reset}`);
    console.log('');
  }
  if (usage) {
    console.log(`${paint.bold}ambit ${verb}${paint.reset}`);
    console.log(usage);
    console.log('');
  }
  if (mentioned.length) {
    const lead =
      picked.length || usage
        ? 'Also mentioned in'
        : `No concept is called "${wanted}". Mentioned in`;
    const names = mentioned.map((c: any) => `${c.term} (ambit help ${c.key})`).join(', ');
    console.log(`${paint.grey}${lead}: ${names}${paint.reset}\n`);
  }
  if (!wanted)
    console.log(`${paint.grey}ambit help <term> for one of these on its own.${paint.reset}\n`);
}

function renderPort(result: any, c: Palette = C): string[] {
  if (result.error) return formatGeneric(result, c);
  if (result.servers) {
    const lines = [
      '',
      `${GUTTER}${c.bold}MCP Servers across agent runtimes${c.reset}`,
      `${GUTTER}${c.grey}${result.summary}${c.reset}`,
      `${GUTTER}${c.grey}${'─'.repeat(64)}${c.reset}`,
    ];
    for (const s of result.servers) {
      const conf = s.configured_in.join(', ');
      const avail = s.available_to_port.length
        ? ` · ${c.grey}can port to: ${s.available_to_port.join(', ')}${c.reset}`
        : ` · ${c.green}in all detected runtimes${c.reset}`;
      lines.push(`  ${c.bold}${s.name.padEnd(20)}${c.reset} ${conf}${avail}`);
    }
    lines.push(
      '',
      `${GUTTER}To port a server to another agent:`,
      `  ${c.accent}ambit port <server> --to=<runtime>${c.reset}`,
      `  e.g. ambit port ${result.servers[0]?.name || 'playwright'} --to=claude-code`,
      ''
    );
    return lines;
  }

  const lines = [''];
  if (result.dry_run) {
    lines.push(`${GUTTER}${c.yellow}[dry run] Would port ${result.server}:${c.reset}`);
  }
  for (const r of result.results || []) {
    const act =
      r.action === 'already_configured'
        ? 'already configured in'
        : r.action === 'updated'
          ? 'updated in'
          : 'ported to';
    const mark = r.action === 'already_configured' ? `${c.grey}=` : `${c.green}✓`;
    lines.push(`  ${mark} ${result.server} ${act} ${r.label} (${r.path})${c.reset}`);
    if (r.backup) {
      lines.push(`    ${c.grey}Backup saved to ${r.backup}${c.reset}`);
    }
  }
  lines.push('');
  return lines;
}

function renderRepo(report: any, c: Palette = C): string[] {
  if (report.error) return formatGeneric(report, c);
  const stack = report.repo;
  const lines = [
    '',
    `${GUTTER}${c.bold}Repository stack in ${stack.name}${c.reset}`,
    `${GUTTER}${c.grey}${'─'.repeat(50)}${c.reset}`,
  ];
  if (stack.languages?.length)
    lines.push(`  ${c.grey}Languages:   ${c.reset}${stack.languages.join(', ')}`);
  if (stack.frameworks?.length)
    lines.push(`  ${c.grey}Frameworks:  ${c.reset}${stack.frameworks.join(', ')}`);
  if (stack.databases?.length)
    lines.push(`  ${c.grey}Databases:   ${c.reset}${stack.databases.join(', ')}`);
  if (stack.testing?.length)
    lines.push(`  ${c.grey}Testing:     ${c.reset}${stack.testing.join(', ')}`);
  if (stack.infra?.length)
    lines.push(`  ${c.grey}Infra:       ${c.reset}${stack.infra.join(', ')}`);

  if (report.superpowers?.length) {
    lines.push('', `${GUTTER}${c.bold}Recommended agent superpowers for this project:${c.reset}`);
    report.superpowers.forEach((sp: any, i: number) => {
      lines.push(`  ${c.accent}${i + 1}. ${sp.title}${c.reset}`);
      lines.push(`     ${sp.reason}`);
      if (sp.command) {
        lines.push(`     ${c.accent}${sp.command}${c.reset}`);
      }
    });
  } else {
    lines.push(
      '',
      `  ${c.green}✓ Your agent setup already carries tools matching this project stack.${c.reset}`
    );
  }
  lines.push('');
  return lines;
}

function renderToggle(result: any, c: Palette = C): string[] {
  if (result.error) return formatGeneric(result, c);
  const lines = [''];
  const dry = result.dry_run ? `${c.yellow}[dry run] ${c.reset}` : '';
  const stateWord = result.state === 'disabled' ? 'Disabled' : 'Enabled';
  const color = result.state === 'disabled' ? c.yellow : c.green;

  lines.push(`${GUTTER}${dry}${color}${c.bold}${stateWord} ${result.server}${c.reset}`);

  for (const r of result.results || []) {
    if (r.state === 'unchanged') {
      lines.push(`  ${c.grey}= ${r.label} (${r.path}) · already ${result.state}${c.reset}`);
    } else {
      lines.push(`  ${c.green}✓ ${r.label} (${r.path})${c.reset}`);
      if (r.backup) {
        lines.push(`    ${c.grey}Backup saved to ${r.backup}${c.reset}`);
      }
    }
  }

  const opposite = result.state === 'disabled' ? '--on' : '--off';
  lines.push(
    '',
    `${GUTTER}${c.grey}To switch back: ambit toggle ${result.server} ${opposite}${c.reset}`,
    ''
  );
  return lines;
}

export {
  ago,
  briefReport,
  renderBrief,
  renderImpact,
  renderNext,
  renderApply,
  renderDoctor,
  renderPort,
  renderRepo,
  renderToggle,
  renderCarry,
  renderWindows,
  renderPlan,
  renderSpec,
  evidenceReport,
  statusReport,
  renderStatus,
  renderFix,
  worries,
  explain,
  type BriefReport,
  type ImpactReport,
  type NextReport,
  type NextMove,
  type SpecReport,
  type StatusReport,
};
