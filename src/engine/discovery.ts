import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { configDefault } from './paths.ts';
import { normalizeOpencode, opencodeAuthority, parseJsonc } from '../shared/opencode.ts';
import type { Db } from './db.ts';
import { deriveLifecycles } from './assurance.ts';
import { recordFrontier } from './ledger.ts';
import { nodeWriter, parseMapping, retireUndeclared } from './seed/writers.ts';
import { seedTechTree } from './seed/techtree.ts';
import {
  seedActors,
  seedAuthority,
  seedCatalog,
  seedCredentials,
  seedEconomics,
} from './seed/declared.ts';
import {
  attributeToRuntime,
  seedCombos,
  seedDependencies,
  seedInfrastructure,
  seedLocalModels,
  seedModels,
} from './seed/structure.ts';

// ─── Seed ─────────────────────────────────────────────────────────────────────

/**
 * The agent config, in the shape the passes below read.
 *
 * OpenCode's own format is the default input, in either major version and with
 * or without comments (`src/shared/opencode.ts`). The permission a runtime
 * states for a shell command reaches the graph as the runtime's authority, as
 * the Claude Code reader's `defaultMode` does, unless the file carries an
 * `authority` block of Ambit's own, which a person wrote on purpose and wins.
 * Only when OpenCode is the runtime being seeded: an adapter that seeds another
 * runtime through this function states that runtime's authority itself.
 */
function readAgentConfig(cp: string): Record<string, any> {
  if (!existsSync(cp)) return {};
  const raw = parseJsonc(readFileSync(cp, 'utf8'));
  const config = normalizeOpencode(raw);
  if ((process.env.AMBIT_RUNTIME || 'opencode') === 'opencode' && !config.authority) {
    const authority = opencodeAuthority(raw);
    if (authority) config.authority = authority;
  }
  return config;
}

/**
 * Writers that stamp the ontological kind, so no seeder can omit it.
 *
 * Kind is derived from the same inputs the backfill uses rather than passed in
 * at each of the ~15 call sites: one definition, and a new seeder cannot
 * disagree with the migration about what it just wrote.
 */
function seedFromConfig(db: Db, configPath?: string, mappingStr?: string, record = true) {
  const cp = configPath || configDefault();
  // A missing config used to abort the seed entirely, which left the database
  // with no tables at all — every first run without OpenCode installed ended in
  // a raw SQLite error from the next query. The curated capability model does
  // not come from the config, so seed it anyway: the graph is then a valid,
  // empty-of-your-stuff frontier rather than nothing.
  const config = readAgentConfig(cp);
  const mapping = parseMapping(mappingStr);

  let count = 0;
  const contributed: string[] = [];
  const insert = nodeWriter(db);

  for (const [key, cfg] of Object.entries<any>(mapping.config_keys || {})) {
    const entries = config[key] || {};
    for (const [name, val] of Object.entries<any>(entries)) {
      const type = cfg.type || 'tool';
      const domain = cfg.domain || cfg.domain_map?.[val[cfg.domain_field || 'type']] || 'infra';
      const desc =
        (cfg.desc_field
          ? val[cfg.desc_field] || ''
          : cfg.desc_template
            ? cfg.desc_template.replace('{type}', val.type || type)
            : '') || '';
      insert.run(`${type}:${name}`, name, domain, desc.slice(0, 80), type, 'unlocked', 0.5);
      contributed.push(`${type}:${name}`);
      count++;
    }
  }

  for (const dirPattern of mapping.skill_dirs || []) {
    const dir = dirPattern.replace(/^~/, process.env.HOME || '/');
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Not entry.isDirectory(): a Dirent reports false for a symlink, and
      // symlinking skills into a runtime's directory is how they get shared
      // between runtimes. That silently skipped 23 of 47 skills in a real
      // Hermes install, all of them pointing at the same shared directory
      // OpenCode reads — precisely the capabilities two runtimes have in
      // common. existsSync follows the link.
      if (!existsSync(join(dir, entry.name, 'SKILL.md'))) continue;
      insert.run(
        `skill:${entry.name}`,
        entry.name,
        'meta',
        'Agent skill',
        'skill',
        'unlocked',
        0.55
      );
      contributed.push(`skill:${entry.name}`);
      count++;
    }
  }

  insert.run(
    'core:reasoning',
    'Core Reasoning',
    'meta',
    'Base LLM reasoning',
    'meta',
    'active',
    1.0
  );
  insert.run('tool:bash', 'Shell Execution', 'infra', 'Run commands', 'tool', 'active', 1.0);
  insert.run('tool:edit', 'File Editor', 'meta', 'Edit files', 'tool', 'active', 1.0);
  insert.run('tool:lsp', 'LSP Diagnostics', 'quality', 'Language server', 'tool', 'active', 0.95);
  count += 4;

  db.prepare(
    "UPDATE capabilities SET state = 'active' WHERE id IN ('core:reasoning','tool:bash','tool:edit','tool:lsp')"
  ).run();

  count += seedModels(db, config, insert);
  count += seedLocalModels(db, insert);
  count += attributeToRuntime(db, insert, contributed);
  seedDependencies(db, config);
  count += seedTechTree(db, insert);
  count += seedCombos(db, config, mapping, insert);
  count += seedActors(db, config, mapping, insert);
  count += seedInfrastructure(db, insert);
  count += seedCredentials(db, config, mapping, insert);
  seedAuthority(db, config);
  seedEconomics(db, config);
  seedCatalog(db, config);

  // What this runtime's config declared last time and no longer does is
  // retired, and the tree is placed again without it. A seed that only added
  // left a server removed from the config reached, and a rollback, which
  // re-seeds, moved nothing back.
  const source = `runtime:${process.env.AMBIT_RUNTIME || 'opencode'}`;
  if (retireUndeclared(db, source, insert.seen)) seedTechTree(db, insert);

  // After the graph is complete and before the frontier is recorded, because
  // lifecycle is derived from both providers and evidence.
  deriveLifecycles(db);
  if (record) recordFrontier(db);

  return count;
}

export {
  parseMapping,
  seedFromConfig,
  seedModels,
  seedLocalModels,
  seedDependencies,
  attributeToRuntime,
  seedTechTree,
  seedActors,
  seedCombos,
  seedAuthority,
  seedInfrastructure,
  seedEconomics,
  seedCatalog,
  seedCredentials,
};
