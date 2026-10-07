import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('discovers Zed editor context_servers from JSONC', () => {
  const zedFile = join(dir, 'zed.json');
  writeFileSync(
    zedFile,
    `// Zed settings
{
  "context_servers": {
    "docker": {
      "command": "docker-mcp",
      "args": [],
    },
  },
}
`
  );
  process.env.ZED_MCP_CONFIG = zedFile;

  const found = discoverMcpClients(dir);
  const zed = found.find(c => c.runtime === 'zed');
  expect(zed).toBeDefined();
  expect(zed?.label).toBe('Zed');
  expect(zed?.config.mcp.docker).toEqual({ command: 'docker-mcp', args: [], type: 'local' });
});

test('skips invalid Zed settings', () => {
  const zedFile = join(dir, 'zed.json');
  writeFileSync(zedFile, 'not json');
  process.env.ZED_MCP_CONFIG = zedFile;

  const found = discoverMcpClients(dir);
  expect(found.find(c => c.runtime === 'zed')).toBeUndefined();
});

test('discovers VS Code user mcp.json from JSONC with inputs array', () => {
  const vscodeFile = join(dir, 'mcp.json');
  writeFileSync(
    vscodeFile,
    `// VS Code user MCP config
{
  "inputs": [
    {
      "id": "token",
      "type": "promptString",
      "description": "API Token"
    }
  ],
  "servers": {
    "git": {
      "type": "stdio",
      "command": "git-mcp",
      "args": ["--verbose"]
    },
    "remote": {
      "type": "http",
      "url": "https://mcp.example.com"
    }
  }
}
`
  );
  process.env.VSCODE_MCP_CONFIG = vscodeFile;

  const found = discoverMcpClients(dir);
  const vscode = found.find(c => c.runtime === 'vscode');
  expect(vscode).toBeDefined();
  expect(vscode?.label).toBe('VS Code');
  expect(vscode?.config.mcp.git).toEqual({
    type: 'local',
    command: 'git-mcp',
    args: ['--verbose'],
  });
  expect(vscode?.config.mcp.remote).toEqual({
    type: 'remote',
    url: 'https://mcp.example.com',
  });
});

test('skips invalid VS Code settings', () => {
  const vscodeFile = join(dir, 'mcp.json');
  writeFileSync(vscodeFile, 'not json');
  process.env.VSCODE_MCP_CONFIG = vscodeFile;

  const found = discoverMcpClients(dir);
  expect(found.find(c => c.runtime === 'vscode')).toBeUndefined();
});

test('discovers Copilot CLI mcp-config.json, local and http', () => {
  const copilotFile = join(dir, 'mcp-config.json');
  writeFileSync(
    copilotFile,
    JSON.stringify({
      mcpServers: {
        playwright: {
          type: 'local',
          command: 'npx',
          args: ['@playwright/mcp@latest'],
          env: {},
          tools: ['*'],
        },
        context7: { type: 'http', url: 'https://mcp.context7.com/mcp', tools: ['*'] },
      },
    })
  );
  process.env.COPILOT_MCP_CONFIG = copilotFile;

  const copilot = discoverMcpClients(dir).find(c => c.runtime === 'copilot-cli');
  expect(copilot?.label).toBe('Copilot CLI');
  expect(copilot?.config.mcp.playwright).toMatchObject({ command: 'npx', type: 'local' });
  expect(copilot?.config.mcp.context7).toMatchObject({
    url: 'https://mcp.context7.com/mcp',
    type: 'remote',
  });
});

test('discovers Amp servers under the one dotted key, from settings.jsonc under HOME', () => {
  // No override: the second of Amp's two documented file names, found by itself.
  const ampDir = join(dir, '.config', 'amp');
  mkdirSync(ampDir, { recursive: true });
  writeFileSync(
    join(ampDir, 'settings.jsonc'),
    `// Amp settings
{
  "amp.notifications.enabled": false,
  "amp.mcpServers": {
    "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp@latest"] },
    "linear": { "url": "https://mcp.linear.app/sse" },
  },
}
`
  );

  const amp = discoverMcpClients(dir).find(c => c.runtime === 'amp');
  expect(amp?.label).toBe('Amp');
  expect(amp?.path).toBe(join(ampDir, 'settings.jsonc'));
  expect(Object.keys(amp?.config.mcp ?? {})).toEqual(['playwright', 'linear']);
  expect(amp?.config.mcp.linear).toEqual({ url: 'https://mcp.linear.app/sse', type: 'remote' });
});

