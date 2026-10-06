/**
 * Which entries the page may switch, and what a switch asks for.
 *
 * The one edit the browser makes to a real config is `enabled` on an MCP entry
 * that is already there. Creating one stays a hand edit, because an entry
 * carries a command the runtime executes: see the security posture in AGENTS.md.
 *
 * The gate is read from the same config the route edits. `/api/config/apply`
 * answers ok for a name it has no entry for and changes nothing, so a switch
 * offered for a server that another runtime's config declared would flip,
 * reload and flip back, having said it worked. `configMcp` is the global
 * config's own entries, and only they get a switch.
 */
import type { Item } from './configImporter';
import { isConfigEntry } from './labels';

/**
 * Whether this row or panel gets an enable switch.
 *
 * The last three conditions are the server's `ownEntry` over the client's copy
 * of the config: an own key holding an object. A bare `configMcp[name]` is truthy
 * for `constructor` and `toString`, which Object.prototype supplies, so a
 * server given one of those names would be offered a switch that changes
 * nothing.
 */
export function canSwitchMcp(
  item: Pick<Item, 'type' | 'name' | 'meta'>,
  backend: string,
  configMcp: Record<string, unknown>
): boolean {
  return (
    backend === 'live' &&
    item.type === 'mcp-server' &&
    isConfigEntry(item) &&
    Object.hasOwn(configMcp, item.name) &&
    typeof configMcp[item.name] === 'object' &&
    configMcp[item.name] !== null
  );
}

/**
 * Ask for the opposite of what the entry is now, and say what to tell the
 * person if it did not take. Null means it did.
 */
export async function flipMcp(
  item: Pick<Item, 'name' | 'status'>,
  toggle: (name: string, enabled: boolean) => Promise<string | null>
): Promise<string | null> {
  const refused = await toggle(item.name, item.status !== 'built');
  return refused === null ? null : `Could not switch ${item.name}. ${refused}`;
}
