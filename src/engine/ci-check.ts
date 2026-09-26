import { appendFileSync } from 'node:fs';
import type { Db } from './db.ts';
import { FAILING_SQL, REACHED_SQL, graphCounts } from './vocabulary.ts';
import { singlePointsOfFailure } from './inference.ts';

export interface CiCheckResult {
  ok: boolean;
  exit_code: number;
  strict: boolean;
  summary: string;
  failures: string[];
  warnings: string[];
  markdown: string;
}

/** Evaluates capability invariants for CI/CD pipelines. */
export function runCiCheck(
  db: Db,
  options: { strict?: boolean; writeStepSummary?: boolean } = {}
): CiCheckResult {
  const strict = options.strict ?? false;
  const counts = graphCounts(db);
  const rawSpofs = singlePointsOfFailure(db);
  const spofs = Array.isArray(rawSpofs) ? rawSpofs : [];

  let degraded: { id: string; name: string }[] = [];
  try {
    degraded = db
      .prepare(
        `SELECT id, name FROM capabilities
         WHERE ${REACHED_SQL} AND ${FAILING_SQL} ORDER BY name`
      )
      .all<any>();
  } catch {
    degraded = [];
  }

  const failures: string[] = [];
  const warnings: string[] = [];

  if (counts.failing > 0 || degraded.length > 0) {
    for (const d of degraded) {
      failures.push(`Degraded capability failing declared check: ${d.name} (${d.id})`);
    }
  }

  if (strict) {
    if (counts.proven < counts.reached) {
      failures.push(
        `Strict mode violation: ${counts.reached - counts.proven} capabilities have not been proven with declared checks`
      );
    }
    if (spofs.length > 0) {
      failures.push(
        `Strict mode violation: ${spofs.length} capabilities rely on a single point of failure`
      );
    }
  } else {
    if (counts.proven < counts.reached) {
      warnings.push(
        `${counts.reached - counts.proven} unverified capabilities present in environment`
      );
    }
    if (spofs.length > 0) {
      warnings.push(`${spofs.length} single points of failure detected`);
    }
  }

  const ok = failures.length === 0;
  const exit_code = ok ? 0 : 1;
  const statusBadge = ok ? 'PASSED' : 'FAILED';

  const markdownLines = [
    `### Ambit Capability Guard: ${statusBadge}`,
    '',
    `- **Status:** ${statusBadge}`,
    `- **Reached Capabilities:** ${counts.reached} / ${counts.total}`,
    `- **Verified (Proven):** ${counts.proven} / ${counts.reached}`,
    `- **Failing Checks:** ${counts.failing}`,
    `- **Strict Mode:** ${strict ? 'Enabled' : 'Disabled'}`,
    '',
  ];

  if (failures.length > 0) {
    markdownLines.push('#### Critical Failures');
    for (const f of failures) markdownLines.push(`- ❌ ${f}`);
    markdownLines.push('');
  }

  if (warnings.length > 0) {
    markdownLines.push('#### Warnings');
    for (const w of warnings) markdownLines.push(`- ⚠️ ${w}`);
    markdownLines.push('');
  }

  const markdown = markdownLines.join('\n');

  if (options.writeStepSummary && process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
    } catch {
      // ignore write error in environments without file write permissions
    }
  }

  const summary = ok
    ? `Ambit CI Guard PASSED: ${counts.proven}/${counts.reached} capabilities verified, 0 failing.`
    : `Ambit CI Guard FAILED: ${failures.length} check violations found.`;

  return {
    ok,
    exit_code,
    strict,
    summary,
    failures,
    warnings,
    markdown,
  };
}
