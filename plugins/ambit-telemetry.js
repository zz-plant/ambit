/**
 * The work-telemetry bridge: records what an OpenCode session actually does
 * into Ambit's work ledger, through /api/telemetry.
 *
 * One file for both major versions of OpenCode, in the shape OpenCode's own
 * plugin guide gives for it: the default export carries `id` and `setup`,
 * which OpenCode 2 reads, and `server`, which OpenCode 1 calls. V2 ignores
 * `server` and V1 ignores the rest, so each version runs one implementation.
 *
 * OpenCode 1's tool events carry no session id, so under V1 this keeps one run
 * per plugin process and records every tool execution into it. OpenCode 2
 * names the session on every tool call, so under V2 a run is a session. V2 also
 * reports how a person answered a permission prompt, which V1 never did, so
 * the intervention it records has an outcome and a length.
 *
 * A call that worked is also a use, posted with the tool's name: which
 * capabilities that is, the engine decides. Under both versions the use says
 * how long the call ran when this saw it begin and nobody was asked for
 * permission while it ran (`callClock` below), and says nothing about it
 * otherwise.
 *
 * Install: copy to ~/.config/opencode/plugins/ and restart opencode. The
 * visualizer API must be running (npm run server), as the same user, so the
 * token it writes is the one this reads.
 *
 * Everything is wrapped: a dead server, a changed payload, or an unknown
 * event must never take a session down.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVER = process.env.AMBIT_SERVER || 'http://127.0.0.1:3001';
let runId = null;

/**
 * The API token, found as `readApiToken` in src/server/config.ts finds it:
 * AMBIT_API_TOKEN, else the file the API server makes when it starts. This
 * file runs in OpenCode's process and cannot import the server, so it
 * transcribes; keep the two in step. Read on every post, so a server started
 * after the session, or a token made anew, is picked up without a restart.
 */
