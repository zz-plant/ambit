#!/usr/bin/env bun
/**
 * Consumes work-ledger observations from stdin and posts each to /api/telemetry.
 *
 * A runtime adapter — an agent wrapper, a hook, a cron — can pipe AG-UI-shaped
 * work events here instead of talking SQLite itself. The ledger's verbs are
 * the wire format, one JSON object per line:
 *
 *   {"run": {...}}                          begin a run
 *   {"end": {"runId": "...", "outcome": "success"}}
 *   {"event": {"runId": "...", "kind": "tool", "action": "bash"}}
 *   {"use": {"runId": "...", "capabilityId": "combo:observability", "durationSeconds": 90}}
 *   {"intervention": {"runId": "...", "actorId": "human:kanav", "kind": "authority", ...}}
 *   {"resource": {...}} / {"outcome": {...}}
 *
 *   echo '{"run":{"goal":"recover production service","source":"adapter"}}' \
 *     | node --experimental-strip-types scripts/adapters/telemetry.ts
 *
 * Nothing here invents data: what is not given is not recorded, and a verb it
 * does not recognise is reported rather than dropped silently.
 */

const SERVER = process.env.AMBIT_SERVER || 'http://127.0.0.1:3001';
import { createInterface } from 'node:readline';

async function post(body: any): Promise<void> {
  try {
    const res = await fetch(`${SERVER}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`telemetry ${res.status}: ${text.slice(0, 200)}`);
    }
  } catch (e: any) {
    console.error(`cannot reach ${SERVER}/api/telemetry: ${e?.message || e}`);
  }
}

const rl = createInterface({ input: process.stdin });
const inflight: Promise<void>[] = [];
let lines = 0;
rl.on('line', (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  lines++;
  let body: any;
  try {
    body = JSON.parse(trimmed);
  } catch {
    console.error(`line ${lines}: not JSON — skipped`);
    return;
  }
  const verb = ['run', 'end', 'event', 'use', 'intervention', 'resource', 'outcome'].find(
    k => body[k]
  );
  if (!verb) {
    console.error(
      `line ${lines}: no ledger verb — send one of run, end, event, use, intervention, resource, outcome`
    );
    return;
  }
  // Awaited on close: process.exit must not kill a fetch before it sends.
  inflight.push(post(body));
});

rl.on('close', async () => {
  await Promise.allSettled(inflight);
  console.log(`Posted ${inflight.length} observations to ${SERVER}/api/telemetry.`);
  process.exit(0);
});
