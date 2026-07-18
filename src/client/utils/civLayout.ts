export function computeCivLayout(items, connections) {
  return items.map(item => ({ ...item, position: { x: item.position?.x || 100, y: item.position?.y || 100, z: 0 } }));
}
