/**
 * The structure derived from what a config already says.
 *
 * Models under their providers, declared dependencies, the runtime that
 * contributed each node, compound capabilities, and the device and service
 * topology. Everything here is inferred from the config rather than stated in
 * it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db.ts';
import { edgeWriter } from './writers.ts';

/**
 * Models are real config entities the seed previously skipped, which left
 * providers as leaves and agents unconnected to anything. Their ids match the
 * visualizer's (`model:<provider>/<name>`) so both halves agree.
 */
function seedModels(_db: Db, config: any, insert: any): number {
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
  const has = (id: string) => !!db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(id);
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
  insert.run(
    id,
    runtime,
    'meta',
    `Agent runtime — contributes ${contributed.length} capabilities`,
    'runtime',
    'unlocked',
    0.9
  );
  const link = edgeWriter(db);
  for (const capability of contributed) link.run(id, capability, 1, 'Contributed by runtime');
  return 1;
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
  const has = (id: string) => !!db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(id);
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
    for (const dep of requires) {
      link.run(dep, id, 1, 'Hard prerequisite');
    }
    for (const dep of optional) {
      link.run(dep, id, 0, 'Soft prerequisite');
    }
  }

  return count;
}

/**
 * Seeds machines from the infrastructure manifest as capability-bearing nodes.
 *
 * §2's unbuilt half: hardware is "some computers" in the visualiser and nothing
 * in the engine. A device that is reachable over Tailscale and runs a model
 * server is latent inference, embeddings, browser workers — capacity the graph
 * should be able to point a plan at, and lose count of when it disappears.
 *
 *   INFRA_MANIFEST   path to the manifest (default ~/.config/opencode/
 *                    infrastructure.json), the same file the server scans.
 *
 * Devices become `resource` nodes (the ontology's word for what a provider
 * needs in order to supply a capability: a model, an endpoint, a machine) with
 * a `runs_on` edge to every service hosted on them, so `tt impact device:nuc`
 * can say what actually breaks. Without a manifest, seeding continues — a
 * machine that is not declared cannot be assumed.
 */
function seedInfrastructure(db: Db, insert: any): number {
  const path =
    process.env.INFRA_MANIFEST ||
    join(process.env.HOME || '/', '.config', 'opencode', 'infrastructure.json');
  let manifest: any = null;
  try {
    if (existsSync(path)) manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    /* an unreadable manifest is a missing one */
  }
  if (!manifest) return 0;

  const link = edgeWriter(db);
  const has = (id: string) => !!db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(id);
  let count = 0;

  for (const device of manifest.devices || []) {
    insert.run(
      `device:${device.id}`,
      device.name,
      'physical',
      device.description || `Host ${device.name}`,
      'device',
      'unlocked',
      0.7
    );
    count++;
    // A declared status endpoint is what makes it observable; record it.
    if (device.statusUrl) {
      db.prepare('UPDATE capabilities SET description = ? WHERE id = ?').run(
        `${device.description || `Host ${device.name}`} · status: ${device.statusUrl}`,
        `device:${device.id}`
      );
    }
  }

  for (const service of manifest.services || []) {
    const id = `svc:${service.key}`;
    insert.run(
      id,
      service.label || service.key,
      service.host ? 'physical' : 'backend',
      service.description || `Service ${service.key}`,
      'service',
      'unlocked',
      0.5
    );
    count++;
    if (service.host && has(`device:${service.host}`)) {
      link.run(`device:${service.host}`, id, 1, 'Hosts this service');
    }
    if (service.expectedMcp && has(`mcp:${service.expectedMcp}`)) {
      link.run(`mcp:${service.expectedMcp}`, id, 1, 'Controls this service');
    }
  }

  return count;
}

export { seedModels, seedDependencies, attributeToRuntime, seedCombos, seedInfrastructure };
