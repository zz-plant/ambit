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
import { ENGINE_DIR, loadTechTree } from '../paths.ts';
import { findBottlenecks, singlePointsOfFailure } from '../inference.ts';
import { ledgerHistory, ledgerSince } from '../ledger.ts';
import { deficits } from '../planning.ts';
import { listProposals } from '../governance.ts';
import { nextSteps, readableCost } from '../next.ts';
import { C, formatGeneric, terminalPalette, type Palette } from './output.ts';
import { markSeen, movedLines, seedSources, unseenSince } from './seed.ts';
import { CHECK_RUN_SQL, FAILING_SQL, PROVEN, REACHED_SQL, graphCounts } from '../vocabulary.ts';

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
 * The unproven capabilities that carry a declared check: the set one `ambit
 * verify` turns into evidence.
 */
function checkableNames(db: any): string[] {
  try {
    const tree = loadTechTree();
    const withCheck = (tree.nodes || [])
      .filter((n: any) => n.verify?.command)
      .map((n: any) => `combo:${n.id}`);
    // Checks an agent registered for something it wrote count as well. This
    // read the curated model only, so a registered skill could never appear as
    // provable however many checks it carried.
    try {
      for (const r of db.prepare('SELECT capability_id FROM declared_checks').all()) {
        withCheck.push(r.capability_id);
      }
    } catch {
      /* database predates declared_checks */
    }
    if (withCheck.length) {
      const placeholders = withCheck.map(() => '?').join(',');
      return db
        .prepare(
          `SELECT name FROM capabilities WHERE id IN (${placeholders})
         AND state IN ('unlocked','active') AND lifecycle = 'configured' ORDER BY name`
        )
        .all(...withCheck)
        .map((r: any) => r.name);
    }
  } catch {
    /* no curated model, nothing checkable */
  }
  return [];
}

/**
 * What the graph can prove versus what it merely lists.
 *
 * Reached capabilities split by the worth of their evidence: proven (check
 * passed), unproven (configured, never checked), failing (check now fails).
 * The unproven-with-a-declared-check set is named, because it is the one a
 * single command turns into evidence — and an inventory that cannot say
 * "installed is not working" is the failure this project exists to prevent.
 */
function evidenceReport(db: any, checkable: string[] = checkableNames(db)) {
  // The nodes the summary counts, which is every kind but an action. A skill an
  // agent registered carries a check and a derived lifecycle as a curated
  // capability does, and counting capabilities alone left a failing skill out
  // of the row while the head counted it. An action is conferred by a
  // capability and is counted through it, as `graphCounts` counts it.
  const rows = db
    .prepare(
      `SELECT lifecycle, COUNT(*) AS n FROM capabilities
       WHERE kind != 'action' AND ${REACHED_SQL} GROUP BY lifecycle`
    )
    .all();
  const count = (...ls: string[]) =>
    rows.filter((r: any) => ls.includes(r.lifecycle)).reduce((s: number, r: any) => s + r.n, 0);

  const last = db
    .prepare(`SELECT MAX(timestamp) AS t FROM session_learning WHERE ${CHECK_RUN_SQL}`)
    .get();

  return {
    proven: count(...PROVEN),
    unproven: count('configured'),
    // The summary's own count, so this row and the head cannot disagree.
    failing: graphCounts(db).failing,
    last_check: ago(last?.t) || 'never',
    provable_now: checkable.slice(0, 8),
    note: checkable.length
      ? `configured is not working — ambit verify would turn ${checkable.length} of the unproven into evidence`
      : undefined,
  };
}

/**
 * What is wrong, as the short phrases a summary line joins, in the order a
 * person would fix them. The report's `summary` and the line `renderStatus`
 * draws both take their worries from here, so the two cannot disagree about
 * what counted.
 */
