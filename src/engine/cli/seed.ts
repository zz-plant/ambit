/**
 * Reading the agent configs and building the graph.
 *
 * One routine for `ambit seed` and for the first-run path, so the two cannot
 * drift on what they read. See `runSeed` for the sources and their order.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeCodeSeedInput, readClaudeCode } from '../claude-code.ts';
import { seedFromConfig } from '../discovery.ts';
import { clientLocations, discoverMcpClients } from '../mcp-clients.ts';
import { configDefault } from '../paths.ts';
import { resolveDbPath } from '../../shared/db-path.ts';
import { mcpEntries, parseJsonc } from '../../shared/opencode.ts';
import { terminalPalette } from './output.ts';

/** What one seed read: the runtime as a person knows it, and the servers it listed. */
export interface SeedSource {
  label: string;
  servers: string[];
}

/** The `schema_meta` key the sources of the last seed are kept under. */
export const SEED_SOURCES_KEY = 'seed-sources';

/** A path as a person would type it: the home directory as `~`. */
function tilde(path: string): string {
  const home = process.env.HOME;
  return home && home !== '/' && path.startsWith(home + '/') ? `~${path.slice(home.length)}` : path;
}

/** The server names an OpenCode config lists, or none when it cannot be read. */
function opencodeServers(path: string): string[] {
  try {
    const { bag } = mcpEntries(parseJsonc(readFileSync(path, 'utf8')));
    return bag ? Object.keys(bag) : [];
  } catch {
    return [];
  }
}

/**
 * The sources the last seed read, or null for a graph seeded before they were
 * recorded. An empty list is an answer: nothing of the person's was found.
 */
export function seedSources(db: any): SeedSource[] | null {
  try {
    const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get(SEED_SOURCES_KEY);
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

/** A list of names, cut at a few with the rest counted. */
function names(list: string[], room = 5): string {
  if (!list.length) return 'no MCP servers';
  return list.length > room
    ? `${list.slice(0, room).join(', ')} and ${list.length - room} more`
    : list.join(', ');
}

/**
 * Read the agent configs and build the graph. One routine for `ambit seed` and
 * for the first-run path below, so the two cannot drift on what they read.
 *
 * Every source found is seeded in turn as its own runtime, so a server two
 * runtimes list is one capability with two providers: opencode.json if present,
 * then, unless OPENCODE_CONFIG is set or a mapping is passed, a Claude Code
 * install and every client `discoverMcpClients` finds. With none of them it
 * seeds the curated capability model alone, and says so instead of passing that
 * off as a discovered environment.
 */
function runSeed(db: any, mappingOverride?: string, quiet = false): void {
  const say = quiet ? (_: string) => {} : console.log;
  const cfg = configDefault();
  const explicit = Boolean(process.env.OPENCODE_CONFIG || mappingOverride);
  const sources: Array<{
    runtime: string;
    label: string;
    path: string;
    servers: string[];
    mapping?: string;
    temporary?: boolean;
  }> = [];

  if (existsSync(cfg)) {
    sources.push({
      runtime: process.env.AMBIT_RUNTIME || 'opencode',
      label: 'OpenCode',
      path: cfg,
      servers: opencodeServers(cfg),
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
        servers: Object.keys(fragment.mcp),
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
        servers: Object.keys(client.config.mcp),
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

  const read: SeedSource[] = sources.map(({ label, servers }) => ({ label, servers }));
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, applied_at = datetime('now')`
  ).run(SEED_SOURCES_KEY, JSON.stringify(read));

  // `kind != 'action'` is what makes a row a capability, and every count shown
  // to a person has to use it. Counting the whole table here reported 69 where
  // `ambit status` reported 41 a second later, in the same run of bootstrap.
  const c = db.prepare("SELECT COUNT(*) as cnt FROM capabilities WHERE kind != 'action'").get();
  // Printed by `ambit seed`, bootstrap.sh and the first run alike, any of which
  // may be writing to a pipe or a log.
  const paint = terminalPalette();
  if (sources.length) {
    // What was read, by name: the first thing a cautious person checks is
    // whether it found the servers they know they have.
    const width = Math.max(...read.map(r => r.label.length));
    for (const r of read) {
      say(
        `  ${paint.green}✓${paint.reset} ${r.label.padEnd(width)}  ${paint.grey}${names(r.servers)}${paint.reset}`
      );
    }
  } else {
    // Say so, and say where it looked: naming one runtime's path told a Cursor
    // or Claude Code user that Ambit reads OpenCode alone.
    say(`  ${paint.yellow}!${paint.reset} No agent config found. Looked for:`);
    const looked = [
      { label: 'OpenCode', path: cfg },
      {
        label: 'Claude Code',
        path: process.env.CLAUDE_CONFIG || `${process.env.HOME || ''}/.claude.json`,
      },
      ...clientLocations(),
    ];
    const width = Math.max(...looked.map(l => l.label.length));
    for (const l of looked) {
      say(`      ${l.label.padEnd(width)}  ${paint.grey}${tilde(l.path)}${paint.reset}`);
    }
    say(
      `    ${paint.grey}A config kept somewhere else: OPENCODE_CONFIG=/path/to/opencode.json ambit seed${paint.reset}`
    );
  }
  // Where it wrote, and that nothing went anywhere else: said on every seed,
  // since the seed is the moment a person decides whether to trust the tool.
  const whose = sources.length ? '' : ', all from the curated model,';
  say(
    `    ${paint.grey}${c?.cnt ?? 0} capabilities${whose} written to ${tilde(resolveDbPath())}. Nothing was sent anywhere.${paint.reset}`
  );
}

export { runSeed };
