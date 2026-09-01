/**
 * What the graph could become, and what is quietly rotting.
 *
 * Near-miss combos are the ones a step or two from reachable — the frontier
 * worth looking at. Decay is the opposite reading of the same graph: what has
 * not been touched in long enough to doubt. Split out of inference.ts, which
 * was 790 lines answering four unrelated questions about one graph.
 */
import type { Db } from '../db.ts';
import { usable } from '../assurance.ts';

// ─── Near-Miss Combos (1-2 prerequisites away) ───────────────────────────────

function nearMissCombos(db: Db) {
  const deps = db
    .prepare(
      "SELECT from_capability, to_capability, is_hard_requisite FROM dependencies WHERE to_capability LIKE 'combo:%'"
    )
    .all();
  const caps = db
    .prepare('SELECT id, name, maturity_score, state, lifecycle FROM capabilities')
    .all();
  const capMap = new Map<string, Record<string, any>>(caps.map(c => [c.id, c]));
  const groups = new Map<string, Record<string, any>[]>();
  for (const d of deps) {
    if (!groups.has(d.to_capability)) groups.set(d.to_capability, []);
    groups.get(d.to_capability)!.push(d);
  }
  const results = [];
  for (const [comboId, prereqs] of groups) {
    const combo = capMap.get(comboId);
    if (!combo || combo.state === 'unlocked' || combo.state === 'active') continue;
    const hard = prereqs.filter(p => p.is_hard_requisite);
    const metHard = hard.filter(p => {
      const c = capMap.get(p.from_capability);
      return c && (c.state === 'unlocked' || c.state === 'active') && usable(c.lifecycle);
    });
    const missingHard = hard.filter(p => {
      const c = capMap.get(p.from_capability);
      return !c || !((c.state === 'unlocked' || c.state === 'active') && usable(c.lifecycle));
    });
    // A missing prerequisite that is broken rather than absent: the capability
    // is configured, but its check fails. That is a re-verify, not an add.
    const degradedHard = missingHard.filter(
      p =>
        capMap.get(p.from_capability)?.state !== 'locked' &&
        !usable(capMap.get(p.from_capability)?.lifecycle)
    );
    if (missingHard.length === 0) continue;
    if (missingHard.length > 2) continue;
    const avgMetMaturity =
      metHard.length > 0
        ? metHard.reduce((s, p) => {
            const c = capMap.get(p.from_capability);
            return s + (c ? c.maturity_score : 0);
          }, 0) / metHard.length
        : 0;
    if (avgMetMaturity < 0.6) continue;
    results.push({
      name: combo.name,
      id: comboId,
      missing: missingHard.length,
      missing_names: missingHard.map(p => capMap.get(p.from_capability)?.name || p.from_capability),
      degraded: degradedHard.length
        ? degradedHard.map(p => capMap.get(p.from_capability)?.name || p.from_capability)
        : undefined,
      met_count: metHard.length,
      total_required: hard.length,
      met_maturity: Math.round(avgMetMaturity * 100),
      investment:
        degradedHard.length === missingHard.length
          ? `Re-verify ${degradedHard.map(p => capMap.get(p.from_capability)?.name || p.from_capability).join(', ')}`
          : `Add ${missingHard.map(p => capMap.get(p.from_capability)?.name || p.from_capability).join(', ')}`,
      note: degradedHard.length
        ? 'the missing prerequisite is configured but failing verification — re-verify, do not re-add'
        : undefined,
    });
  }
  return results.sort((a, b) => b.met_maturity - a.met_maturity);
}

function computeDecay(db: Db) {
  const caps = db
    .prepare(
      "SELECT id, name, domain, maturity_score, updated_at FROM capabilities WHERE state IN ('unlocked','active')"
    )
    .all();
  const results = [];
  for (const cap of caps) {
    if (!cap.updated_at) continue;
    const daysSince =
      (Date.now() - new Date(cap.updated_at + 'Z').getTime()) / (1000 * 60 * 60 * 24);
    const decayAmount = Math.min(0.3, daysSince * 0.01);
    const newMaturity = Math.max(0.1, cap.maturity_score - decayAmount);
    results.push({
      capability_id: cap.id,
      name: cap.name,
      domain: cap.domain,
      decayed: newMaturity < cap.maturity_score - 0.05,
      days_since_config_change: Math.round(daysSince),
      new_maturity: Math.round(newMaturity * 100) / 100,
    });
  }
  results.sort((a, b) => b.days_since_config_change - a.days_since_config_change);
  return results;
}

