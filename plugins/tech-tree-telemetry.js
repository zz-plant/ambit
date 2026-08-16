/**
 * The work-telemetry bridge: records what an OpenCode session actually does
 * into Ambit's work ledger, through /api/telemetry.
 *
 * OpenCode's plugin API does not expose a session id on tool events, so this
 * keeps one run per plugin process (per opencode instance) and records every
 * tool execution into it. Session-grained runs arrive once the runtime
 * publishes session boundaries; this is the first, coarse turn of the loop.
 *
 * Install: copy to ~/.config/opencode/plugins/ and restart opencode. The
 * visualizer API must be running (bun run server).
 *
 * Everything is wrapped: a dead server, a changed payload, or an unknown
 * event must never take a session down.
 */

const SERVER = process.env.AMBIT_SERVER || 'http://127.0.0.1:3001';
let runId = null;

async function post(body) {
  try {
    await fetch(`${SERVER}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {}
}

/** One run per process, opened lazily so a session that never uses a tool
 *  records nothing. */
async function ensureRun() {
  if (runId) return runId;
  const res = await fetch(`${SERVER}/api/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run: { goal: 'opencode session work', source: 'opencode-plugin', runType: 'task' } }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  try {
    runId = (await res.json()).run;
  } catch {}
  return runId;
}

export const TechTreeTelemetry = async (ctx) => {
  return {
    // The tool ran. Recorded as a work event under the process run — the
    // observation "this session exercised a tool" is the base of the ledger,
    // and the economic loop's frequency counts come from it.
    'tool.execute.after': async (input) => {
      const id = await ensureRun();
      if (!id) return;
      await post({ event: { runId: id, kind: 'tool', action: input?.tool || 'unknown', actor: 'agent' } });
    },
    // A permission prompt is human agency of the authority kind. The reply is
    // not observable through a hook yet, so this records the ask only.
    'permission.asked': async (input) => {
      const id = await ensureRun();
      if (!id) return;
      await post({
        intervention: {
          runId: id,
          actorId: 'human:kanav',
          kind: 'authority',
          action: input?.permission || input?.action || undefined,
          outcome: 'asked',
        },
      });
    },
  };
};