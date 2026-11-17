/**
 * What each server in a pasted config gives the agent, read off the tree it
 * was placed on.
 *
 * The readout said how much of the tree a config reaches and what one more
 * step would open, and never named the servers the visitor had just pasted, so
 * a reader could not tell what any of it had to do with their own setup. This
 * is the answer in their terms: each server, the capabilities on the map it
 * supplies, the ones it alone supplies, and whether it is remote, which the
 * tab cannot check and the CLI can.
 *
 * Read from what placement already decided (`meta.providers` on each reached
 * node), so it says nothing the map does not draw. Pure, and tested apart
 * from the card.
 */
import techtree from '../../engine/techtree.json';
import { detects, type PlaceableNode } from '../../shared/placement';
import type { Item } from './configImporter';

/** One pasted server, as the readout names it. */
export interface YourServer {
  id: string;
  name: string;
  /** Capabilities on the map it supplies, by name, in the tree's order. */
  supplies: string[];
  /** Of those, the ones nothing else here supplies: they go if it goes. */
  alone: string[];
  /** Reached over the network: the tab cannot ask it anything, the CLI can. */
  remote: boolean;
}

const isServer = (i: Item) => i.type === 'mcp-server' && i.status === 'built';

/**
 * The capabilities any MCP server reaches by being one, whatever it is called
 * (Tool Protocol, which says there is at least one): the tree's own patterns,
 * asked about a server whose name means nothing. Listed under one server they
 * say nothing about it.
 */
const ANY_SERVER = new Set(
  ((techtree as unknown as { nodes: PlaceableNode[] }).nodes || [])
    .filter(node => detects(node, 'mcp:zz-a-server-of-no-kind'))
    .map(node => `combo:${node.id}`)
);

/**
 * Each switched-on server in the reading, in the order the file lists them,
 * with what it supplies. A server that supplies nothing on the map is kept,
 * with an empty list: saying so is the honest answer, and the tree is what
 * would grow to place it.
 */
export function yourServers(items: readonly Item[]): YourServer[] {
  const reached = items.filter(
    i => i.id.startsWith('combo:') && i.status === 'built' && !ANY_SERVER.has(i.id)
  );
  return items.filter(isServer).map(server => {
    const supplies: string[] = [];
    const alone: string[] = [];
    for (const node of reached) {
      const providers = (node.meta?.providers as string[] | undefined) ?? [];
      if (!providers.includes(server.id)) continue;
      supplies.push(node.name);
      if (providers.length === 1) alone.push(node.name);
    }
    return {
      id: server.id,
      name: server.name,
      supplies,
      alone,
      remote: server.meta?.type === 'remote',
    };
  });
}
