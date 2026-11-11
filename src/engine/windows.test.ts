import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyCheck } from './assure/verify.ts';
import { runtimesFound, runtimeTarget, targetFile } from './connect.ts';
import { clientPaths, discoverMcpClients } from './mcp-clients.ts';
import type { Db } from './db.ts';

const platform = process.platform;
const env = { ...process.env };
let home: string;

function asPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ambit-windows-test-'));
});

afterEach(() => {
  asPlatform(platform);
  process.env = { ...env };
  rmSync(home, { recursive: true, force: true });
});

test.each([
  ['claude-desktop', ['Claude', 'claude_desktop_config.json']],
  ['vscode', ['Code', 'User', 'mcp.json']],
  ['zed', ['Zed', 'settings.json']],
  ['goose', ['Block', 'goose', 'config', 'config.yaml']],
  [
    'cline',
    [
      'Code',
      'User',
      'globalStorage',
      'saoudrizwan.claude-dev',
      'settings',
      'cline_mcp_settings.json',
    ],
  ],
  [
    'roo-code',
    [
      'Code',
      'User',
      'globalStorage',
      'rooveterinaryinc.roo-cline',
      'settings',
      'cline_mcp_settings.json',
    ],
  ],
])('on Windows %s is looked for under %%APPDATA%% first', (runtime, parts) => {
  asPlatform('win32');
  process.env.APPDATA = join(home, 'Roaming');
  expect(clientPaths(runtime, home)[0]).toBe(join(home, 'Roaming', ...parts));
});

test('with no APPDATA set, the default under the home directory is used', () => {
  asPlatform('win32');
  delete process.env.APPDATA;
  expect(clientPaths('zed', home)[0]).toBe(
    join(home, 'AppData', 'Roaming', 'Zed', 'settings.json')
  );
});

test('a machine that is not Windows is never told Ambit looked under %APPDATA%', () => {
  asPlatform('darwin');
  process.env.APPDATA = join(home, 'Roaming');
  for (const runtime of ['claude-desktop', 'vscode', 'zed', 'goose', 'cline', 'roo-code']) {
    expect(clientPaths(runtime, home).join()).not.toContain('Roaming');
  }
});

test.each([
  ['claude-desktop', ['Claude', 'claude_desktop_config.json']],
  ['vscode', ['Code', 'User', 'mcp.json']],
  [
    'cline',
    [
      'Code',
      'User',
      'globalStorage',
      'saoudrizwan.claude-dev',
      'settings',
      'cline_mcp_settings.json',
    ],
  ],
])('on Linux %s is looked for, and connected, under ~/.config first', (runtime, parts) => {
  asPlatform('linux');
  const xdg = join(home, '.config', ...parts);
  expect(clientPaths(runtime, home)[0]).toBe(xdg);
  // With no file yet, `ambit connect` creates the first path.
  const target = runtimeTarget(runtime);
  expect(target).toBeDefined();
  expect(targetFile(target!, home)).toEqual({ path: xdg, exists: false });
});

test('on macOS the Application Support folder still comes first', () => {
  asPlatform('darwin');
  expect(clientPaths('claude-desktop', home)[0]).toBe(
    join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  );
});

test('a config under %APPDATA% is read', () => {
  asPlatform('win32');
  process.env.APPDATA = join(home, 'Roaming');
  const file = join(home, 'Roaming', 'Claude', 'claude_desktop_config.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ mcpServers: { git: { command: 'git-mcp' } } }));
  const found = discoverMcpClients(home).find(c => c.runtime === 'claude-desktop');
  expect(found?.path).toBe(file);
});

test('connect and apply write the Claude Desktop config discovery read', () => {
  asPlatform('win32');
  process.env.APPDATA = join(home, 'Roaming');
  const file = join(home, 'Roaming', 'Claude', 'claude_desktop_config.json');
  const target = runtimeTarget('claude-desktop');
  expect(target && targetFile(target, home).path).toBe(file);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '{}');
  expect(runtimesFound(home).find(r => r.target.runtime === 'claude-desktop')?.path).toBe(file);
});

// Nothing touches the database on an unverifiable answer, which the null holds.
const noDb = null as unknown as Db;

test('on Windows with no sh, a check written for sh is unverifiable and not a failure', () => {
  asPlatform('win32');
  process.env.PATH = '';
  const result = verifyCheck(noDb, 'combo:x', 'X', { command: ['sh', '-c', 'exit 0'] });
  expect(result.status).toBe('unverifiable');
  expect(result.detail).toContain('needs sh');
});
