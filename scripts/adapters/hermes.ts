#!/usr/bin/env bun
/**
 * Hermes adapter.
 *
 * Reads a Hermes installation and emits the capabilities it provides, in the
 * JSON shape the engine already accepts via CONFIG_MAPPING. Hermes is one of
 * the runtimes Ambit represents — not something it replaces — so the runtime
 * itself becomes a node, and every capability it contributes hangs off it.
 *
 * Why a script rather than engine code: the engine runs under Node with no
 * dependencies, and Hermes stores its configuration as YAML. Bun parses YAML
 * natively, and Bun is already required for the visualizer, so the adapter runs
 * there and hands the engine JSON.
 *
 * Hermes has no machine-readable config export today — `config show` is a TUI
 * and `dump` is prose for support tickets — so this reads the documented paths
 * under HERMES_HOME. If Hermes later grows a structured export, this should
 * consume that instead: reading another tool's private files is a stopgap, not
 * the intended contract.
 *
 *   bun run scripts/adapters/hermes.ts            # print the graph fragment
 *   bun run scripts/adapters/hermes.ts --seed     # seed it into Ambit
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { authorityBlock } from './authority.ts';

const HERMES_HOME = process.env.HERMES_HOME || join(process.env.HOME || '/', '.hermes');

interface Fragment {
  runtime: string;
  mcp: Record<string, { type?: string; command?: string[]; enabled?: boolean }>;
  agent: Record<string, { description?: string; model?: string }>;
  provider: Record<string, { models?: Record<string, unknown> }>;
  skills: { paths: string[] };
  /** Facts Ambit cannot infer from a config file but Hermes states outright. */
  observed: Record<string, unknown>;
}

function readHermes(): Fragment | null {
  const configPath = join(HERMES_HOME, 'config.yaml');
  if (!existsSync(configPath)) return null;

  const cfg: any = Bun.YAML.parse(readFileSync(configPath, 'utf8')) || {};
  const fragment: Fragment = {
    runtime: 'hermes',
    mcp: {},
    agent: {},
    provider: {},
    skills: { paths: [] },
    observed: {},
  };

  // MCP servers. Hermes records transport as either a URL or a command.
  for (const [name, server] of Object.entries<any>(cfg.mcp_servers || {})) {
    fragment.mcp[name] = {
      type: server?.url ? 'remote' : 'local',
      command: server?.command ? [server.command].flat() : undefined,
      enabled: server?.enabled !== false,
    };
  }

  // The default model, and the delegation model if it differs — delegation is
  // what makes subagents a capability rather than a setting.
  const model = cfg.model || {};
  if (model.default) {
    const provider = model.provider || 'hermes';
    fragment.provider[provider] = { models: { [model.default]: {} } };
  }
  const delegation = cfg.delegation || {};
  if (delegation.model) {
    const provider = delegation.provider || 'hermes-delegation';
    fragment.provider[provider] = fragment.provider[provider] || { models: {} };
    (fragment.provider[provider].models as any)[delegation.model] = {};
  }

  // Skills are directories, the same convention Ambit already scans.
  const skillsDir = join(HERMES_HOME, 'skills');
  if (existsSync(skillsDir)) fragment.skills.paths = [skillsDir];

  // Scheduled jobs are the difference between an episodic capability and a
  // persistent one, so they are counted rather than assumed.
  const cronDir = join(HERMES_HOME, 'cron');
  const cronJobs = existsSync(cronDir)
    ? readdirSync(cronDir).filter(f => !f.startsWith('.')).length
    : 0;

  // Authority, stated by the runtime rather than inferred. Ambit's roadmap
  // treats authority as future design; here is a real source of truth for it.
  fragment.observed = {
    approvalMode: cfg.approvals?.mode ?? null,
    cronApprovalMode: cfg.approvals?.cron_mode ?? null,
    scheduledJobs: cronJobs,
    terminalBackend: cfg.terminal?.backend ?? null,
    memoryEnabled: cfg.memory?.memory_enabled ?? null,
    browserConfigured: Boolean(cfg.browser?.cdp_url),
    policyEngine: cfg.security?.tirith_enabled ? 'tirith' : null,
    redactSecrets: cfg.security?.redact_secrets ?? null,
    // Each surface is somewhere the system can be reached and can reach out.
    surfaces: Object.keys(cfg.platform_toolsets || {}),
    hooks: Object.entries<any>(cfg.hooks || {})
      .filter(([, v]) => Array.isArray(v) && v.length > 0)
      .map(([k]) => k),
    skillCount: fragment.skills.paths.length
      ? readdirSync(join(HERMES_HOME, 'skills')).filter(f => !f.startsWith('.')).length
      : 0,
  };

  return fragment;
}

const fragment = readHermes();
if (!fragment) {
  console.error(`No Hermes installation at ${HERMES_HOME}. Set HERMES_HOME to point at one.`);
  process.exit(1);
}

if (!process.argv.includes('--seed')) {
  console.log(JSON.stringify(fragment, null, 2));
  process.exit(0);
}

// Seed: hand the engine a config in the shape it already understands. Ids are
// deliberately NOT namespaced — a `git` MCP under Hermes and a `git` MCP under
// OpenCode are two providers of one capability, so they should merge. What
// keeps that legible is AMBIT_RUNTIME below, which attributes everything this
// run contributes to a runtime node.
const configPath = join(process.env.TMPDIR || '/tmp', `ambit-hermes-${process.pid}.json`);
// Authority travels with the capabilities rather than being printed beside
// them: what Hermes permits applies to everything Hermes contributes, and the
// graph can only weigh that against the model's own declaration if it is in
// the graph.
const authority = authorityBlock({
  execute: fragment.observed.approvalMode,
  scheduled: fragment.observed.cronApprovalMode,
  note: `hermes approvals: ${fragment.observed.approvalMode ?? 'unset'}`,
  scheduledNote: `hermes cron_mode: ${fragment.observed.cronApprovalMode ?? 'unset'}`,
});

writeFileSync(
  configPath,
  JSON.stringify({ mcp: fragment.mcp, agent: fragment.agent, provider: fragment.provider, authority })
);

const mapping = {
  config_keys: {
    mcp: {
      type: 'mcp',
      domain_field: 'type',
      domain_map: { remote: 'backend', local: 'infra' },
      desc_template: 'hermes {type} server',
    },
    agent: { type: 'agent', domain: 'meta', desc_field: 'description' },
    provider: { type: 'provider', domain: 'ai-ml' },
  },
  skill_dirs: fragment.skills.paths,
};

const engine = join(import.meta.dir, '..', '..', 'src', 'engine', 'engine.ts');
const result = spawnSync('node', ['--experimental-sqlite', engine, 'seed'], {
  env: { ...process.env, OPENCODE_CONFIG: configPath, CONFIG_MAPPING: JSON.stringify(mapping), AMBIT_RUNTIME: 'hermes' },
  stdio: 'inherit',
});

const o = fragment.observed as any;
console.log(`\nHermes contributed: ${Object.keys(fragment.mcp).length} MCP servers · ${o.skillCount} skills · ${o.surfaces.length} surfaces`);
console.log(`Authority as Hermes states it: approvals=${o.approvalMode}, cron=${o.cronApprovalMode}`);
if (o.scheduledJobs === 0) {
  console.log('No scheduled jobs, so nothing here is persistent beyond a session.');
}
process.exit(result.status || 0);
