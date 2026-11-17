/**
 * What a Claude Code install brings besides ~/.claude.json: the servers and
 * skills of the plugins it turns on, and the servers a project commits in its
 * own `.mcp.json`.
 *
 * Read from ~/.claude.json alone, a setup whose services all came with
 * plugins reached none of them, and the skills of every plugin in every
 * marketplace counted, switched on or not.
 */
import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  claudeCodeSeedInput,
  enabledPlugins,
  pluginServerName,
  projectMcpJsonServers,
  readClaudeCode,
} from './claude-code.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ambit-claude-code-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(path: string, body: unknown) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
}

/** A Claude Code home with two plugins installed from one marketplace, one of them on. */
function install() {
  const home = join(dir, '.claude');
  const json = join(dir, '.claude.json');
  write(json, { mcpServers: { git: { command: 'git-mcp' } } });

  const on = join(home, 'plugins', 'cache', 'acme', 'engineering', '1.2.0');
  write(join(on, '.claude-plugin', 'plugin.json'), {
    name: 'engineering',
    mcpServers: { sentry: { type: 'http', url: 'https://mcp.sentry.dev/mcp' } },
  });
  write(join(on, '.mcp.json'), {
    mcpServers: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' } },
  });
  write(join(on, 'skills', 'review', 'SKILL.md'), '---\nname: review\n---\n');

  const off = join(home, 'plugins', 'cache', 'acme', 'design', '0.1.0');
  write(join(off, '.claude-plugin', 'plugin.json'), { name: 'design' });
  write(join(off, '.mcp.json'), { mcpServers: { figma: { type: 'http', url: 'https://x' } } });
  write(join(off, 'skills', 'critique', 'SKILL.md'), '---\nname: critique\n---\n');

  write(join(home, 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: {
      'engineering@acme': [{ scope: 'user', installPath: on, version: '1.2.0' }],
      'design@acme': [{ scope: 'user', installPath: off, version: '0.1.0' }],
    },
  });
  write(join(home, 'settings.json'), {
    enabledPlugins: { 'engineering@acme': true, 'design@acme': false },
  });
  return { home, json, on, off };
}

test('an enabled plugin lends its servers and skills, and a disabled one lends nothing', () => {
  const { home, json } = install();
  const fragment = readClaudeCode(home, json);

  expect(Object.keys(fragment?.mcp ?? {}).sort()).toEqual([
    'git',
    'plugin-engineering-github',
    'plugin-engineering-sentry',
  ]);
  expect(fragment?.mcp['plugin-engineering-github']).toEqual({ type: 'remote', enabled: true });
  expect(fragment?.skills.paths.some(p => p.includes('engineering'))).toBe(true);
  expect(fragment?.skills.paths.some(p => p.includes('design'))).toBe(false);
  expect(fragment?.observed.plugins).toEqual(['engineering@acme']);
  expect(fragment?.observed.pluginServers).toBe(2);
});

test('settings.local.json has the last word on a plugin', () => {
  const { home } = install();
  write(join(home, 'settings.local.json'), { enabledPlugins: { 'engineering@acme': false } });
  expect(enabledPlugins(home)).toEqual([]);
});

test('with no install record, the newest cached version is read', () => {
  const { home, on } = install();
  rmSync(join(home, 'plugins', 'installed_plugins.json'));
  expect(enabledPlugins(home)).toEqual([
    { id: 'engineering@acme', plugin: 'engineering', root: on },
  ]);
});

test("a manifest's path outside the plugin is read as nothing", () => {
  const { home, json, on } = install();
  write(join(dir, 'elsewhere.json'), { mcpServers: { stolen: { command: 'x' } } });
  write(join(on, '.claude-plugin', 'plugin.json'), {
    name: 'engineering',
    mcpServers: '../../../../../elsewhere.json',
  });
  const fragment = readClaudeCode(home, json);
  expect(Object.keys(fragment?.mcp ?? {})).not.toContain('plugin-engineering-stolen');
});

test("a plugin's server is named as the tool names Claude Code gives it", () => {
  // mcp__plugin_pdf-viewer_pdf__display_pdf is how the tool reaches a hook
  expect(pluginServerName('pdf-viewer', 'pdf')).toBe('plugin-pdf-viewer-pdf');
  expect(pluginServerName('engineering', 'github')).toBe('plugin-engineering-github');
});

test("a project's committed servers are listed by name, on only once approved", () => {
  const project = join(dir, 'repo');
  write(join(project, '.mcp.json'), {
    mcpServers: {
      postgres: { command: 'npx', args: ['-y', 'pg-mcp'] },
      linear: { type: 'http', url: 'https://mcp.linear.app/mcp' },
      refused: { command: 'rm', args: ['-rf', '/'] },
    },
  });
  const cfg = {
    projects: {
      [project]: { enabledMcpjsonServers: ['postgres'], disabledMcpjsonServers: ['refused'] },
      'relative/path': {},
    },
  };
  expect(projectMcpJsonServers(cfg, {})).toEqual([
    { name: 'postgres', project, remote: false, enabled: true },
    { name: 'linear', project, remote: true, enabled: false },
    { name: 'refused', project, remote: false, enabled: false },
  ]);
  expect(
    projectMcpJsonServers(cfg, { enableAllProjectMcpServers: true }).map(s => s.enabled)
  ).toEqual([true, true, false]);
});

test('a committed server reaches the seed with no command', () => {
  const home = join(dir, '.claude');
  mkdirSync(home, { recursive: true });
  const project = join(dir, 'repo');
  write(join(project, '.mcp.json'), { mcpServers: { postgres: { command: 'pg-mcp' } } });
  const json = join(dir, '.claude.json');
  write(json, { projects: { [project]: { enabledMcpjsonServers: ['postgres'] } } });

  const fragment = readClaudeCode(home, json);
  expect(fragment?.mcp.postgres).toEqual({ type: 'local', enabled: true });
  expect(fragment?.observed.projectMcpJson).toBe(1);
  const { config } = claudeCodeSeedInput(fragment!);
  expect(JSON.stringify(config)).not.toContain('pg-mcp');
});

test("a plugin tool's name is attributed to the node its server seeded", async () => {
  const { makeGraph } = await import('./testing/graph.ts');
  const { attribute } = await import('./failures.ts');
  const db = makeGraph({ capabilities: [{ id: `mcp:${pluginServerName('pdf-viewer', 'pdf')}` }] });
  expect(attribute(db, 'mcp__plugin_pdf-viewer_pdf__display_pdf')).toBe(
    'mcp:plugin-pdf-viewer-pdf'
  );
});
