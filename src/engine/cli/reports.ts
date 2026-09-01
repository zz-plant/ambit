/**
 * The two reports the CLI composes itself rather than delegating to the engine,
 * and the glossary behind `ambit help <term>`.
 *
 * `statusReport` is what `ambit status` answers with; `evidenceReport` is the
 * part of it that separates what the graph can prove from what it merely
 * lists. Both read several engine modules and shape one answer, which is why
 * they live beside the CLI rather than in the engine.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_DIR, loadTechTree } from '../paths.ts';
import { findBottlenecks, singlePointsOfFailure } from '../inference.ts';
import { ledgerHistory } from '../ledger.ts';
import { deficits } from '../planning.ts';
import { listProposals } from '../governance.ts';
import { C } from './output.ts';

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
 * Reached capabilities split by the worth of their evidence: proven (check
 * passed), unproven (configured, never checked), failing (check now fails).
 * The unproven-with-a-declared-check set is named, because it is the one a
 * single command turns into evidence — and an inventory that cannot say
 * "installed is not working" is the failure this project exists to prevent.
 */
function evidenceReport(db: any) {
  // Only kind='capability' carries a derived lifecycle — providers and
  // resources are the things supplying capabilities, not claims to verify.
  const rows = db
    .prepare(
      `SELECT lifecycle, COUNT(*) AS n FROM capabilities
     WHERE kind = 'capability' AND state IN ('unlocked','active') GROUP BY lifecycle`
    )
    .all();
  const count = (...ls: string[]) =>
    rows.filter((r: any) => ls.includes(r.lifecycle)).reduce((s: number, r: any) => s + r.n, 0);

  let checkable: string[] = [];
  try {
    const tree = loadTechTree();
    const withCheck = (tree.nodes || [])
      .filter((n: any) => n.verify?.command)
      .map((n: any) => `combo:${n.id}`);
    if (withCheck.length) {
      const placeholders = withCheck.map(() => '?').join(',');
      checkable = db
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

  const last = db
    .prepare(
      "SELECT MAX(timestamp) AS t FROM session_learning WHERE action IN ('verified','failed')"
    )
    .get();

  return {
    proven: count('verified', 'reliable'),
    unproven: count('configured'),
    failing: count('degraded', 'broken'),
    last_check: ago(last?.t) || 'never',
    provable_now: checkable.slice(0, 8),
    note: checkable.length
      ? `configured is not working — ambit verify would turn ${checkable.length} of the unproven into evidence`
      : undefined,
  };
}

// The report `status` composes. One surface for "how are we doing", so the
// person does not have to learn six commands to answer one question.
function statusReport(db: any) {
  const g = db
    .prepare(
      "SELECT COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as reached, SUM(CASE WHEN lifecycle IN ('verified','reliable') THEN 1 ELSE 0 END) as verified, SUM(CASE WHEN lifecycle IN ('degraded','broken') THEN 1 ELSE 0 END) as failing FROM capabilities WHERE kind != 'action'"
    )
    .get();
  const domains = db
    .prepare(
      "SELECT domain, COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as reached FROM capabilities WHERE kind != 'action' GROUP BY domain ORDER BY domain"
    )
    .all();
  const actions = db
    .prepare(
      "SELECT COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as reached FROM capabilities WHERE kind = 'action'"
    )
    .get();

  // Degraded means configured but not working — the decision-relevant reading
  // of "decay". A lifecycle-failing capability is a repair, not an acquisition.
  const degraded = db
    .prepare(
      `SELECT id, name, domain FROM capabilities
     WHERE state IN ('unlocked','active') AND lifecycle IN ('degraded','broken')
     ORDER BY id`
    )
    .all();

  const proposals = listProposals(db);
  const pending = Array.isArray(proposals)
    ? proposals.filter((p: any) => p.status === 'draft' || p.status === 'approved')
    : [];

  // A sentence before the dump. `status` knew the worst thing about the
  // environment — the failing checks, the sole-provider capabilities, the
  // approvals waiting on a person — and made the reader assemble it from
  // eleven nested sections. The fields below still carry all of it.
  const spofs = singlePointsOfFailure(db);
  const worries = [
    g.failing ? `${g.failing} failing` : null,
    degraded.length ? `${degraded.length} degraded` : null,
    Array.isArray(spofs) && spofs.length ? `${spofs.length} with a single provider` : null,
    pending.length ? `${pending.length} awaiting approval` : null,
  ].filter(Boolean);

  return {
    summary:
      `${g.reached}/${g.total} capabilities reached` +
      (worries.length ? ` · ${worries.join(' · ')}` : ' · nothing failing'),
    reached: g.reached,
    total: g.total,
    verified: g.verified,
    failing: g.failing,
    actions: actions?.total ? { reached: actions.reached, total: actions.total } : undefined,
    // An array of one, not an object: the generic renderer prints nested rows
    // and skips nested objects, and this block must reach the reader.
    evidence: [evidenceReport(db)],
    domains,
    degraded: degraded.length ? degraded : undefined,
    spofs,
    bottlenecks: findBottlenecks(db).slice(0, 10),
    deficits: deficits(db),
    frontier: ledgerHistory(db).slice(-5),
    pending,
  };
}

/** The concept glossary, shared with the visualiser so the two cannot drift. */
function explain(wanted: string): void {
  const { concepts } = JSON.parse(
    readFileSync(join(ENGINE_DIR, '..', 'shared', 'concepts.json'), 'utf8')
  );
  const picked = wanted
    ? concepts.filter((c: any) => c.key.includes(wanted) || c.term.toLowerCase().includes(wanted))
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

export { ago, evidenceReport, statusReport, explain };
