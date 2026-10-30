import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.ts';
import { FAILING_SQL, REACHED_SQL, graphCounts, reachPhrase } from './vocabulary.ts';
import { singlePointsOfFailure } from './inference.ts';
import { clientConfigs } from './mcp-clients.ts';
import { parseJsonc } from '../shared/opencode.ts';
import { checkableNames } from './assurance.ts';

export interface DoctorRuntime {
  runtime: string;
  label: string;
  path: string;
  has_ambit: boolean;
}

export interface DoctorReport {
  /** Null until any check has proved or failed something: there is nothing to grade. */
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | null;
  summary: string;
  /** "9 of 46 capabilities reached, and 9 of your own", as every surface says it. */
  reach: string;
  capabilities: {
    total: number;
    reached: number;
    proven: number;
    failing: number;
    degraded: { id: string; name: string; domain: string }[];
  };
  spofs: { capability: string; provider: string }[];
  runtimes_detected: DoctorRuntime[];
  recommendations: string[];
}

/** Check if a parsed JSON or TOML config already contains the ambit MCP server. */
function hasAmbitServer(raw: string): boolean {
  try {
    const parsed = parseJsonc(raw);
    if (parsed?.mcpServers?.ambit) return true;
    if (parsed?.mcp?.ambit) return true;
    if (parsed?.mcp?.servers?.ambit) return true;
    if (parsed?.context_servers?.ambit) return true;
    if (parsed?.experimental?.modelContextProtocolServers?.ambit) return true;
  } catch {
    // If not valid JSON, check for simple TOML table
    if (/\[mcp_servers\.ambit\]/i.test(raw)) return true;
  }
  return false;
}

/**
 * Detect installed agent runtimes and check if Ambit is connected.
 *
 * OpenCode and Claude Code have readers of their own; every other runtime is
 * the one discovery reads, through `clientConfigs`, so a runtime added there
 * is detected here too. This kept a list of its own and knew seven.
 */
export function detectRuntimes(home = process.env.HOME || '/'): DoctorRuntime[] {
  const own: { runtime: string; label: string; paths: string[] }[] = [
    {
      runtime: 'claude-code',
      label: 'Claude Code',
      paths: [join(home, '.claude.json')],
    },
    {
      runtime: 'opencode',
      label: 'OpenCode',
      paths: [
        join(home, '.config', 'opencode', 'opencode.json'),
        join(home, '.config', 'opencode', 'opencode.jsonc'),
      ],
    },
  ];

  const detected: DoctorRuntime[] = [];
  for (const c of own) {
    const p = c.paths.find(candidatePath => existsSync(candidatePath));
    if (!p) continue;
    let hasAmbit = false;
    try {
      hasAmbit = hasAmbitServer(readFileSync(p, 'utf8'));
    } catch {
      // unreadable file
    }
    detected.push({ runtime: c.runtime, label: c.label, path: p, has_ambit: hasAmbit });
  }
  for (const c of clientConfigs(home)) {
    detected.push({
      runtime: c.runtime,
      label: c.label,
      path: c.path,
      has_ambit: Boolean(c.servers && Object.hasOwn(c.servers, 'ambit')),
    });
  }
  return detected;
}

/**
 * The grade, from what a person can act on.
 *
 * It was 35 points for the share of the whole curated tree reached, 45 for
 * proven out of everything reached, and up to 20 off for single providers.
 * The first fell whenever the tree grew, the second counted nodes that declare
 * no check and can never be proven, and the third charged every setup for the
 * built-in tools (Shell Execution has one provider by nature), so a machine
 * whose every check passed scored under 30, an F.
 *
 * Now: 60 for proven out of what can be proven (proven, failing, and what has
 * a check and has not run it), 30 for redundancy, five off for each capability
 * one server or model holds up alone, 10 for Ambit being connected to a
 * runtime, and 15 off for each failing check.
 */
