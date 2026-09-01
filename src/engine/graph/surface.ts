/**
 * The graph as something else reads it.
 *
 * A full export, the vocabulary a runtime would own, and the affordance
 * domains derived from structure rather than declared. These answer "what is
 * in here" for another program; the rest of graph/ answers questions about it.
 */
import type { Db } from '../db.ts';
import { loadTechTree } from '../paths.ts';

function exportGraph(db: Db) {
  const caps = db.prepare('SELECT * FROM capabilities').all();
  const deps = db.prepare('SELECT * FROM dependencies').all();
  const items = caps.map(c => {
    var type = c.category;
    if (type === 'mcp') type = 'mcp-server';
    if (type === 'combo') type = 'possibility';
    var status = c.state;
    if (status === 'active' || status === 'unlocked') status = 'built';
    return {
      id: c.id,
      name: c.name,
      type: type,
      status: status,
      description: c.description,
      position: { x: 0, y: 0, z: 0 },
      meta: { domain: c.domain, maturity: c.maturity_score },
    };
  });
  var conns = deps.map(d => {
    var t = d.is_hard_requisite ? 'hard-dep' : 'soft-dep';
    return { from: d.from_capability, to: d.to_capability, type: t };
  });
  return { items: items, connections: conns };
}

// ─── Capability surface (§8) ────────────────────────────────────────────────

/**
 * The machine-readable capability surface, in the shape a runtime would own.
 *
 * §8's unbuilt half. Ambit reads another runtime's private files because no
 * runtime publishes what it can do; that works and is not the right contract.
 * The durable version is an export the runtime owns — and the first runtime to
 * own one can only be Ambit, so this emits the manifest in the shape an export
 * should take. A runtime that publishes this lets the adapter consume it
 * directly instead of parsing private config (see scripts/adapters/surface.ts).
 *
 * The surface is the graph's vocabulary, not its state: what the system can
 * be, what relations mean, and what is permitted — the things that survive a
 * change of installation. State (reached/locked) is deliberately excluded.
 */
function surfaceFor(db: Db) {
  const capabilities = db
    .prepare('SELECT id, name, domain, kind, description FROM capabilities ORDER BY id')
    .all();
  const edges = db
    .prepare(
      'SELECT from_capability, to_capability, kind FROM dependencies ORDER BY from_capability, to_capability'
    )
    .all();
  const authority = db
    .prepare(
      'SELECT capability_id, action, mode, holder, scope, source FROM authority ORDER BY capability_id, action, scope'
    )
    .all();

  return {
    runtime: process.env.AMBIT_RUNTIME || 'opencode',
    schema_version: 1,
    // The surface is vocabulary, not state: ids, kinds and meanings. A runtime
    // that owns an export of itself publishes these.
    capabilities: capabilities.map((c: any) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      domain: c.domain,
      description: c.description,
    })),
    edges: edges.map((e: any) => ({ from: e.from_capability, to: e.to_capability, kind: e.kind })),
    authority: authority.map((a: any) => ({
      capability: a.capability_id,
      action: a.action,
      mode: a.mode,
      holder: a.holder || undefined,
      scope: a.scope || undefined,
      source: a.source,
    })),
  };
}

// ─── Affordance domains (§7b) ────────────────────────────────────────────────

/**
 * The affordance domain of a capability, derived from its structure rather than
 * pasted on.
 *
 * §7b's demand was that `cognitive`, `institutional` and `economic` are not
 * keywords — each implies structure: an institutional capability needs an
 * authority holder, an economic one a budget and a counterparty. So the domain
 * here is *read off the graph*:
 *
 *   institutional  an actor authorises it — approval is required, so an
 *                  authority holder must exist for it to be acquirable
 *   economic       its acquisition carries a recurring cost — a budget and a
 *                  counterparty are implied
 *   cognitive      a person supplies it — human cognition is necessary to
 *                  produce the action
 *   physical       it runs on or uses a device resource
 *
 * A capability can satisfy more than one (paying a contractor is economic and
 * physical). The primary structural domain is reported; the overlaps are named.
 */
