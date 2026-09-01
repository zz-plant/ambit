/**
 * Reads a Claude Code installation into the config shape `seedFromConfig`
 * already accepts, so `ambit seed` can fall back to it when no opencode.json
 * exists. Extracted from scripts/adapters/claude-code.ts (which remains the
 * standalone entry point for `--seed`/printing the fragment) so the two paths
 * cannot drift apart on what counts as "reading a Claude Code install."
 *
 * Claude Code has no structured config export, so this reads the documented
 * paths: ~/.claude.json for MCP servers (global and per-project), ~/.claude/
 * for skills, agents, and settings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { authorityBlock } from '../shared/authority.ts';

/**
 * Read per call, not once at import.
 *
 * A module-level `const HOME = process.env.HOME` is correct for a CLI that
 * starts, reads the environment and exits — and wrong for every other caller.
 * Frozen at import, it made this module discover the developer's own Claude
 * Code install no matter what HOME the caller set, which is the same bug
 * `paths.ts` had.
 */
const home = () => process.env.HOME || '/';

export interface ClaudeCodeFragment {
  runtime: string;
  mcp: Record<string, { type?: string; command?: string[]; enabled?: boolean }>;
  agent: Record<string, { description?: string; model?: string }>;
  provider: Record<string, { models?: Record<string, unknown> }>;
  skills: { paths: string[] };
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
function skillDirs(claudeHome: string): string[] {
  const dirs: string[] = [];
  const userSkills = join(claudeHome, 'skills');
  if (existsSync(userSkills)) dirs.push(userSkills);

  const marketplaces = join(claudeHome, 'plugins', 'marketplaces');
  if (existsSync(marketplaces)) {
    for (const entry of readdirSync(marketplaces)) {
      for (const candidate of [join(marketplaces, entry, 'skills'), join(marketplaces, entry)]) {
        if (!existsSync(candidate)) continue;
        try {
          if (!statSync(candidate).isDirectory()) continue;
        } catch {
          continue;
        }
        const holdsSkills = readdirSync(candidate).some(name =>
          existsSync(join(candidate, name, 'SKILL.md'))
        );
        if (holdsSkills) dirs.push(candidate);
      }
    }
  }
  return dirs;
}

/**
 * `claudeHome`/`claudeJson` default to CLAUDE_HOME/CLAUDE_CONFIG env vars (or
 * the standard ~/.claude, ~/.claude.json) so a caller that wants the default
 * install can just call `readClaudeCode()`.
 */
export function readClaudeCode(
  claudeHome = process.env.CLAUDE_HOME || join(home(), '.claude'),
  claudeJson = process.env.CLAUDE_CONFIG || join(home(), '.claude.json')
): ClaudeCodeFragment | null {
  if (!existsSync(claudeJson) && !existsSync(claudeHome)) return null;

  const cfg = readJson(claudeJson) || {};
  const settings = readJson(join(claudeHome, 'settings.json')) || {};

  const fragment: ClaudeCodeFragment = {
    runtime: 'claude-code',
    mcp: {},
    agent: {},
    provider: {},
    skills: { paths: skillDirs(claudeHome) },
    observed: {},
  };

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

  const agentsDir = join(claudeHome, 'agents');
  if (existsSync(agentsDir)) {
    for (const file of readdirSync(agentsDir)) {
      if (!file.endsWith('.md')) continue;
      const name = file.replace(/\.md$/, '');
      const body = readFileSync(join(agentsDir, file), 'utf8').slice(0, 2000);
      const described = body.match(/^description:\s*(.+)$/m);
      fragment.agent[name] = {
        description: described?.[1]?.trim().slice(0, 80) || 'Claude Code subagent',
      };
    }
  }

  const model = settings.model || cfg.model;
  if (typeof model === 'string' && model) {
    fragment.provider.anthropic = { models: { [model]: {} } };
  }

  const permissions = settings.permissions || {};
  const skillCount = fragment.skills.paths.reduce(
    (n, dir) => n + readdirSync(dir).filter(name => existsSync(join(dir, name, 'SKILL.md'))).length,
    0
  );

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
    userMemory: existsSync(join(claudeHome, 'CLAUDE.md')),
    statusline: Boolean(settings.statusLine),
  };

  return fragment;
}

/**
 * The config + CONFIG_MAPPING pair `seedFromConfig` expects, built from a
 * fragment. Kept separate from `readClaudeCode` so a caller that only wants
 * the raw fragment (the standalone adapter's `--print` mode) is not forced
 * through the mapping shape too.
 */
export function claudeCodeSeedInput(fragment: ClaudeCodeFragment): { config: any; mapping: any } {
  const authority = authorityBlock({
    execute: fragment.observed.permissionMode ?? 'default',
    note: `claude-code permissions.defaultMode: ${fragment.observed.permissionMode ?? 'default'}`,
  });

  const config = {
    mcp: fragment.mcp,
    agent: fragment.agent,
    provider: fragment.provider,
    authority,
  };
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
  return { config, mapping };
}
