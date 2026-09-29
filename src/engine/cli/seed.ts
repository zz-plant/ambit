/**
 * Reading the agent config and building the graph.
 *
 * One routine for `ambit seed` and for the first-run path, so the two cannot
 * drift on the fallback order: opencode.json if present, else a Claude Code
 * install, else the curated capability model alone — announced as such rather
 * than passed off as a discovered environment.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeCodeSeedInput, readClaudeCode } from '../claude-code.ts';
import { seedFromConfig } from '../discovery.ts';
import { discoverMcpClients } from '../mcp-clients.ts';
import { configDefault } from '../paths.ts';
import { terminalPalette } from './output.ts';

/**
 * Read the agent config and build the graph. One routine for `ambit seed` and
 * for the first-run path below, so the two cannot drift on the fallback order:
 * opencode.json if present, else a Claude Code install, else the curated
 * capability model alone — announced as such rather than passed off as a
 * discovered environment.
 */
function runSeed(db: any, mappingOverride?: string, quiet = false): void {
  const say = quiet ? (_: string) => {} : console.log;
  const cfg = configDefault();
  const explicit = Boolean(process.env.OPENCODE_CONFIG || mappingOverride);
  const sources: Array<{
    runtime: string;
    label: string;
    path: string;
    mapping?: string;
    temporary?: boolean;
  }> = [];

  if (existsSync(cfg)) {
    sources.push({
      runtime: process.env.AMBIT_RUNTIME || 'opencode',
      label: 'OpenCode',
      path: cfg,
      mapping: mappingOverride,
    });
  }
  if (!explicit) {
    const fragment = readClaudeCode();
    if (fragment) {
      const { config, mapping } = claudeCodeSeedInput(fragment);
      const tmp = join(tmpdir(), `ambit-claude-code-seed-${process.pid}.json`);
      writeFileSync(tmp, JSON.stringify(config));
      sources.push({
        runtime: 'claude-code',
        label: 'Claude Code',
        path: tmp,
        mapping: JSON.stringify(mapping),
        temporary: true,
      });
    }
  }

  if (!explicit) {
    for (const client of discoverMcpClients()) {
      const tmp = join(tmpdir(), `ambit-${client.runtime}-seed-${process.pid}.json`);
      writeFileSync(tmp, JSON.stringify(client.config));
      sources.push({
        runtime: client.runtime,
        label: client.label,
        path: tmp,
        mapping: JSON.stringify(client.mapping),
        temporary: true,
      });
    }
  }

  const previousRuntime = process.env.AMBIT_RUNTIME;
  if (sources.length === 0) {
    seedFromConfig(db, undefined, mappingOverride);
  } else {
    sources.forEach((source, index) => {
      process.env.AMBIT_RUNTIME = source.runtime;
      try {
        seedFromConfig(db, source.path, source.mapping, index === sources.length - 1);
      } finally {
        if (source.temporary) rmSync(source.path, { force: true });
      }
    });
  }
  if (previousRuntime === undefined) delete process.env.AMBIT_RUNTIME;
  else process.env.AMBIT_RUNTIME = previousRuntime;

  // `kind != 'action'` is what makes a row a capability, and every count shown
  // to a person has to use it. Counting the whole table here reported 69 where
  // `ambit status` reported 41 a second later, in the same run of bootstrap.
  const c = db.prepare("SELECT COUNT(*) as cnt FROM capabilities WHERE kind != 'action'").get();
  const a = db.prepare("SELECT COUNT(*) as cnt FROM capabilities WHERE kind = 'action'").get();
  const actions = a?.cnt ? ` · ${a.cnt} actions` : '';
  // Printed by `ambit seed`, bootstrap.sh and the first run alike, any of which
  // may be writing to a pipe or a log.
  const paint = terminalPalette();
  say(
    `${paint.green}✓${paint.reset} ${c?.cnt ?? 0} capabilities${paint.grey}${actions}${paint.reset}`
  );
  for (const source of sources) {
    say(`${paint.grey}  Seeded from ${source.label}.${paint.reset}`);
  }
  if (sources.length === 0) {
    // Say so rather than reporting a curated-model-only graph as if it had
    // read the environment. Silence here reads as "your stack is empty".
    say(`${paint.yellow}!${paint.reset} No agent config at ${paint.grey}${cfg}${paint.reset}`);
    say(
      `${paint.grey}  Seeded the capability model only — nothing of yours is in the graph yet.${paint.reset}`
    );
    say(
      `${paint.grey}  Point it at your own config: OPENCODE_CONFIG=/path/to/config.json${paint.reset}`
    );
    // This used to send people to an "Other configurations" section of the
    // README. There is no such section, and there was none when the line was
    // written; AGENTS.md is where the variable is actually described.
    say(
      `${paint.grey}  Another format: set CONFIG_MAPPING to a JSON mapping — see AGENTS.md.${paint.reset}`
    );
  }
}

export { runSeed };
