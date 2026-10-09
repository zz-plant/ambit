/**
 * A config read in the tab, placed on the curated tree.
 *
 * Kept apart from configImporter.ts, which the demo generator loads under
 * plain Node: this one carries the shipped tree as JSON, which only the
 * bundler reads without an import attribute.
 */
import techtree from '../../engine/techtree.json';
import { type PlaceableNode, placeOnTree } from '../../shared/placement';
import { BUILT_INS, RUNTIME_MODEL } from '../../shared/runtimes';
import { type Connection, type Item, RUNTIME_ID } from './configImporter';

/** Which agent a pasted file belongs to, as far as its shape says. */
export interface TabRuntime {
  /** The engine's runtime id; null for an `mcpServers` file that names no client. */
  id: string | null;
  /** What the page calls it. */
  name: string;
}

/**
 * `~/.claude.json` holds more than servers, and the keys only Claude Code
 * writes say whose it is. Its servers may also sit under a project, which is
 * where `claude mcp add` puts them by default; the engine's reader collects
 * both, and so does this.
 */
export function claudeCodeServers(data: Record<string, unknown>): Record<string, unknown> | null {
  const marked = ['projects', 'numStartups', 'oauthAccount', 'firstStartTime'].some(k => k in data);
  if (!marked) return null;
  const servers: Record<string, unknown> = {};
  const collect = (block: unknown) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return;
    for (const [name, server] of Object.entries(block))
      if (!(name in servers)) servers[name] = server;
  };
  collect(data.mcpServers);
  const projects = data.projects;
  if (projects && typeof projects === 'object') {
    for (const project of Object.values(projects as Record<string, unknown>)) {
      collect((project as Record<string, unknown> | null)?.mcpServers);
    }
  }
  return servers;
}

interface TreeFile {
  eras: Record<string, string>;
  nodes: (PlaceableNode & { domain?: string; setup_seconds?: number })[];
}

/**
 * A config read in the tab, placed on the curated tree the way `ambit` would
 * place it: what every runtime brings, the model the runtime runs on, and the
 * file's own entries, matched against the shipped tree by `placeOnTree`.
 *
 * What only the engine knows stays absent: no check has run, so every node's
 * lifecycle is unknown, and no grant was read, so no node states an authority.
 * A switched-off entry is drawn and proves nothing.
 */
export function placeOnMap(
  graph: { items: Item[]; connections: Connection[] },
  runtime: TabRuntime
): { items: Item[]; connections: Connection[]; model: string | null } {
  const tree = techtree as unknown as TreeFile;
  const runtimeId = runtime.id ? `runtime:${runtime.id}` : RUNTIME_ID;
  const rename = (id: string) => (id === RUNTIME_ID ? runtimeId : id);
  const at = { x: 0, y: 0, z: 0 };

  const entries: Item[] = graph.items.map(i => ({
    ...i,
    id: rename(i.id),
    ...(i.id === RUNTIME_ID
      ? { name: runtime.name, description: 'The agent this config belongs to' }
      : {}),
    meta: { ...i.meta, state: i.status === 'built' ? 'unlocked' : 'locked', lifecycle: 'unknown' },
  }));
  const has = new Set(entries.map(i => i.id));
  for (const b of BUILT_INS) {
    if (has.has(b.id)) continue;
    entries.push({
      id: b.id,
      name: b.name,
      type: b.kind,
      status: 'built',
      description: b.description,
      position: at,
      meta: { domain: b.domain, state: 'active', lifecycle: 'unknown' },
    });
  }
  // The model the runtime runs on, when its config names none: listed for a
  // runtime whose model comes with it, and taken as a hosted one for a file
  // that does not say whose it is, since every client writing that block
  // runs its agent on a model.
  const hosted = runtime.id
    ? RUNTIME_MODEL[runtime.id]
    : { id: 'client', name: "Your client's model" };
  const declaresModel = entries.some(i => i.type === 'provider' || i.type === 'model');
  const counted = hosted && !declaresModel && !has.has(`provider:${hosted.id}`);
  if (counted) {
    entries.push({
      id: `provider:${hosted.id}`,
      name: hosted.name,
      type: 'provider',
      status: 'built',
      description: `The hosted model ${runtime.name} runs on`,
      position: at,
      meta: { domain: 'ai-ml', state: 'unlocked', lifecycle: 'unknown' },
    });
  }

  const connections: Connection[] = graph.connections.map(c => ({
    ...c,
    from: rename(c.from),
    to: rename(c.to),
    type: 'hard-dep',
    kind: 'contributes',
  }));
  const owned = entries.filter(i => i.status === 'built').map(i => i.id);
  const nodes: Item[] = [];
  for (const { node, reached, proof, missing, description } of placeOnTree(tree.nodes, owned)) {
    const id = `combo:${node.id}`;
    nodes.push({
      id,
      name: node.name,
      type: 'possibility',
      status: reached ? 'built' : 'specified',
      description,
      position: at,
      meta: {
        domain: node.domain || 'meta',
        state: reached ? 'unlocked' : 'locked',
        setupSeconds: node.setup_seconds || 0,
        era: node.era,
        eraName: node.era === undefined ? undefined : tree.eras[String(node.era)],
        next: !reached && missing.length === 0,
        lifecycle: 'unknown',
        ...(proof.length ? { providers: proof } : {}),
      },
    });
    for (const from of proof)
      connections.push({ from, to: id, type: 'hard-dep', kind: 'provides' });
    for (const req of node.requires || []) {
      connections.push({ from: `combo:${req}`, to: id, type: 'hard-dep', kind: 'requires' });
    }
    for (const opt of node.optional || []) {
      connections.push({ from: `combo:${opt}`, to: id, type: 'soft-dep', kind: 'optional' });
    }
  }
  return { items: [...entries, ...nodes], connections, model: counted ? hosted.name : null };
}
