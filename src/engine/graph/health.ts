/**
 * How healthy each domain is, and what the most things depend on.
 *
 * A bottleneck here is leverage rather than a problem: the node whose loss
 * would cost the most is also the one whose improvement pays the most.
 */
import type { Db } from '../db.ts';
import { usable } from '../assurance.ts';

// ─── Domain Health ────────────────────────────────────────────────────────────

function domainHealth(db: Db) {
  const caps = db
    .prepare(
      "SELECT domain, COUNT(*) as total, SUM(CASE WHEN state IN ('unlocked','active') THEN 1 ELSE 0 END) as active, AVG(maturity_score) as avg_maturity FROM capabilities GROUP BY domain"
    )
    .all();
  const results = [];
  for (const cap of caps) {
    const regret =
      db
        .prepare(
          "SELECT COUNT(*) as cnt FROM session_learning sl JOIN capabilities c ON c.id = sl.capability_id WHERE c.domain = ? AND sl.action = 'regretted' GROUP BY c.domain"
        )
        .get(cap.domain)?.cnt || 0;
    const decayRisk =
      cap.active > 0
        ? db
            .prepare(
              "SELECT AVG(CASE WHEN sl.timestamp < datetime('now', '-30 days') OR sl.timestamp IS NULL THEN 1 ELSE 0 END) as risk FROM capabilities c LEFT JOIN session_learning sl ON sl.capability_id = c.id AND sl.action = 'used' WHERE c.domain = ? AND c.state IN ('unlocked','active')"
            )
            .get(cap.domain)?.risk || 0
        : 0;
    const health = Math.max(
      0,
      Math.min(
        1,
        (cap.avg_maturity || 0) * 0.4 +
          (cap.active / Math.max(cap.total, 1)) * 0.3 +
          (1 - Math.min(regret / Math.max(cap.active, 1), 1)) * 0.2 +
          (1 - (decayRisk || 0)) * 0.1
      )
    );
    results.push({
      domain: cap.domain,
      health: Math.round(health * 100) / 100,
      total: cap.total,
      active: cap.active,
      avg_maturity: Math.round((cap.avg_maturity || 0) * 100) / 100,
      decay_risk: Math.round((decayRisk || 0) * 100) / 100,
      regret_count: regret,
    });
  }
  results.sort((a, b) => b.health - a.health);
  return results;
}

// ─── Bottlenecks ──────────────────────────────────────────────────────────────

function findBottlenecks(db: Db) {
  const caps = db
    .prepare(
      "SELECT id, name, domain, lifecycle FROM capabilities WHERE state IN ('unlocked','active')"
    )
    .all()
    .filter((c: any) => usable(c.lifecycle));
  // Edges onto an action are excluded. An action is conferred by exactly one
  // capability, so counting them would make leverage a function of how many
  // verbs a contract happens to name — write three more into version-control
  // and it climbs the ranking without anything changing about the system.
  const deps = db
    .prepare(
      `SELECT d.from_capability, d.to_capability FROM dependencies d
     JOIN capabilities t ON t.id = d.to_capability
     WHERE t.kind != 'action'`
    )
    .all();
  const downstream = new Map();
  const comboIds = new Set(
    deps.filter(d => d.to_capability.startsWith('combo:')).map(d => d.to_capability)
  );
  for (const d of deps) {
    if (!downstream.has(d.from_capability)) downstream.set(d.from_capability, new Set());
    downstream.get(d.from_capability).add(d.to_capability);
  }
  const results = [];
  for (const cap of caps) {
    const ds = downstream.get(cap.id);
    if (!ds || ds.size === 0) continue;
    let comboUnlocks = 0;
    ds.forEach((to: string) => {
      if (comboIds.has(to)) comboUnlocks++;
    });
    results.push({
      capability_id: cap.id,
      name: cap.name,
      domain: cap.domain,
      unlocks_count: ds.size,
      is_bottleneck: comboUnlocks >= 2,
    });
  }
  results.sort((a, b) => b.unlocks_count - a.unlocks_count);
  return results;
}

export { domainHealth, findBottlenecks };
