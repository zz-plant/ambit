/**
 * What a runtime-wide authority grant covers.
 *
 * A runtime's own approval setting (Claude Code's permissions.defaultMode,
 * Hermes's approvals.mode) is stored once, against the runtime node, and
 * applies to everything that runtime contributes: each capability its
 * providers supply, and one hop further, each action those capabilities
 * confer. It is resolved at read time, not copied onto every capability at
 * seed, where a later contribution would silently miss it.
 *
 * The report and the gate both read it from here. The gate used to read only
 * the grants stored against the capability itself, so `ambit authority` said
 * a runtime narrowed an action to confirm while `ambit can` allowed it
 * unattended: the enforcement surface was the looser of the two.
 */
import type { Db } from '../db.ts';

/** runtime id → every capability and action its grants reach. */
export function runtimeReach(db: Db): Map<string, Set<string>> {
  const reach = new Map<string, Set<string>>();
  for (const r of db
    .prepare(
      `SELECT rt.from_capability runtime, p.to_capability capability
     FROM dependencies rt JOIN dependencies p ON p.from_capability = rt.to_capability
     WHERE rt.kind = 'contributes' AND p.kind = 'provides'`
    )
    .all<{ runtime: string; capability: string }>()) {
    if (!reach.has(r.runtime)) reach.set(r.runtime, new Set());
    reach.get(r.runtime)!.add(r.capability);
  }
  // A runtime that asks before everything it executes asks before each
  // action too, or the finer vocabulary would quietly be the freer one.
  const conferred = new Map<string, string[]>();
  for (const r of db
    .prepare(
      `SELECT d.from_capability capability, d.to_capability action
     FROM dependencies d JOIN capabilities c ON c.id = d.to_capability
     WHERE d.kind = 'provides' AND c.kind = 'action'`
    )
    .all<{ capability: string; action: string }>()) {
    if (!conferred.has(r.capability)) conferred.set(r.capability, []);
    conferred.get(r.capability)!.push(r.action);
  }
  for (const covered of reach.values()) {
    for (const capId of [...covered])
      for (const actionId of conferred.get(capId) || []) covered.add(actionId);
  }
  return reach;
}

/** The runtimes whose grants reach this capability or action. */
export function runtimesReaching(db: Db, id: string): string[] {
  return [...runtimeReach(db)].filter(([, covered]) => covered.has(id)).map(([rt]) => rt);
}