function apiToken() {
  if (process.env.AMBIT_API_TOKEN) return process.env.AMBIT_API_TOKEN;
  try {
    const file = join(process.env.HOME || '/', '.config', 'opencode', 'ambit-api.token');
    return readFileSync(file, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

/** One observation to /api/telemetry, which refuses a post without the token. */
function send(body) {
  const token = apiToken();
  return fetch(`${SERVER}/api/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Ambit-Token': token } : {}) },
    body: JSON.stringify(body),
  });
}

async function post(body) {
  try {
    await send(body);
  } catch {}
}

/** SQLite's `datetime('now')` shape, so a time sent from here sorts with the rest. */
const sqlTime = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** A tool call's id: `callID` under OpenCode 1, the call's own `id` under OpenCode 2. */
const callOf = input => input?.callID ?? input?.id;

/**
 * When each tool call began, by its call id, so the use it ends in can say how
 * long it ran.
 *
 * OpenCode runs the before hook ahead of the tool, and a tool that needs a
 * person's permission asks for it while it runs, so a call someone was asked
 * about would count their wait as its run time. Such a call gets no length:
 * the part that was the tool's cannot be told from the part that was the
 * person's. A permission that names its call marks that call; one that does
 * not marks every call open in its session, or every open call when it names
 * no session, since a parallel call that loses a figure is the cheaper
 * mistake. A call whose start was not seen has no length, never a zero.
 */
function callClock() {
  const open = new Map();
  return {
    start(callID, sessionID) {
      if (!callID) return;
      // A call whose end never came is forgotten, oldest first.
      if (open.size >= 500) open.delete(open.keys().next().value);
      open.set(callID, { at: Date.now(), sessionID, asked: false });
    },
    asked(sessionID, callID) {
      for (const [id, call] of open) {
        if (
          callID ? id === callID : !sessionID || !call.sessionID || call.sessionID === sessionID
        ) {
          call.asked = true;
        }
      }
    },
    /** When the call began and how long it ran, or nothing when that cannot be said. */
    stop(callID) {
      const call = callID ? open.get(callID) : undefined;
      open.delete(callID);
      if (!call || call.asked) return {};
      return { at: sqlTime(call.at), durationSeconds: (Date.now() - call.at) / 1000 };
    },
  };
}

/** One run per process, opened lazily so a session that never uses a tool
 *  records nothing. */
async function ensureRun() {
  if (runId) return runId;
  const res = await send({
    run: { goal: 'opencode session work', source: 'opencode-plugin', runType: 'task' },
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
  const clock = callClock();
  return {
    // Only the time: the tool waits on this hook, so it does nothing else.
    'tool.execute.before': async input => {
      clock.start(callOf(input), input?.sessionID);
    },
    // The tool ran. Recorded as a work event under the process run — the
    // observation "this session exercised a tool" is the base of the ledger,
    // and the economic loop's frequency counts come from it.
    'tool.execute.after': async input => {
      // Read first, so the length is the tool's and not the time to post it.
      const timing = clock.stop(callOf(input));
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
      else if (input?.tool) {
        await post({ use: { runId: id, tool: input.tool, source: 'opencode', ...timing } });
      }
    },
    // Present in some versions and not others; both paths reach the same
    // recorder, and a duplicate is deduplicated by nothing — an error reported
    // twice is two observations, which is honest about how it was reported.
    'tool.execute.error': async input => {
      clock.stop(callOf(input));
      const failure = failureFrom(input) || {
        tool: input?.tool || 'unknown',
        message: String(input?.error?.message || input?.error || '').slice(0, 500),
        source: 'opencode',
      };
      await post({ failure });
    },
    // OpenCode 1 calls this when a tool needs a person's permission, before
    // the prompt shows. It only marks the call as waiting on a person.
    'permission.ask': async input => {
      clock.asked(input?.sessionID, input?.callID);
    },
    // A permission prompt is human agency of the authority kind. The reply is
    // not observable through a hook yet, so this records the ask only.
    'permission.asked': async input => {
      clock.asked(input?.sessionID, input?.callID);
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

// ─── OpenCode 2 ───────────────────────────────────────────────────────────────

/** One run per OpenCode session, opened on the session's first tool call. */
const sessionRuns = new Map();

function runFor(sessionID) {
  if (!sessionID) return ensureRun();
  if (!sessionRuns.has(sessionID)) {
    const opened = send({
      run: { goal: 'opencode session work', source: 'opencode-plugin', runType: 'task' },
    })
      .then(res => (res.ok ? res.json() : null))
      .then(body => body?.run ?? null)
      .catch(() => null)
      .then(id => {
        // A server that was down is asked again on the next call, not never.
        if (!id) sessionRuns.delete(sessionID);
        return id;
      });
    sessionRuns.set(sessionID, opened);
  }
  return sessionRuns.get(sessionID);
}

/**
 * What OpenCode 2 said about a failed tool call. A call that errored carries a
 * `Tool.Error`; one that completed can still have run a command that exited
 * non-zero, which the tool reports in its result's metadata. As in V1, this
 * gathers and src/engine/failures.ts classifies.
 */
function failureFromV2(event) {
  if (event?.status === 'error') {
    const meta = event.error?.metadata;
    const exitCode = meta?.exitCode ?? meta?.exit_code ?? meta?.exit;
    return {
      tool: event.tool || 'unknown',
      exitCode: typeof exitCode === 'number' ? exitCode : undefined,
      message: String(event.error?.message ?? '').slice(0, 500),
      source: 'opencode',
    };
  }
  const meta = event?.result?.metadata;
  const exitCode = meta?.exitCode ?? meta?.exit_code ?? meta?.exit;
  if (typeof exitCode !== 'number' || exitCode === 0) return null;
  const content = event.result?.content;
  return {
    tool: event.tool || 'unknown',
    exitCode,
    message: String(
      meta?.stderr || (typeof content === 'string' ? content : content?.[0]?.text) || ''
    ).slice(0, 500),
    source: 'opencode',
  };
}

/** How a person answered, in the ledger's words. OpenCode says once, always or reject. */
const REPLY_OUTCOME = { once: 'approved', always: 'approved always', reject: 'rejected' };

async function setup(ctx) {
  const clock = callClock();
  // Nothing here may be awaited by the tool it observes: a slow or dead
  // server would otherwise add its timeout to every tool call.
  await ctx.tool.hook('execute.after', event => {
    const timing = clock.stop(callOf(event));
    void (async () => {
      const id = await runFor(event?.sessionID);
      if (!id) return;
      await post({
        event: { runId: id, kind: 'tool', action: event?.tool || 'unknown', actor: 'agent' },
      });
      const failure = failureFromV2(event);
      if (failure) await post({ failure });
      else if (event?.tool) {
        await post({ use: { runId: id, tool: event.tool, source: 'opencode', ...timing } });
      }
    })().catch(() => {});
  });
  // The start of each call, for its length. Where this hook is not offered,
  // every use is posted with no length, which is what was seen.
  try {
    await ctx.tool.hook('execute.before', event => {
      clock.start(callOf(event), event?.sessionID);
    });
  } catch {}

  // A prompt is recorded when it is answered, so the record says what the
  // person decided and how long the agent waited for it. A prompt that is
  // never answered was never a decision, and is not recorded as one.
  const asked = new Map();
  const controller = new AbortController();
  void (async () => {
    for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
      const data = event?.data;
      if (event?.type === 'permission.asked') {
        clock.asked(data?.sessionID, data?.tool?.callID ?? data?.callID);
      }
      if (event?.type === 'permission.asked' && data?.id) {
        asked.set(data.id, { at: Date.now(), action: data.action, sessionID: data.sessionID });
      } else if (event?.type === 'permission.replied' && data?.requestID) {
        const ask = asked.get(data.requestID);
        asked.delete(data.requestID);
        if (!ask) continue;
        const id = await runFor(ask.sessionID || data.sessionID);
        if (!id) continue;
        await post({
          intervention: {
            runId: id,
            actorId: process.env.AMBIT_ACTOR || 'human:operator',
            kind: 'authority',
            action: ask.action || undefined,
            startedAt: sqlTime(ask.at),
            endedAt: sqlTime(Date.now()),
            outcome: REPLY_OUTCOME[data.reply] || data.reply || undefined,
          },
        });
      }
    }
  })().catch(() => {});

  return () => controller.abort();
}

export default { id: 'ambit-telemetry', setup, server: AmbitTelemetry };
