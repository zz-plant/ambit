/**
 * What each pasted server gives the agent, as the readout names it: the
 * capabilities it supplies, the ones it alone supplies, and whether the tab
 * could ask it anything.
 */
import { expect, test } from 'vitest';
import { importMcpServers } from './configImporter';
import { placeOnMap } from './placeInTab';
import { yourServers } from './yourServers';

function placed(mcpServers: Record<string, unknown>) {
  const graph = importMcpServers({ mcpServers })!;
  return placeOnMap(graph, { id: 'claude-code', name: 'Claude Code' }).items;
}

test('each server is named with what it supplies, in the order the file lists them', () => {
  const servers = yourServers(
    placed({
      github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
      playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
    })
  );
  expect(servers.map(s => s.name)).toEqual(['github', 'playwright']);
  const github = servers[0];
  expect(github.supplies).toContain('Version Control');
  expect(github.remote).toBe(false);
  // Nothing else here browses, so Browser Automation goes with playwright.
  expect(servers[1].alone).toContain('Browser Automation');
});

test('a capability two servers supply is no one server’s alone', () => {
  const servers = yourServers(
    placed({
      github: { command: 'github-mcp' },
      gitlab: { command: 'gitlab-mcp' },
    })
  );
  for (const s of servers) {
    expect(s.supplies).toContain('Version Control');
    expect(s.alone).not.toContain('Version Control');
  }
});

test('a remote server is marked, and one nothing on the map recognises is kept with nothing', () => {
  const servers = yourServers(
    placed({
      linear: { type: 'http', url: 'https://mcp.linear.app/mcp' },
      'my-own-thing': { command: 'my-own-thing' },
      off: { command: 'github-mcp', disabled: true, enabled: false },
    })
  );
  expect(servers.map(s => s.name)).toEqual(['linear', 'my-own-thing']);
  expect(servers[0].remote).toBe(true);
  expect(servers[1].supplies).toEqual([]);
});
