/**
 * What a person sees the first time they type `npx ambit-cli`, from a home
 * directory Ambit has never seen.
 *
 * The first run used to print the whole of `ambit status`: a count of what was
 * unproven, then sixty lines of single providers and bottlenecks as nested
 * records, ending on a suggestion to run checks. With no config it named one
 * runtime's path and sent the reader to a file only a checkout has. These
 * hold the screen to what it should say first: what was read, by name; where
 * the graph went and that nothing left the machine; what one more step opens.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { telemetryBridgeInstall } from '../paths.ts';

const WRAPPER = join(import.meta.dirname, '..', '..', '..', 'cli.js');

/** Every variable that would point discovery somewhere other than this home. */
const OVERRIDES = [
  'OPENCODE_CONFIG',
  'CONFIG_MAPPING',
  'CLAUDE_CONFIG',
  'CLAUDE_HOME',
  'CURSOR_MCP_CONFIG',
  'WINDSURF_MCP_CONFIG',
  'GEMINI_MCP_CONFIG',
  'CLAUDE_DESKTOP_CONFIG',
  'CODEX_MCP_CONFIG',
  'CLINE_MCP_CONFIG',
  'ROO_CODE_MCP_CONFIG',
  'CONTINUE_MCP_CONFIG',
  'ZED_MCP_CONFIG',
  'TOOLCHAIN_DB',
];

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ambit-first-run-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** Bare `ambit`, piped, with this home and nothing else. */
function bare(): string {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    AMBIT_DB: join(home, 'graph.db'),
    // A version manager's shim reads its config from HOME; the node running
    // this test is the one the wrapper should find.
    PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
    NODE_NO_WARNINGS: '1',
  };
  for (const key of OVERRIDES) delete env[key];
  const r = spawnSync(process.execPath, [WRAPPER], { encoding: 'utf8', env });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
}

function withClaudeCodeAndCursor() {
  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: {
        github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
        playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
      },
    })
  );
  mkdirSync(join(home, '.cursor'));
  writeFileSync(
    join(home, '.cursor', 'mcp.json'),
    JSON.stringify({ mcpServers: { sentry: { url: 'https://mcp.sentry.dev/mcp' } } })
  );
}

test('the first run names what it read, where it wrote, and leads with what one step opens', () => {
  withClaudeCodeAndCursor();
  const out = bare();

  expect(out).toContain('First run');
  expect(out).toMatch(/✓ Claude Code\s+github, playwright/);
  expect(out).toMatch(/✓ Cursor\s+sentry/);
  expect(out).toContain('Nothing was sent anywhere.');
  expect(out).toContain('Read from Claude Code (2 servers) and Cursor (1 server)');

  // The purpose before the guardrail.
  const opens = out.indexOf('What one more step opens');
  expect(opens).toBeGreaterThan(-1);
  const lean = out.indexOf('Before you lean on it');
  if (lean !== -1) expect(opens).toBeLessThan(lean);

  // No record dump, and nothing that exists only in a checkout.
  for (const said of ['is bottleneck:', 'provider id:', 'spofs:', 'AGENTS.md', 'plugins/']) {
    expect([said, out.includes(said)]).toEqual([said, false]);
  }
  expect(out.split('\n').length).toBeLessThan(35);
  expect(out).toContain('ambit status');

  // The second run is the same screen without the seed report.
  const again = bare();
  expect(again).not.toContain('First run');
  expect(again).toContain('What one more step opens');
});

test('with no config, it says where it looked and claims nothing as yours', () => {
  const out = bare();
  expect(out).toContain('No agent config found. Looked for:');
  for (const path of ['~/.claude.json', '~/.cursor/mcp.json', '~/.codex/config.toml']) {
    expect(out).toContain(path);
  }
  expect(out).toContain('all from the curated model');
  expect(out).toContain('Nothing of yours is in the graph yet.');
  expect(out).not.toContain('capabilities reached');
  expect(out).not.toContain('AGENTS.md');
});

test('the telemetry note names a bridge file this copy actually carries', () => {
  const [, file] = telemetryBridgeInstall().match(/^cp '?([^']+?)'? ~\/\.config/) ?? [];
  expect(file && existsSync(file)).toBe(true);
});
