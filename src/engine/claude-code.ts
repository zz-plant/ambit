/**
 * Reads a Claude Code installation into the config shape `seedFromConfig`
 * already accepts, so `ambit seed` can fall back to it when no opencode.json
 * exists.
 *
 * Claude Code has no structured config export, so this reads the documented
 * paths: ~/.claude.json for MCP servers (global and per-project), ~/.claude/
 * for skills, agents, and settings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
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

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function holdsSkills(dir: string): boolean {
  return isDir(dir) && safeReaddir(dir).some(name => existsSync(join(dir, name, 'SKILL.md')));
}

/** A plugin Claude Code loads: its `name@marketplace` and the folder its install lives in. */
export interface EnabledPlugin {
  id: string;
  plugin: string;
  root: string;
}

/**
 * A path a plugin's manifest names, kept inside the plugin. A manifest came
 * from a marketplace, so `../../.ssh` in it is read as nothing.
 */
function inside(root: string, rel: unknown): string | null {
  if (typeof rel !== 'string' || !rel) return null;
  const full = resolve(root, rel);
  return full === root || full.startsWith(root + sep) ? full : null;
}

/**
 * The folder one installed plugin lives in: the path installed_plugins.json
 * records for it (an array of installs from version 2 of that file, one
 * object before), else the newest version in the plugin cache.
 */
function pluginRoot(claudeHome: string, id: string, installed: any): string | null {
  const record = installed?.plugins?.[id];
  const records: any[] = Array.isArray(record) ? record : record ? [record] : [];
  const chosen = records.find(r => !r?.scope || r.scope === 'user') ?? records[0];
  if (typeof chosen?.installPath === 'string' && isDir(chosen.installPath)) {
    return chosen.installPath;
  }
  const at = id.lastIndexOf('@');
  if (at <= 0) return null;
  const cached = join(claudeHome, 'plugins', 'cache', id.slice(at + 1), id.slice(0, at));
  if (!isDir(cached)) return null;
  if (isDir(join(cached, '.claude-plugin'))) return cached;
  const versions = safeReaddir(cached)
    .map(name => join(cached, name))
    .filter(isDir)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return versions[0] ?? null;
}

/**
 * The plugins Claude Code loads for every session: each `name@marketplace`
 * the user-level settings turn on, settings.local.json having the last word,
 * found where it is installed. A plugin that is installed and switched off
 * loads nothing, so it lends the graph nothing; reading every marketplace
 * folder, as this used to, counted the skills of plugins nobody turned on.
 */
export function enabledPlugins(claudeHome: string): EnabledPlugin[] {
  const enabled = new Map<string, boolean>();
  for (const name of ['settings.json', 'settings.local.json']) {
    const settings = readJson(join(claudeHome, name));
    for (const [id, on] of Object.entries<any>(settings?.enabledPlugins || {})) {
      enabled.set(id, on === true);
    }
  }
  const installed = readJson(join(claudeHome, 'plugins', 'installed_plugins.json'));
  const found: EnabledPlugin[] = [];
  for (const [id, on] of enabled) {
    if (!on) continue;
    const root = pluginRoot(claudeHome, id, installed);
    if (!root) continue;
    const at = id.lastIndexOf('@');
    found.push({ id, plugin: at > 0 ? id.slice(0, at) : id, root });
  }
  return found;
}

/** The `mcpServers` of a parsed `.mcp.json`, which a plugin may also write bare. */
function serversOf(parsed: any): Record<string, any> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const bag =
    parsed.mcpServers && typeof parsed.mcpServers === 'object' ? parsed.mcpServers : parsed;
  return Object.fromEntries(
    Object.entries<any>(bag).filter(([, s]) => s && typeof s === 'object' && !Array.isArray(s))
  );
}

/**
 * The MCP servers one plugin brings: its `.mcp.json`, and whatever its
 * manifest's `mcpServers` holds, inline or as paths inside the plugin.
 */
export function pluginServers(root: string): Record<string, any> {
  const servers: Record<string, any> = { ...serversOf(readJson(join(root, '.mcp.json'))) };
  const manifest = readJson(join(root, '.claude-plugin', 'plugin.json'));
  const declared = manifest?.mcpServers;
  if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
    Object.assign(servers, serversOf({ mcpServers: declared }));
  } else {
    for (const rel of Array.isArray(declared) ? declared : [declared]) {
      const path = inside(root, rel);
      if (path) Object.assign(servers, serversOf(readJson(path)));
    }
  }
  return servers;
}

/**
 * The name a plugin's server goes by in the graph: the middle of the tool
 * names Claude Code gives it (`mcp__plugin_engineering_github__create_issue`),
 * as `attribute` in failures.ts reads them, so a failure or a gate question
 * about one of its tools lands on this node.
 */
export function pluginServerName(plugin: string, server: string): string {
  return `plugin_${plugin}_${server}`.replace(/_/g, '-');
}

