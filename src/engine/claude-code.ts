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
import { RUNTIME_MODEL } from '../shared/runtimes.ts';
import { defaultMapping } from './seed/writers.ts';

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
  provider: Record<string, { name?: string; models?: Record<string, unknown> }>;
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

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/** Directories holding SKILL.md subdirectories — user skills and plugin skills. */
function skillDirs(claudeHome: string): string[] {
  const dirs: string[] = [];
  const userSkills = join(claudeHome, 'skills');
  if (existsSync(userSkills)) dirs.push(userSkills);

  const marketplaces = join(claudeHome, 'plugins', 'marketplaces');
  if (existsSync(marketplaces)) {
    for (const entry of safeReaddir(marketplaces)) {
      for (const candidate of [join(marketplaces, entry, 'skills'), join(marketplaces, entry)]) {
        if (!existsSync(candidate)) continue;
        try {
          if (!statSync(candidate).isDirectory()) continue;
        } catch {
          continue;
        }
        const holdsSkills = safeReaddir(candidate).some(name =>
          existsSync(join(candidate, name, 'SKILL.md'))
        );
        if (holdsSkills) dirs.push(candidate);
      }
    }
  }
  return dirs;
}

/** ~/.claude.json, or the file CLAUDE_CONFIG names. */
export function claudeConfigPath(): string {
  return process.env.CLAUDE_CONFIG || join(home(), '.claude.json');
}

/**
 * Every MCP server a parsed ~/.claude.json declares, as written: the user's
 * own first, then each project's local-scope ones with the project they
 * belong to, which is where Claude Code starts them. A project's committed
 * `.mcp.json` is not in this file and is not read.
 */
export function mcpServersIn(cfg: any): { name: string; server: any; project?: string }[] {
  const found: { name: string; server: any; project?: string }[] = [];
  for (const [name, server] of Object.entries<any>(cfg?.mcpServers || {})) {
    found.push({ name, server });
  }
  for (const [project, entry] of Object.entries<any>(cfg?.projects || {})) {
    for (const [name, server] of Object.entries<any>(entry?.mcpServers || {})) {
      found.push({ name, server, project });
    }
  }
  return found;
}

/**
 * `claudeHome`/`claudeJson` default to CLAUDE_HOME/CLAUDE_CONFIG env vars (or
 * the standard ~/.claude, ~/.claude.json) so a caller that wants the default
 * install can just call `readClaudeCode()`.
 */
export function readClaudeCode(
  claudeHome = process.env.CLAUDE_HOME || join(home(), '.claude'),
  claudeJson = claudeConfigPath()
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

  for (const { name, server } of mcpServersIn(cfg)) {
    if (fragment.mcp[name]) continue;
    fragment.mcp[name] = {
      type: server?.url || server?.type === 'http' || server?.type === 'sse' ? 'remote' : 'local',
      command: server?.command ? [server.command, ...(server.args || [])].flat() : undefined,
      enabled: server?.enabled !== false,
    };
  }
  const projects = Object.values<any>(cfg.projects || {});

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

  // Claude Code runs on Anthropic's models whether or not one is pinned, and
  // most installs pin none: read as written, the first step Ambit offered a
  // Claude Code user was Hosted Inference, which their agent was already using.
  const hosted = RUNTIME_MODEL['claude-code'];
  const model = settings.model || cfg.model;
  fragment.provider[hosted.id] = {
    name: hosted.name,
    ...(typeof model === 'string' && model ? { models: { [model]: {} } } : {}),
  };

  const permissions = settings.permissions || {};
  const skillCount = fragment.skills.paths.reduce(
    (n, dir) => n + safeReaddir(dir).filter(name => existsSync(join(dir, name, 'SKILL.md'))).length,
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
  // One builder, named by the runtime. This was a copy of the default mapping
  // differing only in the two words before "{type} server".
  const mapping = defaultMapping({
    runtime: 'claude-code',
    only: ['mcp', 'agent', 'provider'],
    skillDirs: fragment.skills.paths,
  });
  return { config, mapping };
}
