import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { ENGINE_DIR, CONFIG_DEFAULT } from "./paths.ts";
import type { Db } from "./db.ts";
import { kindOf, edgeKindOf } from "./ontology.ts";
import { deriveLifecycles } from "./assurance.ts";
import { recordFrontier } from "./ledger.ts";

// ─── Seed ─────────────────────────────────────────────────────────────────────

/**
 * Writers that stamp the ontological kind, so no seeder can omit it.
 *
 * Kind is derived from the same inputs the backfill uses rather than passed in
 * at each of the ~15 call sites: one definition, and a new seeder cannot
 * disagree with the migration about what it just wrote.
 */
function nodeWriter(db: Db) {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO capabilities (id, name, domain, description, kind, category, state, maturity_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  return {
    run: (id: string, name: string, domain: string, description: string, category: string, state: string, maturity: number) =>
      stmt.run(id, name, domain, description, kindOf(id, category), category, state, maturity),
  };
}

function edgeWriter(db: Db) {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO dependencies (from_capability, to_capability, is_hard_requisite, description, kind) VALUES (?, ?, ?, ?, ?)"
  );
  return {
    run: (from: string, to: string, isHard: number, description: string) =>
      stmt.run(from, to, isHard, description, edgeKindOf(description, isHard)),
  };
}

function parseMapping(mappingStr?: string): Record<string, any> {
  if (mappingStr) {
    try { return JSON.parse(mappingStr); } catch {}
  }
  return {
    config_keys: { mcp: { type: 'mcp', domain_field: 'type', domain_map: { remote: 'backend', local: 'infra' }, desc_template: '{type} server' }, agent: { type: 'agent', domain: 'meta', desc_field: 'description' }, provider: { type: 'provider', domain: 'ai-ml', name_field: 'name' }, command: { type: 'tool', domain: 'devops', desc_field: 'description' } },
    skill_dirs: ["~/.agents/skills", "~/.opencode/skills"],
  };
}

function seedFromConfig(db: Db, configPath?: string, mappingStr?: string) {
  const cp = configPath || CONFIG_DEFAULT;
  // A missing config used to abort the seed entirely, which left the database
  // with no tables at all — every first run without OpenCode installed ended in
  // a raw SQLite error from the next query. The curated capability model does
  // not come from the config, so seed it anyway: the graph is then a valid,
  // empty-of-your-stuff frontier rather than nothing.
  const config = existsSync(cp) ? JSON.parse(readFileSync(cp, "utf8")) : {};
  const mapping = parseMapping(mappingStr);

  let count = 0;
  const contributed: string[] = [];
  const insert = nodeWriter(db);

  for (const [key, cfg] of Object.entries<any>(mapping.config_keys || {})) {
    const entries = config[key] || {};
    for (const [name, val] of Object.entries<any>(entries)) {
      const type = cfg.type || 'tool';
      const domain = cfg.domain || (cfg.domain_map && cfg.domain_map[val[cfg.domain_field || 'type']]) || 'infra';
      const desc = (cfg.desc_field ? (val[cfg.desc_field] || '') : cfg.desc_template ? cfg.desc_template.replace('{type}', val.type || type) : '') || '';
      insert.run(`${type}:${name}`, name, domain, desc.slice(0, 80), type, 'unlocked', 0.5);
      contributed.push(`${type}:${name}`);
      count++;
    }
  }

  for (const dirPattern of (mapping.skill_dirs || [])) {
    const dir = dirPattern.replace(/^~/, process.env.HOME || "/");
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Not entry.isDirectory(): a Dirent reports false for a symlink, and
      // symlinking skills into a runtime's directory is how they get shared
      // between runtimes. That silently skipped 23 of 47 skills in a real
      // Hermes install, all of them pointing at the same shared directory
      // OpenCode reads — precisely the capabilities two runtimes have in
      // common. existsSync follows the link.
      if (!existsSync(join(dir, entry.name, "SKILL.md"))) continue;
      insert.run(`skill:${entry.name}`, entry.name, 'meta', 'Agent skill', 'skill', 'unlocked', 0.55);
      contributed.push(`skill:${entry.name}`);
      count++;
    }
  }

  insert.run("core:reasoning", "Core Reasoning", "meta", "Base LLM reasoning", "meta", "active", 1.0);
  insert.run("tool:bash", "Shell Execution", "infra", "Run commands", "tool", "active", 1.0);
  insert.run("tool:edit", "File Editor", "meta", "Edit files", "tool", "active", 1.0);
  insert.run("tool:lsp", "LSP Diagnostics", "quality", "Language server", "tool", "active", 0.95);
  count += 4;

  db.prepare("UPDATE capabilities SET state = 'active' WHERE id IN ('core:reasoning','tool:bash','tool:edit','tool:lsp')").run();

  count += seedModels(db, config, insert);
  count += attributeToRuntime(db, insert, contributed);
  seedDependencies(db, config);
  count += seedTechTree(db, insert);
  count += seedCombos(db, config, mapping, insert);
  count += seedActors(db, config, mapping, insert);
  seedAuthority(db, config);

  // After the graph is complete and before the frontier is recorded, because
  // lifecycle is derived from both providers and evidence.
  deriveLifecycles(db);
  recordFrontier(db);

  return count;
}

