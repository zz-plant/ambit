/**
 * The readout of a config read in the tab names the reader's own servers:
 * what each gives the agent, what goes without it, and which are remote,
 * which only the CLI can ask anything.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test } from 'vitest';
import { importMcpServers } from '../utils/configImporter';
import { placeOnMap } from '../utils/placeInTab';
import { seed } from '../testing/page';
import YourAmbit from './YourAmbit';

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&#x27;/g, "'");

afterEach(() => seed({ items: [], connections: [], reading: null }));

function readIn(mcpServers: Record<string, unknown>) {
  const graph = importMcpServers({ mcpServers })!;
  const { items, connections, model } = placeOnMap(graph, {
    id: 'claude-code',
    name: 'Claude Code',
  });
  seed({
    items,
    connections,
    reading: {
      runtime: 'Claude Code',
      named: true,
      entries: Object.keys(mcpServers).length,
      model,
      picked: false,
    },
  });
  return text(renderToStaticMarkup(<YourAmbit onClose={() => {}} />));
}

test('each pasted server is named with what it gives the agent, and what goes without it', () => {
  const said = readIn({
    github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
    playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
  });
  expect(said).toContain('What your servers give the agent');
  expect(said).toMatch(/github [^.]*Version Control/);
  expect(said).toMatch(/playwright [^.]*Browser Automation/);
  expect(said).toMatch(/playwright Browser Automation[^·]* · only source/);
  expect(said).toContain('If an only source stops, what it supplies stops with it.');
  // Two servers that both supply something: neither is the only one.
  const shared = readIn({ github: { command: 'github-mcp' }, gitlab: { command: 'gitlab-mcp' } });
  expect(shared).toMatch(/github Version Control gitlab Version Control/);
  expect(shared).not.toContain('only source');
  // Reached by any MCP server, it says nothing about this one.
  expect(said).not.toMatch(/github Tool Protocol/);
  // The servers come before the steps: the reader's own setup first.
  expect(said.indexOf('What your servers give')).toBeLessThan(said.indexOf('What one more step'));
});

test('a remote server is marked, and the limits name it as one the CLI would ask', () => {
  const said = readIn({
    github: { command: 'github-mcp' },
    linear: { type: 'http', url: 'https://mcp.linear.app/mcp' },
  });
  expect(said).toMatch(/linear Issue Tracking/);
  expect(said).toMatch(/linear [^·]*· remote/);
  expect(said).toContain('on your machine, and asks linear whether it answers:');
});

test('the machine’s own graph gets no server list, since My Setup is that list', () => {
  seed({ items: [], connections: [], reading: null });
  const said = text(renderToStaticMarkup(<YourAmbit onClose={() => {}} />));
  expect(said).not.toContain('What your servers give the agent');
});
