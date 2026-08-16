import type { Db } from "./db.ts";
import { PROVISION_EDGES } from "./ontology.ts";
import { usable } from "./assurance.ts";
import { readFileSync } from "fs";
import { join } from "path";
import { ENGINE_DIR } from "./paths.ts";

// ─── Near-Miss Combos (1-2 prerequisites away) ───────────────────────────────

function nearMissCombos(db) {
  const deps = db.prepare("SELECT from_capability, to_capability, is_hard_requisite FROM dependencies WHERE to_capability LIKE 'combo:%'").all();
  const caps = db.prepare("SELECT id, name, maturity_score, state, lifecycle FROM capabilities").all();
  const capMap = new Map<string, Record<string, any>>(caps.map(c => [c.id, c]));
  const groups = new Map();
  for (const d of deps) {
    if (!groups.has(d.to_capability)) groups.set(d.to_capability, []);
    groups.get(d.to_capability).push(d);
  }
  const results = [];
  for (const [comboId, prereqs] of groups) {
    const combo = capMap.get(comboId);
    if (!combo || combo.state === 'unlocked' || combo.state === 'active') continue;
    const hard = prereqs.filter(p => p.is_hard_requisite);
    const metHard = hard.filter(p => { const c = capMap.get(p.from_capability); return c && (c.state === 'unlocked' || c.state === 'active') && usable(c.lifecycle); });
    const missingHard = hard.filter(p => { const c = capMap.get(p.from_capability); return !c || !((c.state === 'unlocked' || c.state === 'active') && usable(c.lifecycle)); });
    // A missing prerequisite that is broken rather than absent: the capability
    // is configured, but its check fails. That is a re-verify, not an add.
    const degradedHard = missingHard.filter(p => capMap.get(p.from_capability)?.state !== 'locked' && !usable(capMap.get(p.from_capability)?.lifecycle));
    if (missingHard.length === 0) continue;
    if (missingHard.length > 2) continue;
    const avgMetMaturity = metHard.length > 0 ? metHard.reduce((s, p) => { const c = capMap.get(p.from_capability); return s + (c ? c.maturity_score : 0); }, 0) / metHard.length : 0;
    if (avgMetMaturity < 0.6) continue;
    results.push({
      name: combo.name,
      id: comboId,
      missing: missingHard.length,
      missing_names: missingHard.map(p => capMap.get(p.from_capability)?.name || p.from_capability),
      degraded: degradedHard.length ? degradedHard.map(p => capMap.get(p.from_capability)?.name || p.from_capability) : undefined,
      met_count: metHard.length,
      total_required: hard.length,
      met_maturity: Math.round(avgMetMaturity * 100),
      investment: degradedHard.length === missingHard.length
        ? `Re-verify ${degradedHard.map(p => capMap.get(p.from_capability)?.name || p.from_capability).join(', ')}`
        : `Add ${missingHard.map(p => capMap.get(p.from_capability)?.name || p.from_capability).join(', ')}`,
      note: degradedHard.length
        ? 'the missing prerequisite is configured but failing verification — re-verify, do not re-add'
        : undefined,
    });
  }
  return results.sort((a, b) => b.met_maturity - a.met_maturity);
}

function computeDecay(db) {
  const caps = db.prepare("SELECT id, name, domain, maturity_score, updated_at FROM capabilities WHERE state IN ('unlocked','active')").all();
  const results = [];
  for (const cap of caps) {
    if (!cap.updated_at) continue;
    const daysSince = (Date.now() - new Date(cap.updated_at + 'Z').getTime()) / (1000 * 60 * 60 * 24);
    const decayAmount = Math.min(0.3, daysSince * 0.01);
    const newMaturity = Math.max(0.1, cap.maturity_score - decayAmount);
    results.push({ capability_id: cap.id, name: cap.name, domain: cap.domain, decayed: newMaturity < cap.maturity_score - 0.05, days_since_config_change: Math.round(daysSince), new_maturity: Math.round(newMaturity * 100) / 100 });
  }
  results.sort((a, b) => b.days_since_config_change - a.days_since_config_change);
  return results;
}

// ─── Combo Discovery ──────────────────────────────────────────────────────────

