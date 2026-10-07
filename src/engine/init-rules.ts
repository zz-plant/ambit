import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface InitRulesResult {
  ok: boolean;
  file: string;
  action: 'created' | 'appended' | 'already_present';
  note?: string;
}

const AMBIT_RULE_BLOCK = `
<!-- Ambit Pre-flight Protocol -->
## Ambit Capability Protocol
Before running multi-step tooling, invoking external binaries, or assuming authority:
1. Inspect \`ambit://briefing\` (via MCP) or run \`ambit brief\` to verify working capabilities and authority limits.
2. Before running a tool you have not used this session, ask: \`ambit_can\` over MCP, or \`ambit can <capability> --exit-code\` in a shell, which exits 0 to go ahead, 1 to put it to the person and 2 to stop. A stop files the deficit itself, so do not retry it under another name.
3. Do not retry capabilities marked as broken, ungranted, or failing declared checks.
4. Propose permanent capability fixes using \`ambit propose\` when hitting recurring deficits.
`;

/** Inject Ambit pre-flight guidelines into workspace agent instructions. */
export function runInitRules(
  targetFile?: string,
  options: { cwd?: string; dryRun?: boolean } = {}
): InitRulesResult {
  const cwd = options.cwd || process.cwd();
  const dryRun = options.dryRun ?? false;

  let resolvedFile = targetFile;
  if (!resolvedFile) {
    const candidates = ['CLAUDE.md', '.cursorrules', 'AGENTS.md'];
    resolvedFile = candidates.find(c => existsSync(join(cwd, c))) || 'AGENTS.md';
  }

  const fullPath = join(cwd, resolvedFile);
  let existingContent = '';
  let exists = false;

  if (existsSync(fullPath)) {
    exists = true;
    try {
      existingContent = readFileSync(fullPath, 'utf8');
    } catch {
      existingContent = '';
    }
  }

  if (
    existingContent.includes('ambit://briefing') ||
    existingContent.includes('Ambit Pre-flight Protocol')
  ) {
    return {
      ok: true,
      file: fullPath,
      action: 'already_present',
      note: 'Ambit pre-flight guidelines already present in rules file.',
    };
  }

  const newContent = exists
    ? `${existingContent.trimEnd()}\n${AMBIT_RULE_BLOCK}`
    : `# Agent Rules\n${AMBIT_RULE_BLOCK}`;

  if (!dryRun) {
    writeFileSync(fullPath, newContent);
  }

  return {
    ok: true,
    file: fullPath,
    action: exists ? 'appended' : 'created',
    note: exists
      ? 'Appended Ambit pre-flight protocol to existing instructions.'
      : 'Created new agent instruction file with Ambit pre-flight protocol.',
  };
}
