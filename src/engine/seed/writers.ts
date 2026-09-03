/**
 * The primitives every seeding pass writes through.
 *
 * Split out of discovery.ts, which was 950 lines holding these, the
 * orchestrator, the curated capability model, and nine passes over an agent
 * config. Sharing one writer is what keeps `kind` and `lifecycle` consistent
 * across all of them.
 */
import { edgeKindOf, kindOf } from '../ontology.ts';
import type { Db } from '../db.ts';

function nodeWriter(db: Db) {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO capabilities (id, name, domain, description, kind, category, state, maturity_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  return {
    run: (
      id: string,
      name: string,
      domain: string,
      description: string,
      category: string,
      state: string,
      maturity: number
    ) => stmt.run(id, name, domain, description, kindOf(id, category), category, state, maturity),
  };
}

function edgeWriter(db: Db) {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO dependencies (from_capability, to_capability, is_hard_requisite, description, kind) VALUES (?, ?, ?, ?, ?)'
  );
  return {
    run: (from: string, to: string, isHard: number, description: string) =>
      stmt.run(from, to, isHard, description, edgeKindOf(description, isHard)),
  };
}

/**
 * The mapping that says how a config's keys become nodes.
 *
 * There were five copies of this object: the default here, and one each in the
 * Hermes adapter, the Claude Code reader, the MCP-client reader and the surface
 * adapter. Four of the five differed only in the words in front of "{type}
 * server", so what looked like four decisions was one decision written four
 * times, and a change to how an MCP entry becomes a node reached whichever
 * copies the author happened to remember.
 *
 * `runtime` supplies that prefix. `only` narrows the result to the keys a
 * particular source actually carries, since a reader that never sees providers
 * should not claim to map them.
 */
function defaultMapping(
  options: { runtime?: string; only?: string[]; skillDirs?: string[] } = {}
): Record<string, any> {
  const prefix = options.runtime ? `${options.runtime} ` : '';
  const keys: Record<string, any> = {
    mcp: {
      type: 'mcp',
      domain_field: 'type',
      domain_map: { remote: 'backend', local: 'infra' },
      desc_template: `${prefix}{type} server`,
    },
    agent: { type: 'agent', domain: 'meta', desc_field: 'description' },
    provider: { type: 'provider', domain: 'ai-ml', name_field: 'name' },
    command: { type: 'tool', domain: 'devops', desc_field: 'description' },
  };
  const config_keys = options.only
    ? Object.fromEntries(options.only.filter(k => keys[k]).map(k => [k, keys[k]]))
    : keys;
  return {
    config_keys,
    skill_dirs: options.skillDirs ?? ['~/.agents/skills', '~/.opencode/skills'],
  };
}

function parseMapping(mappingStr?: string): Record<string, any> {
  if (mappingStr) {
    try {
      return JSON.parse(mappingStr);
    } catch {}
  }
  return defaultMapping();
}

export { defaultMapping, nodeWriter, edgeWriter, parseMapping };
