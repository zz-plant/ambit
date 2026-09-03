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
 * visualizer API must be running (npm run server).
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
    body: JSON.stringify({
      run: { goal: 'opencode session work', source: 'opencode-plugin', runType: 'task' },
    }),
  }).catch(() => null);
  if (!res?.ok) return null;
  try {
    runId = (await res.json()).run;
  } catch {}
  return runId;
}

/**
 * What the runtime said about a failure, in whatever shape this version of
 * OpenCode reports it.
 *
 * Ambit classifies; this only gathers. A bridge that decides for itself what
 * counts as a permission error is a second copy of that rule, and the two will
 * disagree within a release. See src/engine/failures.ts and docs/roadmap.md
 * §12.2.
 */
function failureFrom(input) {
  const out = input?.output ?? input?.result ?? input;
  const exitCode = out?.exitCode ?? out?.exit_code ?? out?.code;
  const message =
    out?.stderr ||
    out?.error?.message ||
    (typeof out?.error === 'string' ? out.error : '') ||
    (out?.isError ? String(out?.content?.[0]?.text ?? '') : '') ||
    '';
  const failed =
    out?.isError === true ||
    (typeof exitCode === 'number' && exitCode !== 0) ||
    Boolean(out?.error);
  if (!failed) return null;
  return {
    tool: input?.tool || input?.name || 'unknown',
    exitCode: typeof exitCode === 'number' ? exitCode : undefined,
    message: String(message).slice(0, 500),
    errorKind: out?.error?.kind || out?.errorKind || undefined,
    source: 'opencode',
  };
}

export const AmbitTelemetry = async _ctx => {
  return {
    // The tool ran. Recorded as a work event under the process run — the
    // observation "this session exercised a tool" is the base of the ledger,
    // and the economic loop's frequency counts come from it.
    'tool.execute.after': async input => {
      const id = await ensureRun();
      if (!id) return;
      await post({
        event: { runId: id, kind: 'tool', action: input?.tool || 'unknown', actor: 'agent' },
      });
      // The ledger's other half: what did not work. Recording a deficit used
      // to require someone to stop mid-failure and run a command, which is the
      // worst moment to ask, so nobody ever did and every report that reads
      // deficits opened by saying nothing had been observed.
      const failure = failureFrom(input);
      if (failure) await post({ failure });
    },
    // Present in some versions and not others; both paths reach the same
    // recorder, and a duplicate is deduplicated by nothing — an error reported
    // twice is two observations, which is honest about how it was reported.
    'tool.execute.error': async input => {
      const failure = failureFrom(input) || {
        tool: input?.tool || 'unknown',
        message: String(input?.error?.message || input?.error || '').slice(0, 500),
        source: 'opencode',
      };
      await post({ failure });
    },
    // A permission prompt is human agency of the authority kind. The reply is
    // not observable through a hook yet, so this records the ask only.
    'permission.asked': async input => {
      const id = await ensureRun();
      if (!id) return;
      await post({
        intervention: {
          runId: id,
          actorId: process.env.AMBIT_ACTOR || 'human:operator',
          kind: 'authority',
          action: input?.permission || input?.action || undefined,
          outcome: 'asked',
        },
      });
    },
  };
};

export const TechTreeTelemetry = AmbitTelemetry;