function computeScore(
  proven: number,
  failing: number,
  provable: number,
  spofCount: number,
  hasConnectedRuntime: boolean
): { score: number; grade: 'A' | 'B' | 'C' | 'D' | 'F' } {
  const base = proven + failing + provable;
  const evidence = base ? Math.round((proven / base) * 60) : 0;
  const redundancy = Math.max(0, 30 - spofCount * 5);
  const connection = hasConnectedRuntime ? 10 : 0;
  const score = Math.max(0, Math.min(100, evidence + redundancy + connection - failing * 15));

  let grade: 'A' | 'B' | 'C' | 'D' | 'F' = 'F';
  if (score >= 90) grade = 'A';
  else if (score >= 75) grade = 'B';
  else if (score >= 60) grade = 'C';
  else if (score >= 45) grade = 'D';

  return { score, grade };
}

/** Runs the full environment diagnostic audit. */
export function runDoctor(db: Db, home?: string): DoctorReport {
  const counts = graphCounts(db);
  const rawSpofs = singlePointsOfFailure(db);
  const spofs = Array.isArray(rawSpofs) ? rawSpofs : [];
  const runtimes = detectRuntimes(home);

  let degraded: { id: string; name: string; domain: string }[] = [];
  try {
    degraded = db
      .prepare(
        `SELECT id, name, domain FROM capabilities
         WHERE ${REACHED_SQL} AND ${FAILING_SQL} ORDER BY name`
      )
      .all<any>();
  } catch {
    // a database too old to answer: nothing named
  }

  const hasConnected = runtimes.some(r => r.has_ambit);
  // Nearly half the score is how much is proven, so a setup no check had run
  // on yet scored 5 and was graded F on its first look: a fresh, working
  // machine told it was failing. With no evidence either way there is no
  // grade, and the summary says what would give it one.
  const evidence = counts.proven + counts.failing > 0;
  // A capability a built-in tool holds up alone is no one's to fix: every
  // runtime ships one shell and one editor.
  const fixable = spofs.filter(s => !String(s.provider_id ?? '').startsWith('tool:'));
  const provable = checkableNames(db).length;
  const graded = computeScore(
    counts.proven,
    counts.failing,
    provable,
    fixable.length,
    hasConnected
  );
  const score = evidence ? graded.score : null;
  const grade = evidence ? graded.grade : null;

  // It also reported a token-thrash risk in dollars: 32,000 tokens per failing
  // check, 12,000 "prevented" per proven one, at $3 a million. Nothing measured
  // any of it, so it is gone, as the same figure went from the receipt and the
  // loop page (AGENTS.md rule 16).

  const recommendations: string[] = [];
  if (counts.failing > 0) {
    recommendations.push(
      `Fix ${counts.failing} failing capabilities: run "ambit verify --failing" to re-run their declared checks`
    );
  }
  // Only what a check can still prove: most reached nodes declare none, and
  // telling someone who just ran every check to run them again sends them
  // round in a circle.
  if (provable > 0) {
    recommendations.push(
      `Verify ${provable} unverified ${provable === 1 ? 'capability' : 'capabilities'}: run "ambit verify" to turn configured into verified`
    );
  }
  if (runtimes.length > 0 && !hasConnected) {
    recommendations.push(
      'Connect Ambit meta-MCP: run "ambit connect" to register pre-flight briefing with agent runtimes'
    );
  }
  if (fixable.length > 0) {
    recommendations.push(
      `${fixable.length} ${fixable.length === 1 ? 'capability rests' : 'capabilities rest'} on one server or model alone: "ambit status" lists them, and a second provider for any of them raises the grade`
    );
  }
  recommendations.push('Inspect interactive tech tree: run "ambit web" to explore your setup map');

  const reach = reachPhrase(db);
  const summary = evidence
    ? `${grade} (${score}/100) : ${reach}, ${counts.proven} verified, ${counts.failing} failing`
    : `Not graded yet: ${reach}, and no check has run, so nothing is verified or failing. ambit verify runs them.`;

  return {
    score,
    grade,
    summary,
    reach,
    capabilities: {
      total: counts.total,
      reached: counts.reached,
      proven: counts.proven,
      failing: counts.failing,
      degraded,
    },
    spofs: spofs.map(s => ({
      capability: String(s.capability || s.name || ''),
      provider: String(s.provider || ''),
    })),
    runtimes_detected: runtimes,
    recommendations,
  };
}
