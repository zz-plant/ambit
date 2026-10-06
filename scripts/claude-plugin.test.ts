/**
 * The Claude Code marketplace and its two plugins, held to the package.
 *
 * A plugin is installed by its version and runs `ambit` commands by name, so
 * a version left behind at a release, a source path that moved, or a hook
 * that calls a verb the CLI no longer has would each ship a plugin that
 * installs and then does nothing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { GROUPS } from '../src/engine/cli/groups.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const version = read('package.json').version;
const market = read('.claude-plugin/marketplace.json');

test('every plugin the marketplace lists exists, at the package version', () => {
  expect(market.plugins.map((p: { name: string }) => p.name)).toEqual(['ambit', 'ambit-gate']);
  for (const entry of market.plugins) {
    const manifest = read(join(entry.source, '.claude-plugin/plugin.json'));
    expect(manifest.name).toBe(entry.name);
    expect(manifest.version, entry.name).toBe(version);
    expect(entry.version, entry.name).toBe(version);
  }
});

test('every hook and server runs an ambit verb the CLI has, or a script the plugin ships', () => {
  const verbs = new Set(['mcp', 'briefing', ...Object.values(GROUPS).flat()]);
  const commands: { plugin: string; command: string }[] = [];
  for (const entry of market.plugins) {
    const hooks = join(entry.source, 'hooks/hooks.json');
    if (existsSync(join(ROOT, hooks))) {
      for (const groups of Object.values(read(hooks).hooks) as Array<
        Array<{ hooks: Array<{ command: string }> }>
      >) {
        for (const g of groups)
          for (const h of g.hooks) commands.push({ plugin: entry.source, command: h.command });
      }
    }
    const mcp = join(entry.source, '.mcp.json');
    if (existsSync(join(ROOT, mcp))) {
      for (const s of Object.values(read(mcp).mcpServers) as Array<{
        command: string;
        args: string[];
      }>) {
        commands.push({ plugin: entry.source, command: [s.command, ...s.args].join(' ') });
      }
    }
  }
  expect(commands.length).toBeGreaterThanOrEqual(3);
  for (const { plugin, command: c } of commands) {
    // A script the plugin ships, run by node from the plugin's own directory.
    const script = c.match(/^node "\$\{CLAUDE_PLUGIN_ROOT\}\/(.+)"$/);
    if (script) {
      expect(existsSync(join(ROOT, plugin, script[1])), c).toBe(true);
      continue;
    }
    // The gate's guard: it steps aside when ambit is not installed, and the
    // session-start half says so once instead of failing on every call.
    if (c.startsWith('sh -c ')) {
      expect(c, c).toContain('command -v ambit');
      const verb = c.match(/exec ambit (\S+?)'?$/)?.[1];
      if (verb) expect(verbs.has(verb), c).toBe(true);
      else expect(c, c).toContain('systemMessage');
      continue;
    }
    // Either the installed command or the published package through npx; the
    // gate runs on every tool call, so it stays on the installed command.
    const words = c.replace(/^npx -y ambit-cli /, 'ambit ').split(' ');
    expect(words[0], c).toBe('ambit');
    expect(verbs.has(words[1]), c).toBe(true);
  }
});

test('the session hook writes which tools ran and never what went into or came out of them', () => {
  const script = readFileSync(join(ROOT, 'plugins/claude-code/ambit/scripts/spool.mjs'), 'utf8');
  expect(script).not.toMatch(/tool_input|tool_output|tool_response/);
  expect(script).toContain('AMBIT_NO_LEDGER');
});

test('the skill says when to load it, and that the gate never allows', () => {
  const skill = readFileSync(join(ROOT, 'plugins/claude-code/ambit/skills/ambit/SKILL.md'), 'utf8');
  const front = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  expect(front).toMatch(/^name: ambit$/m);
  const description = front.match(/^description: (.*)$/m)?.[1] ?? '';
  expect(description).toMatch(/MCP servers/);
  expect(description.length).toBeLessThan(500);
  // What it touches is said before anything runs; the gate only narrows.
  expect(skill).toContain('sends nothing anywhere');
  expect(skill).toContain('never allows');
});
