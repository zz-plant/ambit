import { readFileSync, existsSync } from 'node:fs';
import type { Db } from './db.ts';
import { beginRun, addEvent, endRun } from './telemetry.ts';
import { canExecute, deriveLifecycles, evaluatePromotions, usable } from './assurance.ts';
import { recordDelegationState } from './delegation.ts';
import { infraManifestPath } from './paths.ts';
import { storedTags } from './seed/structure.ts';
import { CHECK_RUN } from './vocabulary.ts';

/**
 * The incident loop: when a declared service stops answering, a work run opens,
 * the detection is recorded, and the recovery is checked against authority —
 * before anyone is asked to act.
 *
 * This is the managed-ops vertical's first turn: monitoring finds a failure,
 * the ledger starts an incident run, canExecute says whether a restart is
 * permitted (ALLOW / CONFIRM / DENY), and the operator or an agent resolves it
 * with `ambit incident resolve` — which closes the run and reports MTTR from
 * the ledger's own timestamps.
 *
 * Each probe is also a check on the device or service it asked. The manifest
 * names the target, the probe is one GET that changes nothing, and it runs
 * only when a person types `ambit incidents` or an agent calls the tool: the
 * three things that make a declared check a check. So it is recorded as one,
 * and a service that stops answering reads `broken` and drops out of every
 * availability decision until it answers again, with no rule of its own.
 *
 *   ambit incidents               probe the manifest; open runs for offline services
 *   ambit incident resolve svc:ollama recovered
 */

/** The recovery capability the manifest's services are checked against. A
 *  service is not restarted because a scan says so; it is restarted because a
 *  grant covers restarting it. */
const RECOVERY_CAPABILITY = 'combo:shell-execution';
const ACTION = 'execute';

function manifest(path: string): any | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** One address the manifest gives a device or a service, under its graph id. */
interface Target {
  id: string;
  name: string;
  kind: 'device' | 'service';
  url: string;
  /** The machine the manifest says a service runs on. */
  host?: string;
}

/**
 * Every address the manifest names: a device's `statusUrl` and a service's
 * `url`, the same two the server's scan reads. Nothing else is asked.
 */
function targetsOf(m: any): Target[] {
  const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  return [
    ...list(m.devices)
      .filter(d => d?.id && typeof d.statusUrl === 'string' && d.statusUrl)
      .map(d => ({
        id: `device:${d.id}`,
        name: String(d.name || d.id),
        kind: 'device' as const,
        url: d.statusUrl,
      })),
    ...list(m.services)
      .filter(s => s?.key && typeof s.url === 'string' && s.url)
      .map(s => ({
        id: `svc:${s.key}`,
        name: String(s.label || s.key),
        kind: 'service' as const,
        url: s.url,
        host: s.host ? `device:${s.host}` : undefined,
      })),
  ];
}

/**
 * What one probe found. `answered` is whether anything replied at the
 * address, whatever it said, which is what makes a machine seen. `ok` is
 * whether the reply was a 2xx, which is what passes the check.
 */
interface Answer {
  answered: boolean;
  ok: boolean;
  status?: number;
}

async function probe(url: string, timeoutMs = 3000): Promise<Answer> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    // Nothing reads the body, and cancelling it lets the connection close.
    await res.body?.cancel().catch(() => {});
    return { answered: true, ok: res.ok, status: res.status };
  } catch {
    return { answered: false, ok: false };
  }
}

/**
 * Writes what a probe found as a check run on the node the manifest names.
 *
 * The row is the one `ambit verify` writes, so the lifecycle, reliability,
 * evidence history and the map read it with no special case. An answer of
 * any kind marks the node seen, and the machine a service runs on with it,
 * since the reply came from that machine. A probe that got no answer leaves
 * both times as they were. A node the graph has not seeded cannot carry
 * evidence, and the foreign key would refuse the row, so it is left out.
 */
function recordProbe(db: Db, target: Target, answer: Answer): boolean {
  if (!db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(target.id)) return false;
  db.prepare(
    "INSERT INTO session_learning (session_id, capability_id, action, outcome_score, notes) VALUES ('verify', ?, ?, ?, ?)"
  ).run(
    target.id,
    answer.ok ? CHECK_RUN.passed : CHECK_RUN.failed,
    answer.ok ? 1 : 0,
    answer.ok ? null : answer.answered ? `probe answered ${answer.status}` : 'probe got no answer'
  );
  if (answer.answered) {
    const seen = db.prepare("UPDATE capabilities SET last_seen_at = datetime('now') WHERE id = ?");
    seen.run(target.id);
    if (target.host) seen.run(target.host);
  }
  return true;
}

/**
 * Probes the manifest, records each answer as a check run on what it asked,
 * and opens an incident run for every service that is offline, recording the
 * detection and the authority decision for its recovery.
 */