function worries(found: {
  failing: number;
  degraded?: unknown[];
  spofs?: unknown;
  pending?: unknown[];
}): string[] {
  return [
    found.failing ? `${found.failing} failing` : null,
    found.degraded?.length ? `${found.degraded.length} degraded` : null,
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
 * checks that turn configured into proven, which is the whole of a fresh
 * install. Last is the capability `ambit next` ranks first. Absent when none
 * of them has anything to say, and the report then ends without the line.
 */
function nextMove(
  db: any,
  found: { degraded: { id: string; name: string }[]; drafts: number; checkable: number }
): NextMove | undefined {
  const [first] = found.degraded;
  if (first) {
    return {
      command: `ambit verify ${shellQuote(first.id.replace(/^combo:/, ''))}`,
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
      why: `turns ${found.checkable} of the unproven into evidence`,
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
  const domains = db
    .prepare(
      `SELECT domain, COUNT(*) as total, SUM(CASE WHEN ${REACHED_SQL} THEN 1 ELSE 0 END) as reached
       FROM capabilities WHERE kind != 'action' GROUP BY domain ORDER BY domain`
    )
    .all();
  const actions = db
    .prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN ${REACHED_SQL} THEN 1 ELSE 0 END) as reached
       FROM capabilities WHERE kind = 'action'`
    )
    .get();

  // Degraded means configured but not working — the decision-relevant reading
  // of "decay". A lifecycle-failing capability is a repair, not an acquisition.
  // These are the nodes `graphCounts` counts as failing, by name, so the head,
  // the evidence row and the line the report ends on all count one set. An
  // action is left out as the summary leaves it out; the capability that
  // confers it is what the report names.
  const degraded = db
    .prepare(
      `SELECT id, name, domain FROM capabilities
       WHERE kind != 'action' AND ${FAILING_SQL} ORDER BY id`
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
  const worried = worries({ failing: g.failing, degraded, spofs, pending });
  const checkable = checkableNames(db);

  return {
    summary:
      `${g.reached}/${g.total} capabilities reached` +
      (worried.length ? ` · ${worried.join(' · ')}` : ' · nothing failing'),
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
    context_thrash:
      g.failing > 0
        ? [
            {
              at_risk_tokens: g.failing * 32000,
              note: `${g.failing} degraded capabilities risk triggering agent retry thrash loops`,
            },
          ]
        : undefined,
    degraded: degraded.length ? degraded : undefined,
    spofs,
    bottlenecks: findBottlenecks(db).slice(0, 10),
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

/** The keys the head of `renderStatus` says, so the details beneath it skip them. */
const SAID_IN_HEAD = new Set([
  'summary',
  'reached',
  'total',
  'verified',
  'failing',
  'evidence',
  'next',
]);

/**
 * `ambit status` as a person reads it, as lines.
 *
 * The head carries the two numbers that matter, reached and proven, and the
 * worries the report's own summary names. Under a rule come the evidence
 * counts in one aligned column, with a marker on the one that wants a person:
 * a failing check before an unproven one, since a repair comes before an
 * acquisition. The marker is a character and colour only adds to it, so the
 * row is found in a pipe and by someone who cannot tell the colours apart.
 * Whatever else the report found follows as it always has, and the last line
 * is the one thing to type next, taken from the report's `next`.
 *
 * Pure: the palette comes in as a parameter and nothing here reads the
 * terminal, which is what lets a test ask for both renderings.
 */
function renderStatus(report: StatusReport, c: Palette = C): string[] {
  const ev = report.evidence[0];
  const lead = `${report.reached} of ${report.total} reached · ${ev.proven} proven`;
  const worried = worries(report);
  const tail = worried.length ? worried.join(' · ') : 'nothing failing';

  const rows: [label: string, value: string][] = [
    ['proven', String(ev.proven)],
    ['unproven', String(ev.unproven)],
    ['failing', String(ev.failing)],
    ['last check', ev.last_check],
  ];
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  const valueWidth = Math.max(...rows.map(([, value]) => value.length));
  const wants = ev.failing ? 'failing' : ev.unproven ? 'unproven' : undefined;

  const head = [
    `${GUTTER}${c.bold}${lead}${c.reset} · ${tail}`,
    `${GUTTER}${c.grey}${'─'.repeat(Math.min(`${lead} · ${tail}`.length, 72))}${c.reset}`,
    ...rows.map(([label, value]) => {
      const cells = `${label.padEnd(labelWidth)}  ${value.padStart(valueWidth)}`;
      if (label === wants) return `  ${c.accent}${c.bold}› ${cells}${c.reset}`;
      return label === 'last check'
        ? `${GUTTER}${c.grey}${cells}${c.reset}`
        : `${GUTTER}${c.grey}${label.padEnd(labelWidth)}${c.reset}  ${value.padStart(valueWidth)}`;
    }),
  ];

  // What the head does not say, as it was always drawn. The names `verify`
  // would check stay here, since the head only has room for how many.
  const rest = Object.fromEntries(Object.entries(report).filter(([key]) => !SAID_IN_HEAD.has(key)));
  const details = formatGeneric(
    { actions: rest.actions, provable_now: ev.provable_now, ...rest },
    c
  );
  while (details[0] === '') details.shift();
  while (details[details.length - 1] === '') details.pop();

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
 * count of what was unproven and sixty lines of single providers and
 * bottlenecks, ending on a suggestion to run checks. That is the guardrail
 * shown before the purpose. This leads with the next steps `ambit next` ranks,
 * keeps a failing check and the unproven count as the two things worth
 * knowing first, and leaves the rest of the fragility detail to `status`.
 */
function briefReport(db: any) {
  const sources = seedSources(db);
  const counts = graphCounts(db);
  const checkable = checkableNames(db);
  const ev = evidenceReport(db, checkable);
  const failing = db
    .prepare(
      `SELECT id, name FROM capabilities
       WHERE kind != 'action' AND ${FAILING_SQL} ORDER BY id`
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
    proven: ev.proven,
    unproven: ev.unproven,
    failing: failing.map(f => ({
      name: f.name,
      command: `ambit verify ${shellQuote(f.id.replace(/^combo:/, ''))}`,
    })),
    next,
  };
}

type BriefReport = ReturnType<typeof briefReport>;

/** "Claude Code (3 servers) and Cursor (2 servers)". */
function readFrom(read: { label: string; servers: string[] }[]): string {
  const parts = read.map(
    r => `${r.label} (${r.servers.length} ${r.servers.length === 1 ? 'server' : 'servers'})`
  );
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : parts[0];
}

/** The short screen as lines; pure, like `renderStatus`. */
function renderBrief(report: BriefReport, c: Palette = C): string[] {
  const heading = (text: string) => `${c.bold}${text}${c.reset}`;
  // No leading blank: the first run's seed report ends on one already.
  const lines = [heading('Where you are')];
  const footer = [
    '',
    `${GUTTER}${c.bold}ambit status${c.reset}  ${c.grey}the full report: single providers, bottlenecks, the frontier${c.reset}`,
    `${GUTTER}${c.bold}ambit web${c.reset}     ${c.grey}the map, on localhost${c.reset}`,
    `${GUTTER}${c.bold}ambit --help${c.reset}  ${c.grey}every command, and ambit help <term> for a word${c.reset}`,
    '',
  ];

  if (report.read && report.read.length === 0) {
    // Counts here would describe the curated model and read as the person's.
    lines.push(
      `${GUTTER}Nothing of yours is in the graph yet.`,
      `${GUTTER}${c.grey}Add an agent config and run ambit seed, which lists where it looks.${c.reset}`
    );
    return [...lines, ...footer];
  }

  if (report.read) lines.push(`${GUTTER}${c.grey}Read from ${readFrom(report.read)}${c.reset}`);
  lines.push(
    `${GUTTER}${report.reached} of ${report.total} capabilities reached · ${report.proven} proven`
  );
  const moved = report.moved ? movedLines(report.moved, c) : [];
  if (moved.length) {
    const when = ago(report.moved!.since);
    lines.push(
      `${GUTTER}${c.grey}Since you last looked${when ? `, ${when}` : ''}:${c.reset}`,
      ...moved
    );
  }

  if (report.next.length) {
    lines.push('', heading('What one more step opens'));
    for (const n of report.next) {
      const cost = n.cost === 'unknown' ? '' : ` ${c.grey}· about ${n.cost}${c.reset}`;
      lines.push(
        `  ${c.accent}${c.bold}›${c.reset} ${c.bold}${n.capability}${c.reset}${cost}`,
        `${GUTTER}${n.why}`,
        `${GUTTER}${c.grey}${n.command}${c.reset}`
      );
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
        `  ${c.yellow}!${c.reset} ${report.failing.length} configured and failing a check: ${shown}${more} ${c.grey}· ${report.failing[0].command}${c.reset}`
      );
    }
    if (report.unproven) {
      lines.push(
        `${GUTTER}${report.unproven} configured and not yet proven ${c.grey}· ambit verify runs their checks${c.reset}`
      );
    }
  }
  return [...lines, ...footer];
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
      `  ${c.yellow}!${c.reset} ${d.name} is configured and failing its check ${c.grey}· ambit verify ${shellQuote(d.id.replace(/^combo:/, ''))}${c.reset}`
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
  if (first) {
    // `ambit propose` drafts a description for a step like these, which a
    // person then does by hand, so the honest next move is the step itself.
    lines.push(
      `${GUTTER}${c.accent}${c.bold}Next${c.reset}  ${c.bold}${first.name}${c.reset}${c.grey}, then ambit seed: the list moves as each step lands${c.reset}`
    );
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
  if (ends.length) {
    lines.push(`  ${c.accent}${c.bold}›${c.reset} ${c.bold}Stops working${c.reset}  ${list(ends)}`);
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

/** The concept glossary, shared with the visualiser so the two cannot drift. */
function explain(wanted: string): void {
  const { concepts } = JSON.parse(
    readFileSync(join(ENGINE_DIR, '..', 'shared', 'concepts.json'), 'utf8')
  );
  // Matched against the whole entry, not just its name: a concept the CLI and
  // the map call different things — keystone on the map, bottlenecks in
  // `ambit status` — says so in its own text, and looking up either word
  // should find it.
  const picked = wanted
    ? concepts.filter((c: any) =>
        [c.key, c.term, c.short, c.long, c.seen].join(' ').toLowerCase().includes(wanted)
      )
    : concepts;
  // An agent asks what a term means as readily as a person does, and reads
  // the answer through a pipe.
  const paint = terminalPalette();
  if (picked.length === 0) {
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
  if (!wanted)
    console.log(`${paint.grey}ambit help <term> for one of these on its own.${paint.reset}\n`);
}

export {
  ago,
  briefReport,
  renderBrief,
  renderImpact,
  renderPlan,
  evidenceReport,
  statusReport,
  renderStatus,
  worries,
  explain,
  type BriefReport,
  type ImpactReport,
  type NextMove,
  type StatusReport,
};
