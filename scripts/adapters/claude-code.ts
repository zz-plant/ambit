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
 *   node --experimental-strip-types scripts/adapters/claude-code.ts            # print the graph fragment
 *   node --experimental-strip-types scripts/adapters/claude-code.ts --seed     # seed it into Ambit
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readClaudeCode, claudeCodeSeedInput } from '../../src/engine/claude-code.ts';

const HOME = process.env.HOME || '/';
const CLAUDE_HOME = process.env.CLAUDE_HOME || join(HOME, '.claude');
const CLAUDE_JSON = process.env.CLAUDE_CONFIG || join(HOME, '.claude.json');

const fragment = readClaudeCode(CLAUDE_HOME, CLAUDE_JSON);
if (!fragment) {
  console.error(`No Claude Code installation at ${CLAUDE_HOME} or ${CLAUDE_JSON}.`);
  console.error('Set CLAUDE_HOME / CLAUDE_CONFIG to point at one.');
  process.exit(1);
}

if (!process.argv.includes('--seed')) {
  console.log(JSON.stringify(fragment, null, 2));
  process.exit(0);
}

// `defaultMode` is what Claude Code will do without being asked, which is the
// same question the graph asks of every capability. Allow and deny rules are
// deliberately not translated: they name paths and commands, and this adapter
// counts them rather than copying them into a graph the user may export.
const { config, mapping } = claudeCodeSeedInput(fragment);

const configPath = join(process.env.TMPDIR || '/tmp', `ambit-claude-code-${process.pid}.json`);
writeFileSync(configPath, JSON.stringify(config));

const engine = join(import.meta.dirname, '..', '..', 'src', 'engine', 'engine.ts');
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
