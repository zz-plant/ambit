#!/usr/bin/env bun
/**
 * Claude Code adapter.
 *
 * Reads a Claude Code installation and emits the capabilities it provides, in
 * the JSON shape the engine already accepts via CONFIG_MAPPING. Like the Hermes
 * adapter, the runtime itself becomes a node and everything it contributes
 * hangs off it, so an MCP server configured in both Claude Code and OpenCode is
 * one capability with two providers rather than two capabilities.
 *
 * This exists because Ambit could previously only read OpenCode. For anyone
 * running a different agent, the first seed produced the curated capability
 * model and nothing of their own — which is the whole promise not landing.
 *
 * Claude Code has no structured config export, so this reads the documented
 * paths: ~/.claude.json for MCP servers (global and per-project), ~/.claude/
 * for skills, agents, and settings. If a structured export appears later, this
 * should consume that instead; reading another tool's files is a stopgap.
 *
 *   bun run scripts/adapters/claude-code.ts            # print the graph fragment
 *   bun run scripts/adapters/claude-code.ts --seed     # seed it into Ambit
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const HOME = process.env.HOME || '/';
const CLAUDE_HOME = process.env.CLAUDE_HOME || join(HOME, '.claude');
const CLAUDE_JSON = process.env.CLAUDE_CONFIG || join(HOME, '.claude.json');

interface Fragment {
  runtime: string;
  mcp: Record<string, { type?: string; command?: string[]; enabled?: boolean }>;
  agent: Record<string, { description?: string; model?: string }>;
  provider: Record<string, { models?: Record<string, unknown> }>;
  skills: { paths: string[] };
  /** Facts Ambit cannot infer from a config file but Claude Code states outright. */
  observed: Record<string, unknown>;
}

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Directories holding SKILL.md subdirectories — user skills and plugin skills. */
function skillDirs(): string[] {
  const dirs: string[] = [];
  const userSkills = join(CLAUDE_HOME, 'skills');
  if (existsSync(userSkills)) dirs.push(userSkills);

  // Plugins ship their own skills, and they are capabilities the same way user
  // skills are — the marketplace layout nests them one level deeper.
  const marketplaces = join(CLAUDE_HOME, 'plugins', 'marketplaces');
  if (existsSync(marketplaces)) {
    for (const entry of readdirSync(marketplaces)) {
      for (const candidate of [join(marketplaces, entry, 'skills'), join(marketplaces, entry)]) {
        if (!existsSync(candidate)) continue;
        try {
          if (!statSync(candidate).isDirectory()) continue;
        } catch { continue; }
        const holdsSkills = readdirSync(candidate).some(
          name => existsSync(join(candidate, name, 'SKILL.md'))
        );
        if (holdsSkills) dirs.push(candidate);
      }
    }
  }
  return dirs;
}

