import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.ts';
import { FAILING_SQL, REACHED_SQL, graphCounts } from './vocabulary.ts';
import { singlePointsOfFailure } from './inference.ts';
import { clientConfigs } from './mcp-clients.ts';
import { parseJsonc } from '../shared/opencode.ts';

export interface DoctorRuntime {
  runtime: string;
  label: string;
  path: string;
  has_ambit: boolean;
}

export interface DoctorReport {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;
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

/** Compute health score from capabilities, evidence, and single points of failure. */
function computeScore(
  total: number,
  reached: number,
  proven: number,
  failing: number,
  spofCount: number,
  hasConnectedRuntime: boolean
): { score: number; grade: 'A' | 'B' | 'C' | 'D' | 'F' } {
  if (total === 0 || reached === 0) {
    return { score: 0, grade: 'F' };
  }

  // Coverage component: up to 35 points
  const coverage = Math.min(35, Math.round((reached / total) * 35));

  // Assurance component: up to 45 points based on proven ratio
  const assurance = Math.min(45, Math.round((proven / reached) * 45));

  // Base integration bonus: 10 points if at least one runtime has Ambit meta-MCP
  const integrationBonus = hasConnectedRuntime ? 10 : 0;

  // Penalties
  const failingPenalty = failing * 15;
  const spofPenalty = Math.min(20, spofCount * 4);

  const rawScore = coverage + assurance + integrationBonus + 10 - failingPenalty - spofPenalty;
  const score = Math.max(0, Math.min(100, rawScore));

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
  const { score, grade } = computeScore(
    counts.total,
    counts.reached,
    counts.proven,
    counts.failing,
    spofs.length,
    hasConnected
  );

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
  if (counts.reached > counts.proven) {
    const unproven = counts.reached - counts.proven;
    recommendations.push(
      `Verify ${unproven} unproven tools: run "ambit verify" to turn configured tools into evidence`
    );
  }
  if (runtimes.length > 0 && !hasConnected) {
    recommendations.push(
      'Connect Ambit meta-MCP: run "ambit connect" to register pre-flight briefing with agent runtimes'
    );
  }
  if (spofs.length > 0) {
    recommendations.push(
      `Mitigate ${spofs.length} single points of failure: run "ambit credentials" to inspect shared tokens`
    );
  }
  recommendations.push('Inspect interactive tech tree: run "ambit web" to explore your setup map');

  const summary = `${grade} (${score}/100) : ${counts.reached}/${counts.total} reached, ${counts.proven} verified, ${counts.failing} failing`;

  return {
    score,
    grade,
    summary,
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
