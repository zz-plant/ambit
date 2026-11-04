/**
 * windows-smoke.ts — the CLI where HOME is not set, as on Windows.
 *
 * Runs `seed` and `status` in a throwaway home holding one config under the
 * home directory and one where Claude Desktop keeps its own on this platform,
 * and fails unless both are found and nothing lands in the current directory.
 * It also runs on macOS and Linux, which proves the HOME half only.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'ambit-windows-smoke-'));
const win = process.platform === 'win32';
const appData = join(home, 'AppData', 'Roaming');
const desktop = win
  ? join(appData, 'Claude', 'claude_desktop_config.json')
  : join(home, '.config', 'Claude', 'claude_desktop_config.json');

function config(path: string, server: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ mcpServers: { [server]: { command: 'node' } } }));
}
config(join(home, '.cursor', 'mcp.json'), 'github');
config(desktop, 'playwright');

const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of ['HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME']) delete env[key];
env.USERPROFILE = home;
env.APPDATA = appData;
env.AMBIT_DB = join(home, 'graph.db');
env.NO_COLOR = '1';

function ambit(...args: string[]): string {
  const run = spawnSync(process.execPath, ['cli.js', ...args], { env, encoding: 'utf8' });
  const said = `${run.stdout}${run.stderr}`;
  if (run.status !== 0) throw new Error(`ambit ${args.join(' ')} exited ${run.status}:\n${said}`);
  return said;
}

try {
  const seeded = ambit('seed');
  console.log(seeded);
  for (const label of ['Cursor', 'Claude Desktop']) {
    if (!seeded.includes(label)) throw new Error(`seed never named ${label}`);
  }
  if (!existsSync(env.AMBIT_DB)) throw new Error('no graph where AMBIT_DB says');
  console.log(ambit('status'));
  if (existsSync('.local')) throw new Error('a file landed under the current directory');
  console.log('Windows smoke passed.');
} finally {
  rmSync(home, { recursive: true, force: true });
}
