import type { Item, Connection } from './configImporter';

export function computeCivLayout(items: Item[], _connections: Connection[]): Item[] {
  return items.map((item) => ({ ...item, position: { x: item.position?.x || 100, y: item.position?.y || 100, z: 0 } }));
}
