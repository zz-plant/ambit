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

function parseMapping(mappingStr?: string): Record<string, any> {
  if (mappingStr) {
    try {
      return JSON.parse(mappingStr);
    } catch {}
  }
  return {
    config_keys: {
      mcp: {
        type: 'mcp',
        domain_field: 'type',
        domain_map: { remote: 'backend', local: 'infra' },
        desc_template: '{type} server',
      },
      agent: { type: 'agent', domain: 'meta', desc_field: 'description' },
      provider: { type: 'provider', domain: 'ai-ml', name_field: 'name' },
      command: { type: 'tool', domain: 'devops', desc_field: 'description' },
    },
    skill_dirs: ['~/.agents/skills', '~/.opencode/skills'],
  };
}

export { nodeWriter, edgeWriter, parseMapping };
