import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.ts';
import { FAILING_SQL, REACHED_SQL, graphCounts } from './vocabulary.ts';
import { singlePointsOfFailure } from './inference.ts';

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
  context_thrash: {
    at_risk_tokens: number;
    prevented_tokens: number;
    estimated_risk_dollars: number;
  };
  recommendations: string[];
}

/** Check if a parsed JSON or TOML config already contains the ambit MCP server. */
function hasAmbitServer(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.mcpServers?.ambit) return true;
    if (parsed?.mcp?.ambit) return true;
    if (parsed?.context_servers?.ambit) return true;
    if (parsed?.experimental?.modelContextProtocolServers?.ambit) return true;
  } catch {
    // If not valid JSON, check for simple TOML table
    if (/\[mcp_servers\.ambit\]/i.test(raw)) return true;
  }
  return false;
}

/** Detect installed agent runtimes and check if Ambit is connected. */
export function detectRuntimes(home = process.env.HOME || '/'): DoctorRuntime[] {
  const candidates: { runtime: string; label: string; paths: string[] }[] = [
    {
      runtime: 'claude-code',
      label: 'Claude Code',
      paths: [join(home, '.claude.json')],
    },
    {
      runtime: 'cursor',
      label: 'Cursor',
      paths: [join(home, '.cursor', 'mcp.json')],
    },
    {
      runtime: 'claude-desktop',
      label: 'Claude Desktop',
      paths: [
        join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
        join(home, '.config', 'Claude', 'claude_desktop_config.json'),
      ],
    },
    {
      runtime: 'opencode',
      label: 'OpenCode',
      paths: [join(home, '.config', 'opencode', 'opencode.json')],
    },
    {
      runtime: 'windsurf',
      label: 'Windsurf',
      paths: [join(home, '.codeium', 'windsurf', 'mcp_config.json')],
    },
    {
      runtime: 'continue',
      label: 'Continue',
      paths: [join(home, '.continue', 'config.json')],
    },
    {
      runtime: 'codex',
      label: 'Codex CLI',
      paths: [join(home, '.codex', 'config.toml')],
    },
  ];

  const detected: DoctorRuntime[] = [];
  for (const c of candidates) {
    const p = c.paths.find(candidatePath => existsSync(candidatePath));
    if (!p) continue;
    let hasAmbit = false;
    try {
      const raw = readFileSync(p, 'utf8');
      hasAmbit = hasAmbitServer(raw);
    } catch {
      // unreadable file
    }
    detected.push({
      runtime: c.runtime,
      label: c.label,
      path: p,
      has_ambit: hasAmbit,
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
    // degraded query fallback
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

  // Calculate token thrash risk
  const atRiskTokens = counts.failing * 32000;
  const preventedTokens = counts.proven * 12000;
  const estimatedRiskDollars = Math.round((atRiskTokens / 1000000) * 300) / 100;

  const recommendations: string[] = [];
  if (counts.failing > 0) {
    recommendations.push(
      `Fix ${counts.failing} degraded capabilities: run "ambit verify" to inspect failing declared checks`
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
    context_thrash: {
      at_risk_tokens: atRiskTokens,
      prevented_tokens: preventedTokens,
      estimated_risk_dollars: estimatedRiskDollars,
    },
    recommendations,
  };
}
