import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverMcpClients } from './mcp-clients.ts';

let dir: string;
const origEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ambit-mcp-clients-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...origEnv };
});

test('discovers Cursor, Windsurf, Gemini, and Claude Desktop mcpServers', () => {
  const cursorFile = join(dir, 'cursor.json');
  writeFileSync(
    cursorFile,
    JSON.stringify({
      mcpServers: {
        git: { command: 'git-mcp' },
        remoteApi: { url: 'https://api.example.com/mcp' },
      },
    })
  );
  process.env.CURSOR_MCP_CONFIG = cursorFile;

  const found = discoverMcpClients(dir);
  const cursor = found.find(c => c.runtime === 'cursor');
  expect(cursor).toBeDefined();
  expect(cursor?.label).toBe('Cursor');
  expect(cursor?.config.mcp.git).toEqual({ command: 'git-mcp', type: 'local' });
  expect(cursor?.config.mcp.remoteApi).toEqual({
    url: 'https://api.example.com/mcp',
    type: 'remote',
  });
});

test('discovers Codex CLI config from TOML', () => {
  const codexFile = join(dir, 'codex.toml');
  writeFileSync(
    codexFile,
    `
[mcp_servers.fs]
command = "mcp-server-filesystem"
args = ["/Users/dev/repo"]

[mcp_servers.cloud]
url = "https://mcp.internal.net/sse"
type = "sse"
`
  );
  process.env.CODEX_MCP_CONFIG = codexFile;

  const found = discoverMcpClients(dir);
  const codex = found.find(c => c.runtime === 'codex');
  expect(codex).toBeDefined();
  expect(codex?.config.mcp.fs).toEqual({
    command: 'mcp-server-filesystem',
    args: ['/Users/dev/repo'],
    type: 'local',
  });
  expect(codex?.config.mcp.cloud).toEqual({
    url: 'https://mcp.internal.net/sse',
    type: 'remote',
  });
});

test('discovers Cline and Roo Code mcp settings', () => {
  const clineFile = join(dir, 'cline_mcp_settings.json');
  writeFileSync(
    clineFile,
    JSON.stringify({
      mcpServers: {
        fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
      },
    })
  );
  process.env.CLINE_MCP_CONFIG = clineFile;

  const rooFile = join(dir, 'roo_mcp_settings.json');
  writeFileSync(
    rooFile,
    JSON.stringify({
      mcpServers: {
        postgres: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'] },
      },
    })
  );
  process.env.ROO_CODE_MCP_CONFIG = rooFile;

  const found = discoverMcpClients(dir);
  const cline = found.find(c => c.runtime === 'cline');
  expect(cline).toBeDefined();
  expect(cline?.label).toBe('Cline');
  expect(cline?.config.mcp.fetch).toBeDefined();

  const roo = found.find(c => c.runtime === 'roo-code');
  expect(roo).toBeDefined();
  expect(roo?.label).toBe('Roo Code');
  expect(roo?.config.mcp.postgres).toBeDefined();
});

test('discovers Continue.dev config (mcpServers & experimental)', () => {
  const continueFile = join(dir, 'continue.json');
  writeFileSync(
    continueFile,
    JSON.stringify({
      experimental: {
        modelContextProtocolServers: {
          memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
        },
      },
    })
  );
  process.env.CONTINUE_MCP_CONFIG = continueFile;

  const found = discoverMcpClients(dir);
  const cont = found.find(c => c.runtime === 'continue');
  expect(cont).toBeDefined();
  expect(cont?.label).toBe('Continue');
  expect(cont?.config.mcp.memory).toBeDefined();
});

test('discovers Zed editor context_servers', () => {
  const zedFile = join(dir, 'zed.json');
  writeFileSync(
    zedFile,
    JSON.stringify({
      context_servers: {
        docker: { command: 'docker-mcp', args: [] },
      },
    })
  );
  process.env.ZED_MCP_CONFIG = zedFile;

  const found = discoverMcpClients(dir);
  const zed = found.find(c => c.runtime === 'zed');
  expect(zed).toBeDefined();
  expect(zed?.label).toBe('Zed');
  expect(zed?.config.mcp.docker).toEqual({ command: 'docker-mcp', args: [], type: 'local' });
});