// ─── Combo Discovery ──────────────────────────────────────────────────────────

function discoverCombos(db: Db) {
  const deps = db
    .prepare(
      "SELECT from_capability, to_capability, is_hard_requisite FROM dependencies WHERE to_capability LIKE 'combo:%'"
    )
    .all();
  const caps = db
    .prepare('SELECT id, name, maturity_score, state, lifecycle FROM capabilities')
    .all();
  const capMap = new Map<string, Record<string, any>>(caps.map(c => [c.id, c]));
  const results = [];
  const groups = new Map<string, Record<string, any>[]>();
  for (const d of deps) {
    if (!groups.has(d.to_capability)) groups.set(d.to_capability, []);
    groups.get(d.to_capability)!.push(d);
  }
  for (const [comboId, prereqs] of groups) {
    const combo = capMap.get(comboId);
    if (!combo || combo.state === 'unlocked' || combo.state === 'active') continue;
    const hard = prereqs.filter(p => p.is_hard_requisite);
    if (
      !hard.every(p => {
        const c = capMap.get(p.from_capability);
        return c && (c.state === 'unlocked' || c.state === 'active') && usable(c.lifecycle);
      })
    )
      continue;
    const avg =
      prereqs.reduce((s, p) => {
        const c = capMap.get(p.from_capability);
        return s + (c ? c.maturity_score : 0);
      }, 0) / prereqs.length;
    if (avg < 0.4) continue;
    results.push({
      name: combo.name,
      requirements: prereqs.map(p => capMap.get(p.from_capability)?.name || p.from_capability),
      unlocks: comboId,
      // Rounded at the boundary: this is printed, and 0.8999999999999999 in a
      // report reads as a bug in the analysis rather than in the float.
      confidence: Math.round(Math.min(1, avg + 0.2) * 100) / 100,
      reason: `All prereqs at ${Math.round(avg * 100)}% avg maturity`,
    });
  }
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

// ─── Session Diff ─────────────────────────────────────────────────────────────

function sessionDiff(db: Db) {
  const caps = db
    .prepare(
      "SELECT id, name, domain, maturity_score, state FROM capabilities WHERE state IN ('unlocked','active')"
    )
    .all();
  const recent = db
    .prepare(
      'SELECT capability_id, action, outcome_score FROM session_learning ORDER BY timestamp DESC LIMIT 50'
    )
    .all();
  const capMap = new Map<string, Record<string, any>>(caps.map(c => [c.id, c]));
  const domains = new Map();
  for (const c of caps) {
    if (!domains.has(c.domain)) domains.set(c.domain, { total: 0, unlocked: 0, changed_caps: [] });
    const d = domains.get(c.domain);
    d.total++;
    if (c.state === 'unlocked' || c.state === 'active') d.unlocked++;
  }
  const seen = new Set();
  for (const e of recent) {
    if (seen.has(e.capability_id)) continue;
    seen.add(e.capability_id);
    const cap = capMap.get(e.capability_id);
    if (!cap) continue;
    const domain = domains.get(cap.domain);
    if (!domain) continue;
    domain.changed_caps.push({
      name: cap.name,
      change:
        e.outcome_score && e.outcome_score > 0.7
          ? 'improved'
          : e.action === 'regretted'
            ? 'regretted'
            : 'practiced',
      detail: `${Math.round(cap.maturity_score * 100)}% maturity`,
    });
  }
  return Array.from(domains.entries()).map(([d, v]) => ({ domain: d, ...v }));
}

export { nearMissCombos, computeDecay, discoverCombos, sessionDiff };
