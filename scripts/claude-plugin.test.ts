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

test('every hook and server runs an ambit verb the CLI has', () => {
  const verbs = new Set(['mcp', 'briefing', ...Object.values(GROUPS).flat()]);
  const commands: string[] = [];
  for (const entry of market.plugins) {
    const hooks = join(entry.source, 'hooks/hooks.json');
    if (existsSync(join(ROOT, hooks))) {
      for (const groups of Object.values(read(hooks).hooks) as Array<
        Array<{ hooks: Array<{ command: string }> }>
      >) {
        for (const g of groups) for (const h of g.hooks) commands.push(h.command);
      }
    }
    const mcp = join(entry.source, '.mcp.json');
    if (existsSync(join(ROOT, mcp))) {
      for (const s of Object.values(read(mcp).mcpServers) as Array<{
        command: string;
        args: string[];
      }>) {
        commands.push([s.command, ...s.args].join(' '));
      }
    }
  }
  expect(commands.length).toBeGreaterThanOrEqual(3);
  for (const c of commands) {
    const [bin, verb] = c.split(' ');
    expect(bin, c).toBe('ambit');
    expect(verbs.has(verb), c).toBe(true);
  }
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