test('an Amp settings file with the servers nested, not under the dotted key, is not read', () => {
  const ampFile = join(dir, 'settings.json');
  writeFileSync(ampFile, JSON.stringify({ amp: { mcpServers: { x: { command: 'x' } } } }));
  process.env.AMP_MCP_CONFIG = ampFile;
  expect(discoverMcpClients(dir).find(c => c.runtime === 'amp')).toBeUndefined();
});

test('discovers Goose extensions in the documented inline form', () => {
  const gooseFile = join(dir, 'config.yaml');
  writeFileSync(
    gooseFile,
    `GOOSE_PROVIDER: anthropic
extensions:
  developer:
    type: builtin
    name: developer
    enabled: true
    bundled: true
    timeout: 300
  filesystem:
    type: stdio
    name: filesystem
    enabled: true
    cmd: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    env_keys: []
    envs: {}
    timeout: 300
  remote-tools:
    type: streamable_http
    name: remote-tools
    enabled: false
    uri: "https://example.com/mcp"
    headers: {}
    timeout: 300
GOOSE_MODEL: claude-sonnet
`
  );
  process.env.GOOSE_MCP_CONFIG = gooseFile;

  const goose = discoverMcpClients(dir).find(c => c.runtime === 'goose');
  expect(goose?.label).toBe('Goose');
  // A builtin ships inside Goose and is not a server anyone added.
  expect(Object.keys(goose?.config.mcp ?? {})).toEqual(['filesystem', 'remote-tools']);
  expect(goose?.config.mcp.filesystem).toEqual({
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    enabled: true,
    type: 'local',
  });
  // Switched off in Goose, and read that way.
  expect(goose?.config.mcp['remote-tools']).toEqual({
    url: 'https://example.com/mcp',
    enabled: false,
    type: 'remote',
  });
});

test('discovers Goose extensions in the block form Goose writes, leaving envs behind', () => {
  const gooseFile = join(dir, 'config.yaml');
  writeFileSync(
    gooseFile,
    `# written by goose configure
extensions:
  github:
    args:
    - -y
    - '@modelcontextprotocol/server-github'
    cmd: npx
    description: |
      GitHub: issues: and pull requests
      cmd: not-this
    enabled: false
    envs:
      GITHUB_PERSONAL_ACCESS_TOKEN: ghp_secret
    name: github
    type: stdio
  "quoted name":
    cmd: uvx # the runner
    args:
      - mcp-server-fetch
    type: stdio
  memory:
    type: builtin
    enabled: true
`
  );
  process.env.GOOSE_MCP_CONFIG = gooseFile;

  const goose = discoverMcpClients(dir).find(c => c.runtime === 'goose');
  expect(goose?.config.mcp.github).toEqual({
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    enabled: false,
    type: 'local',
  });
  expect(goose?.config.mcp['quoted name']).toEqual({
    command: 'uvx',
    args: ['mcp-server-fetch'],
    type: 'local',
  });
  expect(goose?.config.mcp.memory).toBeUndefined();
  expect(JSON.stringify(goose?.config)).not.toContain('ghp_secret');
});

test('a Goose config with only builtin extensions, or none, is not a client', () => {
  const gooseFile = join(dir, 'config.yaml');
  writeFileSync(gooseFile, 'extensions:\n  developer:\n    type: builtin\n    enabled: true\n');
  process.env.GOOSE_MCP_CONFIG = gooseFile;
  expect(discoverMcpClients(dir).find(c => c.runtime === 'goose')).toBeUndefined();

  writeFileSync(gooseFile, 'GOOSE_PROVIDER: openai\n');
  expect(discoverMcpClients(dir).find(c => c.runtime === 'goose')).toBeUndefined();
});

test('discovers Kiro mcp.json and keeps a server it marks disabled', () => {
  const kiroFile = join(dir, 'mcp.json');
  writeFileSync(
    kiroFile,
    JSON.stringify({
      mcpServers: {
        fetch: { command: 'uvx', args: ['mcp-server-fetch'], env: {}, disabled: false },
        remote: { url: 'https://endpoint.to.connect.to', headers: {}, disabled: true },
      },
    })
  );
  process.env.KIRO_MCP_CONFIG = kiroFile;

  const kiro = discoverMcpClients(dir).find(c => c.runtime === 'kiro');
  expect(kiro?.label).toBe('Kiro');
  expect(kiro?.config.mcp.fetch).toMatchObject({ command: 'uvx', disabled: false, type: 'local' });
  expect(kiro?.config.mcp.remote).toMatchObject({ disabled: true, type: 'remote' });
});