function affordanceDomains(db: Db) {
  const caps = db
    .prepare("SELECT id, name, domain, state FROM capabilities WHERE kind = 'capability'")
    .all();
  const edges = db
    .prepare(
      `SELECT d.from_capability f, d.to_capability t, d.kind k, c.kind ck
     FROM dependencies d JOIN capabilities c ON c.id = d.from_capability`
    )
    .all();

  // Structural signals, collected once:
  //   authorizes   → institutional (an authority holder must exist)
  //   provides     → cognitive if the provider is a person
  //   runs_on      → physical: a capability is physical when a provider that
  //                  supplies it runs on a device (provider → device via
  //                  runs_on), not only when the capability itself is the host.
  const institutional = new Set<string>();
  const cognitive = new Set<string>();
  const physical = new Set<string>();
  const providersOn = new Map<string, string[]>(); // provider → [devices]
  for (const e of edges) {
    if (e.k === 'authorizes') institutional.add(e.t);
    if (e.k === 'provides' && e.ck === 'actor') cognitive.add(e.t);
    if (e.k === 'runs_on' && e.f.startsWith('device:')) {
      if (!providersOn.has(e.t)) providersOn.set(e.t, []);
      providersOn.get(e.t)!.push(e.f);
    }
  }
  // capability → providers, then any provider on a device marks it physical.
  for (const e of edges) {
    if (e.k !== 'provides' && e.k !== 'contributes') continue;
    if ((providersOn.get(e.f) || []).length) physical.add(e.t);
  }

  // Machine-composed-human: a capability supplied by both a person and a
  // machine. A person supplies one half, a provider the other, and the
  // affordance exists in the loop rather than in either — the theory's BCI
  // case, given a structural home.
  const machineComposed = new Set<string>();
  const byPerson = new Set<string>();
  const byMachine = new Set<string>();
  for (const e of edges) {
    if (e.k !== 'provides') continue;
    (e.ck === 'actor' ? byPerson : byMachine).add(e.t);
  }
  for (const id of byPerson) {
    if (byMachine.has(id)) machineComposed.add(id);
  }

  // Economic: any acquisition alternative with a recurring cost implies a
  // budget and a counterparty. Read from the authored model.
  const tree = loadTechTree();
  const economic = new Set<string>();
  for (const n of tree.nodes || []) {
    const recurring = (n.acquisition?.alternatives || []).some(
      (a: any) => a.recurring_cost && a.recurring_cost !== 'none'
    );
    if (recurring) economic.add(`combo:${n.id}`);
  }

  const rows = caps.map((c: any) => {
    const structure: string[] = [];
    if (institutional.has(c.id)) structure.push('institutional');
    if (economic.has(c.id)) structure.push('economic');
    if (cognitive.has(c.id)) structure.push('cognitive');
    if (physical.has(c.id)) structure.push('physical');
    // Machine-composed-human: a capability supplied by both a person and a
    // machine — the coupled system whose cognition spans both, which is the
    // BCI case in the theory. The person supplies one part, a provider the
    // other, and the affordance exists in the loop, not in either.
    if (machineComposed.has(c.id)) structure.push('machine-composed-human');
    return {
      id: c.id,
      name: c.name,
      declared_domain: c.domain,
      domain: structure[0] || c.domain,
      structure: structure.length ? structure : undefined,
      reached: c.state !== 'locked',
    };
  });

  return {
    domains: [...new Set(rows.map(r => r.domain))].sort(),
    capabilities: rows.filter(r => r.structure?.length),
    note: 'domains derived from structure: institutional needs an authority holder, economic a budget and counterparty, cognitive a person supplies it, physical a device runs it, machine-composed-human both a person and a machine supply it',
  };
}

export { exportGraph, surfaceFor, affordanceDomains };