/** The skill folders one plugin brings: `skills/`, and any its manifest names inside it. */
function pluginSkillDirs(root: string): string[] {
  const manifest = readJson(join(root, '.claude-plugin', 'plugin.json'));
  const named = Array.isArray(manifest?.skills) ? manifest.skills : [manifest?.skills];
  const dirs = [join(root, 'skills'), ...named.map((rel: unknown) => inside(root, rel))];
  return dirs.filter((dir): dir is string => Boolean(dir) && holdsSkills(dir as string));
}

/** Directories holding SKILL.md subdirectories: the user's own, and each enabled plugin's. */
function skillDirs(claudeHome: string, plugins: EnabledPlugin[]): string[] {
  const dirs: string[] = [];
  const userSkills = join(claudeHome, 'skills');
  if (existsSync(userSkills)) dirs.push(userSkills);
  for (const plugin of plugins) {
    for (const dir of pluginSkillDirs(plugin.root)) if (!dirs.includes(dir)) dirs.push(dir);
  }
  return dirs;
}

/** Whether a server definition reaches its server over the network. */
function isRemote(server: any): boolean {
  return Boolean(server?.url) || server?.type === 'http' || server?.type === 'sse';
}

/** A name a file that travelled may give a node: printable, and short enough to read. */
function plainName(name: string): boolean {
  if (name.length === 0 || name.length > 100) return false;
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * The servers each project Claude Code knows commits in its own `.mcp.json`,
 * by name and kind alone. Claude Code starts one only after the person
 * approves it, so a server listed in `enabledMcpjsonServers`, or every server
 * when `enableAllProjectMcpServers` is on, counts as on, and the rest as
 * configured and off. The file came with a clone, so nothing here keeps its
 * command, and nothing in Ambit starts what it names (rule 7).
 */
export function projectMcpJsonServers(
  cfg: any,
  settings: any
): { name: string; project: string; remote: boolean; enabled: boolean }[] {
  const found: { name: string; project: string; remote: boolean; enabled: boolean }[] = [];
  for (const [project, entry] of Object.entries<any>(cfg?.projects || {})) {
    if (!project.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(project)) continue;
    const servers = serversOf(readJson(join(project, '.mcp.json')));
    const approved: string[] = Array.isArray(entry?.enabledMcpjsonServers)
      ? entry.enabledMcpjsonServers
      : [];
    const refused: string[] = Array.isArray(entry?.disabledMcpjsonServers)
      ? entry.disabledMcpjsonServers
      : [];
    const all =
      entry?.enableAllProjectMcpServers === true || settings?.enableAllProjectMcpServers === true;
    for (const [name, server] of Object.entries<any>(servers)) {
      if (!plainName(name)) continue;
      found.push({
        name,
        project,
        remote: isRemote(server),
        enabled: !refused.includes(name) && (all || approved.includes(name)),
      });
    }
  }
  return found;
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
  const plugins = enabledPlugins(claudeHome);

  const fragment: ClaudeCodeFragment = {
    runtime: 'claude-code',
    mcp: {},
    agent: {},
    provider: {},
    skills: { paths: skillDirs(claudeHome, plugins) },
    observed: {},
  };

  for (const { name, server } of mcpServersIn(cfg)) {
    if (fragment.mcp[name]) continue;
    fragment.mcp[name] = {
      type: isRemote(server) ? 'remote' : 'local',
      command: server?.command ? [server.command, ...(server.args || [])].flat() : undefined,
      enabled: server?.enabled !== false,
    };
  }
  // A plugin is how many servers arrive now, most of them remote, and none of
  // them is written into ~/.claude.json: read from that file alone, a setup
  // whose services all came with plugins reached none of them.
  let pluginServerCount = 0;
  for (const plugin of plugins) {
    for (const [server, def] of Object.entries<any>(pluginServers(plugin.root))) {
      const name = pluginServerName(plugin.plugin, server);
      if (fragment.mcp[name]) continue;
      fragment.mcp[name] = { type: isRemote(def) ? 'remote' : 'local', enabled: true };
      pluginServerCount++;
    }
  }
  const committed = projectMcpJsonServers(cfg, settings);
  for (const { name, remote, enabled } of committed) {
    if (fragment.mcp[name]) continue;
    fragment.mcp[name] = { type: remote ? 'remote' : 'local', enabled };
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
    plugins: plugins.map(p => p.id),
    pluginServers: pluginServerCount,
    projectMcpJson: committed.length,
    skillCount,
    subagents: Object.keys(fragment.agent).length,
    userMemory: existsSync(join(claudeHome, 'CLAUDE.md')),
    statusline: Boolean(settings.statusLine),
  };

  return fragment;
}

/** The config + CONFIG_MAPPING pair `seedFromConfig` expects, built from a fragment. */
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