function discoverCombos(db) {
  const deps = db.prepare("SELECT from_capability, to_capability, is_hard_requisite FROM dependencies WHERE to_capability LIKE 'combo:%'").all();
  const caps = db.prepare("SELECT id, name, maturity_score, state, lifecycle FROM capabilities").all();
  const capMap = new Map<string, Record<string, any>>(caps.map(c => [c.id, c]));
  const results = [];
  const groups = new Map();
  for (const d of deps) {
    if (!groups.has(d.to_capability)) groups.set(d.to_capability, []);
    groups.get(d.to_capability).push(d);
  }
  for (const [comboId, prereqs] of groups) {
    const combo = capMap.get(comboId);
    if (!combo || combo.state === 'unlocked' || combo.state === 'active') continue;
    const hard = prereqs.filter(p => p.is_hard_requisite);
    if (!hard.every(p => { const c = capMap.get(p.from_capability); return c && (c.state === 'unlocked' || c.state === 'active') && usable(c.lifecycle); })) continue;
    const avg = prereqs.reduce((s, p) => { const c = capMap.get(p.from_capability); return s + (c ? c.maturity_score : 0); }, 0) / prereqs.length;
    if (avg < 0.4) continue;
    results.push({ name: combo.name, requirements: prereqs.map(p => capMap.get(p.from_capability)?.name || p.from_capability), unlocks: comboId, confidence: Math.min(1, avg + 0.2), reason: `All prereqs at ${Math.round(avg * 100)}% avg maturity` });
  }
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

// ─── Session Diff ─────────────────────────────────────────────────────────────

function sessionDiff(db) {
  const caps = db.prepare("SELECT id, name, domain, maturity_score, state FROM capabilities WHERE state IN ('unlocked','active')").all();
  const recent = db.prepare("SELECT capability_id, action, outcome_score FROM session_learning ORDER BY timestamp DESC LIMIT 50").all();
  const capMap = new Map<string, Record<string, any>>(caps.map(c => [c.id, c]));
  const domains = new Map();
  for (const c of caps) {
    if (!domains.has(c.domain)) domains.set(c.domain, { total: 0, unlocked: 0, changed_caps: [] });
    const d = domains.get(c.domain); d.total++; if (c.state === 'unlocked' || c.state === 'active') d.unlocked++;
  }
  const seen = new Set();
  for (const e of recent) {
    if (seen.has(e.capability_id)) continue; seen.add(e.capability_id);
    const cap = capMap.get(e.capability_id); if (!cap) continue;
    const domain = domains.get(cap.domain); if (!domain) continue;
    domain.changed_caps.push({ name: cap.name, change: e.outcome_score && e.outcome_score > 0.7 ? 'improved' : e.action === 'regretted' ? 'regretted' : 'practiced', detail: `${Math.round(cap.maturity_score * 100)}% maturity` });
  }
  return Array.from(domains.entries()).map(([d, v]) => ({ domain: d, ...v }));
}

// ─── Domain Health ────────────────────────────────────────────────────────────

function domainHealth(db) {
  const caps = db.prepare("SELECT domain, COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as active, AVG(maturity_score) as avg_maturity FROM capabilities GROUP BY domain").all();
  const results = [];
  for (const cap of caps) {
    const regret = (db.prepare("SELECT COUNT(*) as cnt FROM session_learning sl JOIN capabilities c ON c.id = sl.capability_id WHERE c.domain = ? AND sl.action = 'regretted' GROUP BY c.domain").get(cap.domain) || {}).cnt || 0;
    const decayRisk = cap.active > 0 ? (db.prepare("SELECT AVG(CASE WHEN sl.timestamp < datetime('now', '-30 days') OR sl.timestamp IS NULL THEN 1 ELSE 0 END) as risk FROM capabilities c LEFT JOIN session_learning sl ON sl.capability_id = c.id AND sl.action = 'used' WHERE c.domain = ? AND c.state IN ('unlocked','active')").get(cap.domain) || {}).risk || 0 : 0;
    const health = Math.max(0, Math.min(1, (cap.avg_maturity || 0) * 0.4 + (cap.active / Math.max(cap.total, 1)) * 0.3 + (1 - Math.min(regret / Math.max(cap.active, 1), 1)) * 0.2 + (1 - (decayRisk || 0)) * 0.1));
    results.push({ domain: cap.domain, health: Math.round(health * 100) / 100, total: cap.total, active: cap.active, avg_maturity: Math.round((cap.avg_maturity || 0) * 100) / 100, decay_risk: Math.round((decayRisk || 0) * 100) / 100, regret_count: regret });
  }
  results.sort((a, b) => b.health - a.health);
  return results;
}

// ─── Bottlenecks ──────────────────────────────────────────────────────────────

function findBottlenecks(db) {
  const caps = db.prepare("SELECT id, name, domain, lifecycle FROM capabilities WHERE state IN ('unlocked','active')").all()
    .filter((c: any) => usable(c.lifecycle));
  // Edges onto an action are excluded. An action is conferred by exactly one
  // capability, so counting them would make leverage a function of how many
  // verbs a contract happens to name — write three more into version-control
  // and it climbs the ranking without anything changing about the system.
  const deps = db.prepare(
    `SELECT d.from_capability, d.to_capability FROM dependencies d
     JOIN capabilities t ON t.id = d.to_capability
     WHERE t.kind != 'action'`
  ).all();
  const downstream = new Map();
  const comboIds = new Set(deps.filter(d => d.to_capability.startsWith('combo:')).map(d => d.to_capability));
  for (const d of deps) {
    if (!downstream.has(d.from_capability)) downstream.set(d.from_capability, new Set());
    downstream.get(d.from_capability).add(d.to_capability);
  }
  const results = [];
  for (const cap of caps) {
    const ds = downstream.get(cap.id);
    if (!ds || ds.size === 0) continue;
    let comboUnlocks = 0; ds.forEach(to => { if (comboIds.has(to)) comboUnlocks++; });
    results.push({ capability_id: cap.id, name: cap.name, domain: cap.domain, unlocks_count: ds.size, is_bottleneck: comboUnlocks >= 2 });
  }
  results.sort((a, b) => b.unlocks_count - a.unlocks_count);
  return results;
}

// ─── Impact Analysis ─────────────────────────────────────────────────────────

/**
 * Who supplies each capability.
 *
 * A capability with three providers survives losing one. Nothing consulted
 * these edges, so every analysis treated each provider as though it were the
 * only one — which inflates loss exactly where there is redundancy, the case
 * you most want to distinguish from a single point of failure.
 */
function providersOf(db: Db): Map<string, string[]> {
  // Selected by kind rather than by matching three English sentences. The
  // prose match was silent when it failed: an adapter writing 'Provided by
  // this server' contributed a provider the redundancy analysis could not see,
  // so a capability with two providers still reported as a single point of
  // failure and its loss still read as critical.
  const rows = db
    .prepare(
      `SELECT from_capability f, to_capability t FROM dependencies
       WHERE kind IN (${PROVISION_EDGES.map(() => '?').join(', ')})`
    )
    .all(...PROVISION_EDGES);
  const map = new Map<string, string[]>();
  for (const r of rows) {
    if (!map.has(r.t)) map.set(r.t, []);
    if (!map.get(r.t)!.includes(r.f)) map.get(r.t)!.push(r.f);
  }
  return map;
}

/**
 * What would actually be lost if this went away.
 *
 * Only the loss of the *last* provider takes a capability down. Anything else
 * is a reduction in redundancy, which matters but is not the same claim.
 */
function analyzeImpact(db: Db, capId: string) {
  const cap = db.prepare("SELECT id, name, maturity_score FROM capabilities WHERE id = ?").get(capId);
  if (!cap) return { capability: capId, decayed: [], combos_at_risk: [] };

  const deps = db.prepare("SELECT from_capability, to_capability, is_hard_requisite FROM dependencies").all();
  const allCaps = db.prepare("SELECT id, name, maturity_score, state FROM capabilities").all();
  const capMap = new Map<string, Record<string, any>>(allCaps.map(c => [c.id, c]));
  const providers = providersOf(db);

  /** Nothing else supplies it, so removing this ends it. */
  const isSoleProvider = (target: string) => {
    const list = providers.get(target) || [];
    return list.length > 0 && list.length === 1 && list[0] === capId;
  };
  const remaining = (target: string) => (providers.get(target) || []).filter(p => p !== capId);

  const decayed = deps
    .filter(d => d.from_capability === capId)
    .map(d => {
      const t = capMap.get(d.to_capability);
      const others = remaining(d.to_capability);
      return {
        name: t?.name || d.to_capability,
        becomes_unavailable: d.is_hard_requisite && isSoleProvider(d.to_capability),
        also_provided_by: others.length ? others.length : undefined,
      };
    });

  // Keyed by capability, not by edge. Iterating edges reported the same combo
  // once per prerequisite — "Version Control" four times for one risk.
  const risk = new Map<string, { name: string; severity: string; also_provided_by?: number }>();
  for (const d of deps) {
    if (!d.to_capability.startsWith('combo:')) continue;
    if (d.from_capability !== capId) continue;
    const combo = capMap.get(d.to_capability);
    const others = remaining(d.to_capability);
    const sole = isSoleProvider(d.to_capability);
    risk.set(d.to_capability, {
      name: combo?.name || d.to_capability,
      severity: d.is_hard_requisite && sole ? 'critical' : others.length ? 'redundant' : 'warning',
      also_provided_by: others.length || undefined,
    });
  }

  return { capability: cap.name, decayed, combos_at_risk: [...risk.values()] };
}

/**
 * Capabilities with exactly one provider — where redundancy is absent rather
 * than merely thin. This is the question `tt bottlenecks` is often asked to
 * answer and does not: it ranks by how much depends on something, which is
 * leverage, not fragility.
 */
function singlePointsOfFailure(db: Db) {
  const providers = providersOf(db);
  const names = new Map(
    db.prepare("SELECT id, name, state, kind, lifecycle FROM capabilities").all().map((c: any) => [c.id, c])
  );
  const out: any[] = [];
  for (const [target, list] of providers) {
    if (list.length !== 1) continue;
    const t = names.get(target) as any;
    if (!t || t.state === 'locked' || !usable(t.lifecycle)) continue; // not available; nothing to lose
    // An action conferred by a capability has one provider by definition, not
    // by fragility, and listing all of them would bury the real answers. An
    // action a *person* supplies is a different matter — one provider there is
    // exactly the finding, because only that person can do it.
    if (t.kind === 'action' && (names.get(list[0]) as any)?.kind === 'capability') continue;
    out.push({
      capability: t.name,
      id: target,
      sole_provider: (names.get(list[0]) as any)?.name || list[0],
      provider_id: list[0],
    });
  }
  return out.length
    ? out
    : { note: 'Every reached capability has more than one provider, or none are recorded.' };
}


function exportGraph(db) {
  const caps = db.prepare("SELECT * FROM capabilities").all();
  const deps = db.prepare("SELECT * FROM dependencies").all();
  const items = caps.map(function(c) {
    var type = c.category;
    if (type === 'mcp') type = 'mcp-server';
    if (type === 'combo') type = 'possibility';
    var status = c.state;
    if (status === 'active' || status === 'unlocked') status = 'built';
    return { id: c.id, name: c.name, type: type, status: status, description: c.description, position: { x: 0, y: 0, z: 0 }, meta: { domain: c.domain, maturity: c.maturity_score } };
  });
  var conns = deps.map(function(d) {
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
  const capabilities = db.prepare(
    "SELECT id, name, domain, kind, description FROM capabilities ORDER BY id"
  ).all();
  const edges = db.prepare(
    "SELECT from_capability, to_capability, kind FROM dependencies ORDER BY from_capability, to_capability"
  ).all();
  const authority = db.prepare(
    "SELECT capability_id, action, mode, holder, scope, source FROM authority ORDER BY capability_id, action, scope"
  ).all();

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
  const caps = db.prepare(
    "SELECT id, name, domain, state FROM capabilities WHERE kind = 'capability'"
  ).all();
  const edges = db.prepare(
    `SELECT d.from_capability f, d.to_capability t, d.kind k, c.kind ck
     FROM dependencies d JOIN capabilities c ON c.id = d.from_capability`
  ).all();

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
  let tree: any = { nodes: [] };
  try { tree = JSON.parse(readFileSync(join(ENGINE_DIR, "techtree.json"), "utf8")); } catch {}
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

export {
  nearMissCombos, computeDecay,
  discoverCombos, sessionDiff, domainHealth, findBottlenecks,
  providersOf, analyzeImpact, singlePointsOfFailure,
  exportGraph, affordanceDomains, surfaceFor,
};