async function incidents(db: Db) {
  // Read before the first await: the path comes from the environment, which
  // is the caller's to change once this has started.
  const path = infraManifestPath();
  const m = manifest(path);
  if (!m) {
    return { note: `No infrastructure manifest at ${path}. Nothing to watch.` };
  }
  const targets = targetsOf(m);
  if (targets.length === 0) {
    return { note: 'The manifest declares no device or service with a status URL to probe.' };
  }

  const answers = await Promise.all(targets.map(t => probe(t.url)));

  const recorded = targets.map((t, i) => recordProbe(db, t, answers[i]));
  // The evidence changed, so what it is worth and what it earns changed with
  // it, as after `ambit verify`: the lifecycles first, then the grants that
  // widen or narrow on them, then the record of any that rest on one failing.
  let authority: ReturnType<typeof evaluatePromotions> | undefined;
  let delegation: ReturnType<typeof recordDelegationState> | undefined;
  if (recorded.some(Boolean)) {
    deriveLifecycles(db);
    authority = evaluatePromotions(db);
    delegation = recordDelegationState(db);
  }

  const results = [];
  for (const [i, target] of targets.entries()) {
    const answer = answers[i];
    if (target.kind !== 'service' || answer.ok) continue;
    const id = target.id;

    // A new incident run, one per service; a resolved one leaves a fresh slot.
    // The goal carries the service id, so resolve can match on it reliably.
    const run = beginRun(db, { goal: `recover ${id}`, runType: 'incident', source: 'scan' });
    addEvent(db, run.run, {
      kind: 'detected',
      actor: 'monitoring',
      capabilityId: id,
      detail: answer.answered
        ? `${target.url} answered ${answer.status}`
        : `${target.url} unreachable`,
    });

    // The recovery decision, resolved exactly as apply would resolve it.
    const decision = canExecute(db, {
      actor: undefined,
      capability: RECOVERY_CAPABILITY,
      action: ACTION,
      target: id,
    });
    addEvent(db, run.run, {
      kind: 'authority',
      actor: 'ambit',
      capabilityId: id,
      action: 'restart',
      detail: `recovery decision: ${decision.decision} — ${decision.reason}`,
    });

    results.push({
      service: id,
      run: run.run,
      status: 'down',
      detected_at: run.started_at,
      recovery: {
        action: `restart ${id}`,
        decision: decision.decision,
        reason: decision.reason,
        grant: decision.governing_grant?.scope || undefined,
        target: decision.scope || undefined,
      },
      resolve_with: `ambit incident resolve ${id} recovered`,
    });
  }

  // What each probe found and what the graph now holds for it. Read after the
  // writes, so the time and the lifecycle are the ones this run left.
  const stored = db.prepare('SELECT lifecycle, last_seen_at, tags FROM capabilities WHERE id = ?');
  const probes = targets.map((t, i) => {
    const row = recorded[i]
      ? stored.get<{ lifecycle: string; last_seen_at: string | null; tags: string | null }>(t.id)
      : undefined;
    return {
      name: t.name,
      id: t.id,
      kind: t.kind,
      answered: answers[i].answered,
      check: answers[i].ok ? 'passed' : 'failed',
      lifecycle: row?.lifecycle,
      last_seen: row?.last_seen_at ?? undefined,
      tags: storedTags(row?.tags),
    };
  });
  const unavailable = probes.filter(p => p.lifecycle && !usable(p.lifecycle));
  const unseeded = probes.filter((_, i) => !recorded[i]).map(p => p.id);

  return {
    probed: targets.length,
    online: answers.filter(a => a.ok).length,
    probes,
    incidents: results,
    now_unavailable: unavailable.length
      ? unavailable.map(p => ({ id: p.id, name: p.name, lifecycle: p.lifecycle }))
      : undefined,
    gate: unavailable.length
      ? 'these are failing their probe, so plans, simulations and authority leave them out until it passes again. ambit incidents probes again.'
      : undefined,
    narrowed: delegation?.narrowed.length ? delegation.narrowed : undefined,
    authority_changed:
      authority && (authority.promoted.length || authority.demoted.length) ? authority : undefined,
    not_in_graph: unseeded.length ? unseeded : undefined,
    note: [
      results.length
        ? 'incident runs are open and recorded; recovery is checked against authority before anyone acts'
        : answers.every(a => a.ok)
          ? 'everything the manifest names is answering'
          : 'every declared service is answering, and a device is not',
      unseeded.length
        ? 'what the graph has not seeded carries no evidence yet, and ambit seed reads the manifest into it'
        : undefined,
    ]
      .filter(Boolean)
      .join('. '),
  };
}

/**
 * Closes the open incident run for a service, with the outcome.
 *
 * MTTR falls out of the ledger: elapsed = ended_at − started_at, from the
 * run's own timestamps.
 */
function resolveIncident(db: Db, serviceId?: string, outcome?: string) {
  if (!serviceId) return { error: 'Usage: ambit incident resolve <svc:key> <outcome>' };
  const id = serviceId.startsWith('svc:') ? serviceId : `svc:${serviceId}`;

  const open = db
    .prepare(
      "SELECT * FROM work_runs WHERE run_type = 'incident' AND outcome IS NULL AND goal LIKE ? ORDER BY started_at DESC LIMIT 1"
    )
    .get(`%${id}%`);
  if (!open) return { error: `No open incident run for ${id}. Run ambit incidents to open one.` };

  const ended = endRun(db, open.id, outcome || 'resolved');
  const elapsed = (() => {
    const s = new Date(open.started_at.replace(' ', 'T') + 'Z').getTime();
    const e = new Date((ended as any).ended_at.replace(' ', 'T') + 'Z').getTime();
    return Math.max(0, Math.round((e - s) / 1000));
  })();

  return {
    run: open.id,
    service: id,
    outcome: outcome || 'resolved',
    mttr_seconds: elapsed,
    note: 'MTTR is the ledger’s own elapsed time, not a guess.',
  };
}

export { incidents, resolveIncident, RECOVERY_CAPABILITY };