/**
 * Authority, from the two places that can legitimately state it.
 *
 * The curated model says what an action is like in general — restarting a
 * container is a confirm, reading a repository is not. The runtime that would
 * execute the step says what it permits on this machine, and that is not a
 * schema Ambit invented: Hermes publishes `approvals.mode` and
 * `approvals.cron_mode`, and an adapter can hand them over in the same config
 * fragment it already hands over its MCP servers.
 *
 *   "authority": {
 *     "runtime": { "execute": "confirm", "note": "approvals: manual" },
 *     "scoped":  { "execute": { "mode": "forbidden", "scope": "scheduled" } },
 *     "capabilities": { "combo:shell-execution": { "execute": "forbidden" } }
 *   }
 *
 * Nothing here is enforced. Ambit describes authority; it does not mediate
 * action, and saying so is more useful than implying otherwise.
 */
function seedAuthority(db: Db, config: any): number {
  const grant = db.prepare(
    `INSERT OR IGNORE INTO authority (capability_id, action, mode, holder, scope, source, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const has = (id: string) => !!db.prepare("SELECT 1 AS ok FROM capabilities WHERE id = ?").get(id);
  let count = 0;

  // Declared on the curated model.
  let tree: any = { nodes: [] };
  try { tree = JSON.parse(readFileSync(join(ENGINE_DIR, "techtree.json"), "utf8")); } catch { /* no model */ }
  for (const node of tree.nodes || []) {
    const id = `combo:${node.id}`;
    if (!node.authority || !has(id)) continue;
    for (const [action, mode] of Object.entries<any>(node.authority)) {
      if (typeof mode !== 'string') continue; // `actions` is handled with contracts
      grant.run(id, action, mode, '', '', 'techtree', null);
      count++;
    }
  }

  // Stated by the runtime that would execute it. Held against the runtime node,
  // not copied onto each capability: a contribution made in a later run would
  // otherwise miss a grant recorded in an earlier one.
  const spec = config.authority || {};
  const runtimeId = `runtime:${process.env.AMBIT_RUNTIME || 'opencode'}`;
  const source = `runtime:${process.env.AMBIT_RUNTIME || 'opencode'}`;
  if (has(runtimeId)) {
    for (const [action, value] of Object.entries<any>(spec.runtime || {})) {
      if (action === 'note') continue;
      const mode = typeof value === 'string' ? value : value?.mode;
      if (!mode) continue;
      grant.run(runtimeId, action, mode, runtimeId, '', source, spec.runtime.note || null);
      count++;
    }
    for (const [action, value] of Object.entries<any>(spec.scoped || {})) {
      const mode = typeof value === 'string' ? value : value?.mode;
      if (!mode) continue;
      grant.run(runtimeId, action, mode, runtimeId, value?.scope || '', source, value?.note || null);
      count++;
    }
  }

  for (const [capId, actions] of Object.entries<any>(spec.capabilities || {})) {
    if (!has(capId)) continue;
    for (const [action, value] of Object.entries<any>(actions || {})) {
      const mode = typeof value === 'string' ? value : value?.mode;
      if (!mode) continue;
      grant.run(capId, action, mode, '', value?.scope || '', source, value?.note || null);
      count++;
    }
  }

  return count;
}

/**
 * Models are real config entities the seed previously skipped, which left
 * providers as leaves and agents unconnected to anything. Their ids match the
 * visualizer's (`model:<provider>/<name>`) so both halves agree.
 */
function seedModels(db: Db, config: any, insert: any): number {
  let count = 0;
  for (const [provider, pv] of Object.entries<any>(config.provider || {})) {
    for (const [model, mv] of Object.entries<any>(pv?.models || {})) {
      const ctx = mv?.limit?.context;
      insert.run(
        `model:${provider}/${model}`,
        mv?.name || model,
        'ai-ml',
        ctx ? `${ctx} context` : 'Model',
        'model',
        'unlocked',
        0.6
      );
      count++;
    }
  }
  return count;
}

/**
 * Edges the config states outright — nothing inferred by heuristic:
 *   provider → model   a model cannot run without its provider
 *   model    → agent   an agent pinned to a model depends on it
 *
 * `from` is the prerequisite and `to` the dependent, matching how the combo
 * analyses read the table. Only edges whose endpoints both exist are written,
 * since the schema has foreign keys on both columns.
 */
function seedDependencies(db: Db, config: any): number {
  const has = (id: string) =>
    !!db.prepare("SELECT 1 AS ok FROM capabilities WHERE id = ?").get(id);
  const link = edgeWriter(db);
  let count = 0;

  for (const [provider, pv] of Object.entries<any>(config.provider || {})) {
    for (const model of Object.keys(pv?.models || {})) {
      if (!has(`provider:${provider}`) || !has(`model:${provider}/${model}`)) continue;
      link.run(`provider:${provider}`, `model:${provider}/${model}`, 1, 'Model served by provider');
      count++;
    }
  }

  for (const [name, agent] of Object.entries<any>(config.agent || {})) {
    const ref = agent?.model;
    if (typeof ref !== 'string' || !has(`agent:${name}`)) continue;
    // "provider/model" — the model half may itself contain slashes.
    const slash = ref.indexOf('/');
    if (slash < 0) continue;
    const provider = ref.slice(0, slash);
    const modelId = `model:${ref}`;
    if (has(modelId)) {
      link.run(modelId, `agent:${name}`, 1, 'Agent pinned to model');
      count++;
    } else if (has(`provider:${provider}`)) {
      // Model not declared in config; the provider dependency still holds.
      link.run(`provider:${provider}`, `agent:${name}`, 1, 'Agent pinned to provider');
      count++;
    }
  }

  return count;
}


/**
 * Records which runtime contributed these capabilities.
 *
 * Two runtimes commonly configure the same MCP server. That is one capability
 * with two providers, not two capabilities, so the ids deliberately collide and
 * merge — but the graph then cannot say which runtime supplies what, or what
 * would be lost if one went away. A runtime node with an edge to everything it
 * contributed answers both, and makes `tt impact runtime:hermes` meaningful.
 *
 * The runtime is an ordinary node: Ambit represents agent runtimes rather than
 * being one, so no runtime owns the graph.
 */
function attributeToRuntime(db: Db, insert: any, contributed: string[]): number {
  const runtime = process.env.AMBIT_RUNTIME || 'opencode';
  if (contributed.length === 0) return 0;
  const id = `runtime:${runtime}`;
  insert.run(id, runtime, 'meta', `Agent runtime — contributes ${contributed.length} capabilities`, 'runtime', 'unlocked', 0.9);
  const link = edgeWriter(db);
  for (const capability of contributed) link.run(id, capability, 1, 'Contributed by runtime');
  return 1;
}

/**
 * Places the user on the curated capability tree in techtree.json.
 *
 * The tree is authored content, the way a Civ tech tree is: everyone gets the
 * same one and differs only in where they are on it. That is what makes the
 * unlock analyses work without the user hand-authoring the interesting half —
 * previously they returned empty until someone wrote their own combos.
 *
 * Each node is matched against the ids already seeded from the user's config:
 *   detected                        → unlocked, with an edge from what proved it
 *   prerequisites met, not detected → locked, and surfaced as researchable next
 *   prerequisites unmet             → locked, further out
 *
 * Nodes are stored with a `combo:` prefix and category, because that is what
 * the existing unlock analyses select on.
 */
function seedTechTree(db: Db, insert: any): number {
  let tree: any;
  try {
    tree = JSON.parse(readFileSync(join(ENGINE_DIR, "techtree.json"), "utf8"));
  } catch {
    return 0; // A missing or unreadable tree degrades to config-only seeding.
  }

  const owned: string[] = db
    .prepare("SELECT id FROM capabilities WHERE id NOT LIKE 'combo:%'")
    .all()
    .map((r: any) => r.id);
  const modelCount = owned.filter(id => id.startsWith('model:')).length;

  const link = edgeWriter(db);

  // Which of the user's capabilities, if any, prove each node.
  const evidence = new Map<string, string[]>();
  for (const node of tree.nodes || []) {
    const patterns: string[] = node.detect?.any || [];
    const hits = owned.filter(id =>
      patterns.some(p => {
        try { return new RegExp(p, 'i').test(id); } catch { return false; }
      })
    );
    const meetsMin = !node.detect?.min_models || modelCount >= node.detect.min_models;
    evidence.set(node.id, hits.length && meetsMin ? hits : []);
  }

  // Resolve in era order so a node's prerequisites are settled before it is.
  // Without this the tree contradicts itself — reporting Offline Capable as
  // reached while Local Embeddings, which it requires, is still locked.
  const ordered = [...(tree.nodes || [])].sort((a: any, b: any) => (a.era || 0) - (b.era || 0));
  const unlocked = new Set<string>();

  let count = 0;
  for (const node of ordered) {
    const id = `combo:${node.id}`;
    const proof = evidence.get(node.id) || [];
    const missing: string[] = (node.requires || []).filter((r: string) => !unlocked.has(r));
    const reached = proof.length > 0 && missing.length === 0;
    if (reached) unlocked.add(node.id);

    // Having the tooling for a node whose prerequisites are unmet is the most
    // useful thing the tree can tell you, so say it rather than hiding it.
    const blocked = proof.length > 0 && missing.length > 0;
    const names = (ids: string[]) =>
      ids.map(r => (tree.nodes.find((n: any) => n.id === r)?.name || r)).join(', ');
    const description = reached
      ? node.description
      : blocked
        ? `${node.description} — configured, but ${names(missing)} is not in place yet`
        : `${node.description} — ${node.hint || ''}`.trim();

    insert.run(
      id,
      node.name,
      node.domain || 'meta',
      description,
      'combo',
      reached ? 'unlocked' : 'locked',
      reached ? 0.7 : 0
    );
    // The insert is OR IGNORE, so on a re-seed it does nothing — which left
    // every tech-tree node frozen at whatever the first run computed. Change
    // your config, re-run bootstrap, and the tree would not move. State is
    // derived, so it has to be written every time.
    db.prepare(
      `UPDATE capabilities SET state = ?, description = ?, maturity_score = ?,
       unlock_cost_setup = ?, unlock_cost_tokens = ?,
       updated_at = CASE WHEN state != ? THEN datetime('now') ELSE updated_at END
       WHERE id = ?`
    ).run(
      reached ? 'unlocked' : 'locked',
      description,
      reached ? 0.7 : 0,
      node.setup_seconds || 0,
      node.tokens || 0,
      reached ? 'unlocked' : 'locked',
      id
    );
    count++;

    // Edges from the user's own capabilities to the node they unlock, so
    // `tt impact` can answer what breaks if a given tool goes away.
    for (const hit of proof.slice(0, 6)) {
      link.run(hit, id, 1, 'Provides this capability');
    }
    // Tier progression between tree nodes.
    for (const req of node.requires || []) {
      link.run(`combo:${req}`, id, 1, 'Tech tree prerequisite');
    }
    for (const opt of node.optional || []) {
      link.run(`combo:${opt}`, id, 0, 'Strengthens this capability');
    }
  }

  return count;
}


/**
 * Seeds the people in the system.
 *
 * Humans are not users of the graph, they are nodes in it. They supply things
 * machines cannot manufacture — legal authority, money, physical access,
 * subjective judgement, account ownership — and a capability that needs one of
 * those is not autonomous, however complete its technical dependencies are.
 *
 *   "actors": {
 *     "kanav": {
 *       "name": "Kanav",
 *       "provides": ["physical-access", "approve-purchases"],
 *       "authorizes": ["combo:continuous-delivery"]
 *     }
 *   }
 *
 * `provides` becomes a capability the person supplies. `authorizes` becomes a
 * hard prerequisite edge, which is what makes a plan able to say that a step is
 * someone's rather than the machine's.
 */
function seedActors(db: Db, config: any, mapping: any, insert: any): number {
  const actors = { ...(mapping.actors || {}), ...(config.actors || {}) };
  const link = edgeWriter(db);
  const has = (id: string) => !!db.prepare("SELECT 1 AS ok FROM capabilities WHERE id = ?").get(id);
  let count = 0;

  for (const [key, spec] of Object.entries<any>(actors)) {
    const id = key.startsWith('human:') ? key : `human:${key}`;
    const name = spec?.name || key;
    insert.run(id, name, 'social', spec?.role || 'Person in the system', 'human', 'active', 1.0);
    count++;

    // Things only this person can supply.
    for (const provided of spec?.provides || []) {
      const pid = provided.includes(':') ? provided : `act:${provided}`;
      insert.run(pid, provided.replace(/-/g, ' '), 'social', `Provided by ${name}`, 'human-action', 'unlocked', 1.0);
      link.run(id, pid, 1, 'Supplied by a person');
      count++;
    }

    // Approval as a dependency rather than a policy note. Only for capabilities
    // that exist — a typo should leave a missing edge, not a dangling one.
    for (const gated of spec?.authorizes || []) {
      const gid = gated.startsWith('combo:') || gated.includes(':') ? gated : `combo:${gated}`;
      if (has(gid)) link.run(id, gid, 1, 'Requires approval from a person');
    }
  }
  return count;
}

/**
 * Combos are the unit every unlock analysis is built on, and they are a
 * judgement about what capabilities compose — not something to infer from a
 * config file. They are read from an optional `combos` block, so a fabricated
 * cluster never ends up presented as a finding:
 *
 *   "combos": { "e2e-on-edge": { "name": "E2E on Edge", "domain": "quality",
 *                                "requires": ["mcp:playwright", "skill:vitest"],
 *                                "optional": ["mcp:cloudflare"] } }
 *
 * Accepted in opencode.json or in CONFIG_MAPPING. Without one, the combo
 * analyses stay empty — which is honest, not broken.
 */
function seedCombos(db: Db, config: any, mapping: any, insert: any): number {
  const combos = { ...(mapping.combos || {}), ...(config.combos || {}) };
  const has = (id: string) =>
    !!db.prepare("SELECT 1 AS ok FROM capabilities WHERE id = ?").get(id);
  const link = edgeWriter(db);
  let count = 0;

  for (const [key, spec] of Object.entries<any>(combos)) {
    const id = key.startsWith('combo:') ? key : `combo:${key}`;
    const requires: string[] = (spec?.requires || []).filter(has);
    const optional: string[] = (spec?.optional || []).filter(has);
    // A combo whose prerequisites are all missing describes nothing.
    if (requires.length === 0 && optional.length === 0) continue;

    insert.run(
      id,
      spec?.name || key,
      spec?.domain || 'meta',
      spec?.description || 'Composed capability',
      'combo',
      'locked',
      0
    );
    count++;
    for (const dep of requires) { link.run(dep, id, 1, 'Hard prerequisite'); }
    for (const dep of optional) { link.run(dep, id, 0, 'Soft prerequisite'); }
  }

  return count;
}

export {
  parseMapping, seedFromConfig, seedModels, seedDependencies, attributeToRuntime,
  seedTechTree, seedActors, seedCombos, seedAuthority,
};
