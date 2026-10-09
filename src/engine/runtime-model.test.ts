/**
 * A runtime's own model, and a config placed the same way in the tab as by
 * the engine.
 *
 * Read as written, a Claude Code config declares no provider, so the first
 * step `ambit` offered a Claude Code user was Hosted Inference, which their
 * agent was already using. And the hosted page drew a pasted config as a list
 * while the engine placed the same file on the tree: two answers to one
 * question, of which a visitor saw the worse.
 */
import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { claudeCodeSeedInput, readClaudeCode } from './claude-code.ts';
import { discoverMcpClients } from './mcp-clients.ts';
import { getDb } from './db.ts';
import { migrate } from './migrate.ts';
import { seedFromConfig } from './discovery.ts';
import { importMcpServers } from '../client/utils/configImporter.ts';
import { placeOnMap } from '../client/utils/placeInTab.ts';

let dir: string;
const origEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ambit-runtime-model-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...origEnv };
});

const SERVERS = {
  github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
  playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
  postgres: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'] },
};

function claudeInstall(extra: Record<string, unknown> = {}) {
  const home = join(dir, '.claude');
  mkdirSync(home, { recursive: true });
  const json = join(dir, '.claude.json');
  writeFileSync(json, JSON.stringify({ numStartups: 1, mcpServers: SERVERS, ...extra }));
  return { home, json };
}

test('Claude Code declares the Anthropic provider with no model pinned', () => {
  const { home, json } = claudeInstall();
  const fragment = readClaudeCode(home, json);
  expect(fragment?.provider).toEqual({ anthropic: { name: 'Anthropic' } });
});

test('a pinned model is still recorded under it', () => {
  const { home, json } = claudeInstall({ model: 'claude-opus' });
  const fragment = readClaudeCode(home, json);
  expect(fragment?.provider.anthropic).toEqual({
    name: 'Anthropic',
    models: { 'claude-opus': {} },
  });
});

test('a client whose model ships with it declares one; one whose model is chosen does not', () => {
  const cursor = join(dir, 'cursor.json');
  writeFileSync(cursor, JSON.stringify({ mcpServers: { git: { command: 'git-mcp' } } }));
  process.env.CURSOR_MCP_CONFIG = cursor;
  const cline = join(dir, 'cline.json');
  writeFileSync(cline, JSON.stringify({ mcpServers: { git: { command: 'git-mcp' } } }));
  process.env.CLINE_MCP_CONFIG = cline;

  const found = discoverMcpClients(dir);
  const cursorSeed = found.find(c => c.runtime === 'cursor');
  expect(cursorSeed?.config.provider).toEqual({ cursor: { name: 'Cursor' } });
  expect(Object.keys(cursorSeed?.mapping.config_keys as object)).toContain('provider');

  const clineSeed = found.find(c => c.runtime === 'cline');
  expect(clineSeed?.config.provider).toBeUndefined();
  expect(Object.keys(clineSeed?.mapping.config_keys as object)).not.toContain('provider');
});

test('the page places a pasted config where the engine places it', () => {
  const { home, json } = claudeInstall();
  const { config, mapping } = claudeCodeSeedInput(readClaudeCode(home, json)!);
  const configPath = join(dir, 'seed.json');
  writeFileSync(configPath, JSON.stringify(config));
  const db = getDb(join(dir, 'graph.db'));
  migrate(db as never);
  process.env.AMBIT_RUNTIME = 'claude-code';
  seedFromConfig(db, configPath, JSON.stringify(mapping));
  const engine = db
    .prepare(
      "SELECT id, state FROM capabilities WHERE id LIKE 'combo:%' AND kind = 'capability' ORDER BY id"
    )
    .all()
    .map((r: any) => [r.id, r.state === 'locked' ? 'locked' : 'unlocked']);
  db.close();

  const graph = importMcpServers({ mcpServers: SERVERS })!;
  const page = placeOnMap(graph, { id: 'claude-code', name: 'Claude Code' })
    .items.filter(i => i.id.startsWith('combo:'))
    .map(i => [i.id, i.meta.state])
    .sort(([a], [b]) => String(a).localeCompare(String(b)));

  expect(page).toEqual(engine);
  // And the step this test exists for: the agent's own model is reached.
  expect(page).toContainEqual(['combo:hosted-inference', 'unlocked']);
});
