/**
 * The readout says the same about a setup wherever it is read.
 *
 * A visitor pastes a config into the hosted page, or ticks the servers they
 * run, and is told how much of the tree it reaches and which step would open
 * the most. Then they run `npx ambit-cli` on the machine the config came
 * from. The two were ranked by different rules, so the same three servers
 * got Local Runtime from the page and Hosting from the terminal, and the page
 * counted 9 of 46 where the terminal counted 18 of 55. Each case here reads
 * one config both ways: the real CLI against a home directory holding it, and
 * the page's own store, given the agent the visitor said they use.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { isEntry, nextSteps, visibleItems } from './components/civ/layout';
import { useAmbitStore } from './store/ambitStore';

const WRAPPER = join(import.meta.dirname, '..', '..', 'cli.js');

/** Every variable that would point discovery somewhere other than the home given. */
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
  'OLLAMA_MODELS',
  'AMBIT_LMSTUDIO_MODELS',
  'TOOLCHAIN_DB',
];

interface Brief {
  reached: number;
  total: number;
  next: { capability: string; cost: string; why: string }[];
}

/** What `ambit` says on a first run, as data, for a Claude Code config holding these servers. */
function terminal(config: object): Brief {
  const home = mkdtempSync(join(tmpdir(), 'ambit-parity-'));
  try {
    writeFileSync(join(home, '.claude.json'), JSON.stringify(config));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      AMBIT_DB: join(home, 'graph.db'),
      PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
      NODE_NO_WARNINGS: '1',
    };
    for (const key of OVERRIDES) delete env[key];
    // The first command seeds; the second answers from the graph it wrote.
    spawnSync(process.execPath, [WRAPPER, 'seed'], { encoding: 'utf8', env });
    const r = spawnSync(process.execPath, [WRAPPER, 'status', '--brief', '--json'], {
      encoding: 'utf8',
      env,
    });
    expect(r.status, r.stderr).toBe(0);
    const brief = JSON.parse(r.stdout) as Brief;
    // The command is the terminal's own; the page words its action for the tab.
    return {
      ...brief,
      next: brief.next.map(({ capability, cost, why }) => ({ capability, cost, why })),
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** What the hosted page's readout says for the same config, pasted by a Claude Code user. */
function page(config: object): Brief {
  const ok = useAmbitStore
    .getState()
    .loadFromJSON(JSON.stringify(config), false, { id: 'claude-code', name: 'Claude Code' });
  expect(ok).toBe(true);
  const { items, connections } = useAmbitStore.getState();
  const tree = visibleItems(items).filter(i => !isEntry(i));
  return {
    reached: tree.filter(i => i.status === 'built').length,
    total: tree.length,
    next: nextSteps(items, connections).map(s => ({
      capability: s.item.name,
      cost: s.cost,
      why: s.why,
    })),
  };
}

const CASES: Record<string, object> = {
  'three servers': {
    mcpServers: {
      github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
      playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
      postgres: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'] },
    },
  },
  'a product stack': {
    mcpServers: {
      github: { command: 'gh-mcp' },
      supabase: { command: 'npx', args: ['-y', '@supabase/mcp-server-supabase'] },
      stripe: { command: 'npx', args: ['-y', '@stripe/mcp'] },
      vercel: { url: 'https://mcp.vercel.com' },
      sentry: { url: 'https://mcp.sentry.dev/mcp' },
      slack: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'] },
    },
  },
  'a local model and search': {
    mcpServers: {
      ollama: { command: 'ollama-mcp' },
      'brave-search': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'] },
      memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
    },
  },
};

for (const [name, config] of Object.entries(CASES)) {
  test(`${name}: the page and the terminal reach as far, and name the same next steps`, () => {
    const said = terminal(config);
    const shown = page(config);
    expect(shown.reached).toBe(said.reached);
    expect(shown.total).toBe(said.total);
    // The terminal lists two; the page, three. The two it shares come first.
    expect(said.next.length).toBeGreaterThan(0);
    expect(shown.next.slice(0, said.next.length)).toEqual(said.next);
  });
}
