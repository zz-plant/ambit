/**
 * The two reports the CLI composes itself rather than delegating to the engine,
 * and the glossary behind `ambit help <term>`.
 *
 * `statusReport` is what `ambit status` answers with; `evidenceReport` is the
 * part of it that separates what the graph can prove from what it merely
 * lists. Both read several engine modules and shape one answer, which is why
 * they live beside the CLI rather than in the engine. `renderStatus` is how
 * that answer looks to a person; `--json` and the tests get the data.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shellQuote } from '../../shared/shell.ts';
import { ENGINE_DIR, loadTechTree } from '../paths.ts';
import { findBottlenecks, singlePointsOfFailure } from '../inference.ts';
import { ledgerHistory } from '../ledger.ts';
import { deficits } from '../planning.ts';
import { listProposals } from '../governance.ts';
import { nextSteps } from '../next.ts';
import { C, formatGeneric, type Palette } from './output.ts';
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
  if (picked.length === 0) {
    console.log(`${C.yellow}No concept matching "${wanted}".${C.reset}`);
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
    console.log(`${C.bold}${c.term}${C.reset} ${C.grey}— ${c.short}${C.reset}`);
    console.log(wrap(c.long));
    console.log(`  ${C.grey}Where you see it: ${c.seen}${C.reset}`);
    console.log('');
  }
  if (!wanted) console.log(`${C.grey}ambit help <term> for one of these on its own.${C.reset}\n`);
}

export {
  ago,
  evidenceReport,
  statusReport,
  renderStatus,
  worries,
  explain,
  type NextMove,
  type StatusReport,
};
