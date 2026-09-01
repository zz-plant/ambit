import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.ts';
import { beginRun, addEvent, endRun } from './telemetry.ts';
import { canExecute } from './assurance.ts';

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
 *   ambit incidents               probe the manifest; open runs for offline services
 *   ambit incident resolve svc:ollama recovered
 */

const MANIFEST_DEFAULT = join(
  process.env.HOME || '/',
  '.config',
  'opencode',
  'infrastructure.json'
);
/** The recovery capability the manifest's services are checked against. A
 *  service is not restarted because a scan says so; it is restarted because a
 *  grant covers restarting it. */
const RECOVERY_CAPABILITY = 'combo:shell-execution';
const ACTION = 'execute';

function manifest(): any | null {
  const path = process.env.INFRA_MANIFEST || MANIFEST_DEFAULT;
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

async function probe(url: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Probes the manifest and opens an incident run for every service that is
 * offline, recording the detection and the authority decision for its recovery.
 */
async function incidents(db: Db) {
  const m = manifest();
  if (!m) {
    return {
      note: `No infrastructure manifest at ${process.env.INFRA_MANIFEST || MANIFEST_DEFAULT}. Nothing to watch.`,
    };
  }
  const services = (m.services || []).filter((s: any) => s.url);
  if (services.length === 0) {
    return { note: 'The manifest declares no service with a status URL to probe.' };
  }

  const results = [];
  for (const spec of services) {
    const id = `svc:${spec.key}`;
    const up = await probe(spec.url);
    results.push({ service: id, label: spec.label || spec.key, online: up });
    if (up) continue;

    // A new incident run, one per service; a resolved one leaves a fresh slot.
    // The goal carries the service id, so resolve can match on it reliably.
    const run = beginRun(db, { goal: `recover ${id}`, runType: 'incident', source: 'scan' });
    addEvent(db, run.run, {
      kind: 'detected',
      actor: 'monitoring',
      capabilityId: id,
      detail: `${spec.url} unreachable`,
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

  const down = results.filter((r: any) => r.status === 'down');
  return {
    probed: services.length,
    online: results.filter((r: any) => r.online).length,
    incidents: down,
    note: down.length
      ? 'incident runs are open and recorded; recovery is checked against authority before anyone acts'
      : 'all declared services are answering',
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
    note: 'MTTR is the ledger\u2019s own elapsed time, not a guess.',
  };
}

export { incidents, resolveIncident };
