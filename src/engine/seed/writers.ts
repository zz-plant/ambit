/**
 * The primitives every seeding pass writes through.
 *
 * Split out of discovery.ts, which was 950 lines holding these, the
 * orchestrator, the curated capability model, and nine passes over an agent
 * config. Sharing one writer is what keeps `kind` and `lifecycle` consistent
 * across all of them.
 */
import { edgeKindOf, kindOf, PROVISION_EDGES } from '../ontology.ts';
import type { Db } from '../db.ts';

/**
 * Writes a node a seed pass found, and remembers that it was found.
 *
 * A row already there is left as it is, as it always was, unless an earlier
 * seed retired it: then the config declares it again, and it is restored with
 * the state this pass gives it. `seen` is what `retireUndeclared` compares the
 * last run's declarations against.
 */
function nodeWriter(db: Db) {
  const stmt = db.prepare(
    `INSERT INTO capabilities (id, name, domain, description, kind, category, state, maturity_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET state = excluded.state, retired_at = NULL,
       updated_at = datetime('now')
     WHERE capabilities.retired_at IS NOT NULL`
  );
  const seen = new Set<string>();
  return {
    seen,
    run: (
      id: string,
      name: string,
      domain: string,
      description: string,
      category: string,
      state: string,
      maturity: number
    ) => {
      seen.add(id);
      return stmt.run(
        id,
        name,
        domain,
        description,
        kindOf(id, category),
        category,
        state,
        maturity
      );
    },
  };
}

/** The kinds a seed recomputes every run, which are never retired: the curated tree. */
const RECOMPUTED = "('capability', 'action')";

/**
 * Retires what `source` declared on its last seed and no longer declares.
 *
 * Every node this run wrote, other than the curated tree's, is stamped as
 * declared by `source`; the last runtime to declare a node holds it, so a
 * server two runtimes share is retired only once neither declares it. A node
 * `source` held that this run did not write is locked, and loses the edges by
 * which it supplied anything, so nothing is reached through it. It is kept,
 * since evidence and the ledger refer to it. Returns how many were retired.
 */
function retireUndeclared(db: Db, source: string, seen: Set<string>): number {
  const stamp = db.prepare(
    `UPDATE capabilities SET declared_by = ? WHERE id = ? AND kind NOT IN ${RECOMPUTED}`
  );
  for (const id of seen) stamp.run(source, id);

  const gone = db
    .prepare(
      `SELECT id FROM capabilities
       WHERE declared_by = ? AND retired_at IS NULL AND kind NOT IN ${RECOMPUTED}`
    )
    .all<{ id: string }>(source)
    .map(r => r.id)
    .filter(id => !seen.has(id));
  const retire = db.prepare(
    `UPDATE capabilities SET state = 'locked', retired_at = datetime('now'),
       updated_at = datetime('now') WHERE id = ?`
  );
  const unlink = db.prepare(
    `DELETE FROM dependencies WHERE (from_capability = ? OR to_capability = ?)
       AND kind IN (${PROVISION_EDGES.map(() => '?').join(', ')})`
  );
  for (const id of gone) {
    retire.run(id);
    unlink.run(id, id, ...PROVISION_EDGES);
  }
  return gone.length;
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
    // OpenCode 2 keeps global skills beside its config, in `skills/`.
    skill_dirs: options.skillDirs ?? [
      '~/.agents/skills',
      '~/.opencode/skills',
      '~/.config/opencode/skills',
    ],
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

export { defaultMapping, nodeWriter, edgeWriter, parseMapping, retireUndeclared };
