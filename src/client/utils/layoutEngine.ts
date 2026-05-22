import type { Item, Connection } from './configImporter';

interface Vec3 { x: number; y: number; z: number }

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function len(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function mag(v: Vec3): number {
  const l = len(v) || 0.001;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function dist(a: Vec3, b: Vec3): number {
  return len(sub(a, b));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampStep(value: number, maxStep = 0.35): number {
  return clamp(value, -maxStep, maxStep);
}

function sanitizePosition(pos: Vec3, max = 36): Vec3 {
  return {
    x: Number.isFinite(pos.x) ? clamp(pos.x, -max, max) : 0,
    y: Number.isFinite(pos.y) ? clamp(pos.y, -max, max) : 0,
    z: Number.isFinite(pos.z) ? clamp(pos.z, -max, max) : 0,
  };
}

const TYPE_RADII: Record<string, number> = {
  framework: 0,
  'mcp-server': 4,
  agent: 6,
  provider: 5,
  model: 7,
  command: 8,
  skill: 6,
  config: 5,
  possibility: 9,
  device: 3,
  api: 4,
  service: 6,
  network: 4,
  workflow: 5,
};

export function computeLayout(
  items: Item[],
  connections: Connection[],
  iterations = 80,
  layoutMode: 'constellation' | 'orbital' | 'flat' = 'constellation'
): Item[] {
  const positions = new Map<string, Vec3>();

  if (layoutMode === 'orbital') {
    // Core at (0, 0, 0)
    const core = items.find(i => i.id === 'opencode-core');
    if (core) {
      positions.set(core.id, { x: 0, y: 0, z: 0 });
    }

    // Group items by type to put them on concentric shells
    const typesOrder = ['device', 'api', 'network', 'service', 'workflow', 'agent', 'provider', 'mcp-server', 'model', 'command', 'skill', 'config', 'possibility'];
    const radiusStep = 3.2;

    typesOrder.forEach((type, typeIdx) => {
      const typeItems = items.filter(i => i.type === type && i.id !== 'opencode-core');
      if (typeItems.length === 0) return;

      const radius = (typeIdx + 1) * radiusStep;
      const count = typeItems.length;

      typeItems.forEach((item, index) => {
        // Fibonacci sphere point distribution
        const phi = Math.acos(1 - 2 * (index + 0.5) / count);
        const theta = Math.PI * (1 + Math.sqrt(5)) * index;
        positions.set(item.id, {
          x: radius * Math.sin(phi) * Math.cos(theta),
          y: radius * Math.cos(phi),
          z: radius * Math.sin(phi) * Math.sin(theta),
        });
      });
    });

    // Fallback for any other types
    for (const item of items) {
      if (!positions.has(item.id)) {
        positions.set(item.id, {
          x: (Math.random() - 0.5) * 8,
          y: (Math.random() - 0.5) * 8,
          z: (Math.random() - 0.5) * 8
        });
      }
    }

    return items.map(item => ({
      ...item,
      position: sanitizePosition(positions.get(item.id)!),
    }));
  }

  if (layoutMode === 'flat') {
    // 2D force-directed layout on Y = -2 plane
    for (const item of items) {
      const r = TYPE_RADII[item.type] || 5;
      const theta = Math.random() * Math.PI * 2;
      positions.set(item.id, {
        x: r * Math.cos(theta),
        y: -2,
        z: r * Math.sin(theta),
      });
    }

    const springRest = 4;
    const repulsion = 30;
    const springStrength = 0.1;
    const repulsionStrength = 0.5;

    for (let iter = 0; iter < iterations; iter++) {
      const forces = new Map<string, Vec3>();
      for (const id of items.map(i => i.id)) forces.set(id, { x: 0, y: 0, z: 0 });

      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = positions.get(items[i].id)!;
          const b = positions.get(items[j].id)!;
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const d = Math.max(1.2, Math.sqrt(dx * dx + dz * dz) || 1.2);
          const rep = repulsion / (d * d);

          forces.get(items[i].id)!.x -= (dx / d) * rep * repulsionStrength;
          forces.get(items[i].id)!.z -= (dz / d) * rep * repulsionStrength;
          forces.get(items[j].id)!.x += (dx / d) * rep * repulsionStrength;
          forces.get(items[j].id)!.z += (dz / d) * rep * repulsionStrength;
        }
      }

      for (const conn of connections) {
        const a = positions.get(conn.from);
        const b = positions.get(conn.to);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.sqrt(dx * dx + dz * dz) || 0.001;
        const spring = (d - springRest) * springStrength;

        forces.get(conn.from)!.x += (dx / d) * spring;
        forces.get(conn.from)!.z += (dz / d) * spring;
        forces.get(conn.to)!.x -= (dx / d) * spring;
        forces.get(conn.to)!.z -= (dz / d) * spring;
      }

      for (const item of items) {
        const pos = positions.get(item.id)!;
        const f = forces.get(item.id)!;
        pos.x += clampStep(f.x);
        pos.z += clampStep(f.z);
        const next = sanitizePosition(pos, 42);
        pos.x = next.x;
        pos.z = next.z;
      }
    }

    return items.map(item => ({
      ...item,
      position: sanitizePosition(positions.get(item.id) || item.position),
    }));
  }

  // Default: 'constellation' (3D force-directed layout)
  for (const item of items) {
    const r = TYPE_RADII[item.type] || 5;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions.set(item.id, {
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.cos(phi),
      z: r * Math.sin(phi) * Math.sin(theta),
    });
  }

  const springRest = 4;
  const repulsion = 30;
  const springStrength = 0.1;
  const repulsionStrength = 0.5;

  for (let iter = 0; iter < iterations; iter++) {
    const forces = new Map<string, Vec3>();
    for (const id of items.map(i => i.id)) forces.set(id, { x: 0, y: 0, z: 0 });

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = positions.get(items[i].id)!;
        const b = positions.get(items[j].id)!;
        const d = Math.max(1.2, dist(a, b));
        const dir = mag(sub(b, a));
        const rep = repulsion / (d * d);
        forces.get(items[i].id)!.x -= dir.x * rep * repulsionStrength;
        forces.get(items[i].id)!.y -= dir.y * rep * repulsionStrength;
        forces.get(items[i].id)!.z -= dir.z * rep * repulsionStrength;
        forces.get(items[j].id)!.x += dir.x * rep * repulsionStrength;
        forces.get(items[j].id)!.y += dir.y * rep * repulsionStrength;
        forces.get(items[j].id)!.z += dir.z * rep * repulsionStrength;
      }
    }

    for (const conn of connections) {
      const a = positions.get(conn.from);
      const b = positions.get(conn.to);
      if (!a || !b) continue;
      const d = Math.max(0.8, dist(a, b));
      const dir = mag(sub(b, a));
      const spring = (d - springRest) * springStrength;
      forces.get(conn.from)!.x += dir.x * spring;
      forces.get(conn.from)!.y += dir.y * spring;
      forces.get(conn.from)!.z += dir.z * spring;
      forces.get(conn.to)!.x -= dir.x * spring;
      forces.get(conn.to)!.y -= dir.y * spring;
      forces.get(conn.to)!.z -= dir.z * spring;
    }

    for (const item of items) {
      const pos = positions.get(item.id)!;
      const f = forces.get(item.id)!;
      pos.x += clampStep(f.x);
      pos.y += clampStep(f.y);
      pos.z += clampStep(f.z);
      const next = sanitizePosition(pos, 42);
      pos.x = next.x;
      pos.y = next.y;
      pos.z = next.z;
    }
  }

  return items.map(item => ({
    ...item,
    position: sanitizePosition(positions.get(item.id) || item.position),
  }));
}
