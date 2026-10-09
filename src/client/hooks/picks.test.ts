/**
 * The servers a visitor can tick instead of pasting a file. Each is named so
 * the tree's `detect` patterns match it; a pick no node recognised would be a
 * button that did nothing, and the list would rot as the tree changes. Some
 * are reached only with their prerequisites (Slack's Notifications waits on
 * Scheduled Work), and the map says so on the node, which is still an answer.
 */
import { expect, test } from 'vitest';
import { importMcpServers } from '../utils/configImporter';
import { placeOnMap } from '../utils/placeInTab';
import { PICKS } from './useConfigImport';

test.each(PICKS)('$label is recognised by a node of the tree', ({ server }) => {
  const graph = importMcpServers({ mcpServers: { [server]: {} } })!;
  const { items } = placeOnMap(graph, { id: null, name: 'Your agent' });
  const provided = items.filter(i =>
    (i.meta.providers as string[] | undefined)?.includes(`mcp:${server}`)
  );
  expect(provided.length).toBeGreaterThan(0);
});