function readClaudeCode(): Fragment | null {
  if (!existsSync(CLAUDE_JSON) && !existsSync(CLAUDE_HOME)) return null;

  const cfg = readJson(CLAUDE_JSON) || {};
  const settings = readJson(join(CLAUDE_HOME, 'settings.json')) || {};

  const fragment: Fragment = {
    runtime: 'claude-code',
    mcp: {},
    agent: {},
    provider: {},
    skills: { paths: skillDirs() },
    observed: {},
  };

  // MCP servers are declared globally and per project. A server configured in
  // one project is still a capability this machine has, so both are collected —
  // and because ids are not namespaced, the same server in several projects
  // merges into one node rather than inflating the count.
  const collectMcp = (servers: Record<string, any> | undefined) => {
    for (const [name, server] of Object.entries<any>(servers || {})) {
      if (fragment.mcp[name]) continue;
      fragment.mcp[name] = {
        type: server?.url || server?.type === 'http' || server?.type === 'sse' ? 'remote' : 'local',
        command: server?.command ? [server.command, ...(server.args || [])].flat() : undefined,
        enabled: server?.enabled !== false,
      };
    }
  };
  collectMcp(cfg.mcpServers);
  const projects = Object.values<any>(cfg.projects || {});
  for (const project of projects) collectMcp(project?.mcpServers);

  // Subagents are markdown files with frontmatter; the description is what the
  // runtime uses to route to them, so it is the honest description here too.
  const agentsDir = join(CLAUDE_HOME, 'agents');
  if (existsSync(agentsDir)) {
    for (const file of readdirSync(agentsDir)) {
      if (!file.endsWith('.md')) continue;
      const name = file.replace(/\.md$/, '');
      const body = readFileSync(join(agentsDir, file), 'utf8').slice(0, 2000);
      const described = body.match(/^description:\s*(.+)$/m);
      fragment.agent[name] = { description: described?.[1]?.trim().slice(0, 80) || 'Claude Code subagent' };
    }
  }

  // A pinned model is a declared dependency; without one the runtime chooses,
  // which is a different situation and should not be recorded as a model node.
  const model = settings.model || cfg.model;
  if (typeof model === 'string' && model) {
    fragment.provider['anthropic'] = { models: { [model]: {} } };
  }

  const permissions = settings.permissions || {};
  const skillCount = fragment.skills.paths.reduce(
    (n, dir) => n + readdirSync(dir).filter(name => existsSync(join(dir, name, 'SKILL.md'))).length,
    0
  );

  // Authority as the runtime states it, rather than as Ambit guesses. Names
  // only — an allow rule can name a path, and the values are not ours to copy
  // into a graph the user may well export.
  fragment.observed = {
    permissionMode: permissions.defaultMode ?? null,
    allowRules: (permissions.allow || []).length,
    denyRules: (permissions.deny || []).length,
    askRules: (permissions.ask || []).length,
    hooks: Object.keys(settings.hooks || {}),
    projects: projects.length,
    projectScopedMcp: projects.filter(p => Object.keys(p?.mcpServers || {}).length).length,
    skillCount,
    subagents: Object.keys(fragment.agent).length,
    // A CLAUDE.md is memory that survives the session, which is a capability
    // and not a preference.
    userMemory: existsSync(join(CLAUDE_HOME, 'CLAUDE.md')),
    statusline: Boolean(settings.statusLine),
  };

  return fragment;
}

const fragment = readClaudeCode();
if (!fragment) {
  console.error(`No Claude Code installation at ${CLAUDE_HOME} or ${CLAUDE_JSON}.`);
  console.error('Set CLAUDE_HOME / CLAUDE_CONFIG to point at one.');
  process.exit(1);
}

if (!process.argv.includes('--seed')) {
  console.log(JSON.stringify(fragment, null, 2));
  process.exit(0);
}

const configPath = join(process.env.TMPDIR || '/tmp', `ambit-claude-code-${process.pid}.json`);
writeFileSync(
  configPath,
  JSON.stringify({ mcp: fragment.mcp, agent: fragment.agent, provider: fragment.provider })
);

const mapping = {
  config_keys: {
    mcp: {
      type: 'mcp',
      domain_field: 'type',
      domain_map: { remote: 'backend', local: 'infra' },
      desc_template: 'claude-code {type} server',
    },
    agent: { type: 'agent', domain: 'meta', desc_field: 'description' },
    provider: { type: 'provider', domain: 'ai-ml' },
  },
  skill_dirs: fragment.skills.paths,
};

const engine = join(import.meta.dir, '..', '..', 'src', 'engine', 'engine.ts');
const result = spawnSync('node', ['--experimental-sqlite', engine, 'seed'], {
  env: {
    ...process.env,
    OPENCODE_CONFIG: configPath,
    CONFIG_MAPPING: JSON.stringify(mapping),
    AMBIT_RUNTIME: 'claude-code',
  },
  stdio: 'inherit',
});

const o = fragment.observed as any;
console.log(
  `\nClaude Code contributed: ${Object.keys(fragment.mcp).length} MCP servers · ${o.skillCount} skills · ${o.subagents} subagents`
);
console.log(
  `Authority as Claude Code states it: mode=${o.permissionMode ?? 'default'}, allow=${o.allowRules}, deny=${o.denyRules}, ask=${o.askRules}`
);
if (!o.hooks.length) {
  console.log('No hooks configured, so nothing here runs on its own between sessions.');
}
process.exit(result.status || 0);
