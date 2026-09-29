import type { RunAsk, RunEvent, RunResponse, RunUse, RunView } from '../../shared/api';

/**
 * The hosted demo's runs.
 *
 * Hand-written, like the rest of the loop page's sample, because a run is what
 * a real session records and there is no session here to record it. The first
 * shows every case the page has to draw: a permission ask with both its times,
 * one the plugin logged and could not see the reply to, a timed ask of another
 * kind, and one with a figure and no end. The second was never asked anything.
 * Dated from the moment the page is opened, so the sample never reads as old.
 */

const MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString();

/** A run that began three hours ago and lasted fourteen minutes, its marks placed by minute. */
function invoiceRun(now: number): RunView {
  const start = now - 190 * MIN;
  const at = (min: number) => iso(start + min * MIN);

  const uses: RunUse[] = [
    {
      capability: 'Shell Execution',
      capability_id: 'combo:shell-execution',
      at: at(0.5),
      seconds: 240,
    },
    {
      capability: 'Version Control',
      capability_id: 'combo:version-control',
      at: at(5),
      seconds: 45,
    },
    {
      capability: 'Hosted Inference',
      capability_id: 'combo:hosted-inference',
      at: at(7),
      seconds: 310,
    },
    {
      capability: 'Shell Execution',
      capability_id: 'combo:shell-execution',
      at: at(12.5),
      seconds: null,
    },
  ];

  const tools = ['bash', 'read', 'edit', 'grep', 'bash', 'read'];
  const events: RunEvent[] = Array.from({ length: 18 }, (_, i) => ({
    at: at(0.3 + i * 0.75),
    kind: 'tool',
    action: tools[i % tools.length],
    actor: 'agent',
  }));

  const asks: RunAsk[] = [
    {
      kind: 'authority',
      actor: 'human:you',
      at: at(4.2),
      ended_at: at(6.4),
      seconds: 130,
      gate: true,
      capability: 'Continuous Delivery',
      action: 'deploy_staging',
    },
    {
      // The plugin logged the prompt and could not see the reply.
      kind: 'authority',
      actor: 'human:you',
      at: at(9.5),
      ended_at: null,
      seconds: null,
      gate: true,
      capability: 'Secret Management',
      action: 'read_secret',
      outcome: 'asked',
    },
    {
      kind: 'judgment',
      actor: 'human:you',
      at: at(11),
      ended_at: at(11.75),
      seconds: 45,
      gate: false,
      capability: 'Code Intelligence',
      action: 'review',
    },
    {
      kind: 'approval',
      actor: 'human:you',
      at: at(12.6),
      ended_at: null,
      seconds: 20,
      gate: true,
      capability: 'Version Control',
      action: 'merge_to_default',
    },
  ];

  // Three asks carry a figure and one does not, and the total is only the three.
  const timed = asks.filter(a => a.seconds !== null);
  return {
    id: 'run-invoices',
    goal: 'Retrieve the day’s invoices',
    started_at: iso(start),
    ended_at: at(14),
    outcome: 'success',
    uses,
    uses_total: uses.length,
    events,
    events_total: events.length,
    asks,
    asks_total: asks.length,
    human: {
      seconds: timed.reduce((s, a) => s + (a.seconds ?? 0), 0),
      timed: timed.length,
      untimed: asks.length - timed.length,
    },
  };
}

/** A run nobody was asked anything in. */
function quietRun(now: number): RunView {
  const start = now - 60 * MIN;
  const uses: RunUse[] = [
    {
      capability: 'Version Control',
      capability_id: 'combo:version-control',
      at: iso(start + MIN),
      seconds: 95,
    },
  ];
  const events: RunEvent[] = [0.5, 2, 3.5, 5].map(m => ({
    at: iso(start + m * MIN),
    kind: 'tool',
    action: 'bash',
    actor: 'agent',
  }));
  return {
    id: 'run-deps',
    goal: 'Update dependencies',
    started_at: iso(start),
    ended_at: iso(start + 6 * MIN),
    outcome: 'success',
    uses,
    uses_total: uses.length,
    events,
    events_total: events.length,
    asks: [],
    asks_total: 0,
    human: { seconds: 0, timed: 0, untimed: 0 },
  };
}

/** The demo's answer to `/api/run`: the newest that recorded an ask, or the one picked. */
export function demoRun(id?: string, now = Date.now()): RunResponse {
  const runs = [quietRun(now), invoiceRun(now)];
  const recent = runs.map(r => ({
    id: r.id,
    goal: r.goal,
    started_at: r.started_at,
    ended_at: r.ended_at,
    asks: r.asks_total,
    events: r.events_total,
  }));
  const run = id ? runs.find(r => r.id === id) : runs.find(r => r.asks_total > 0);
  return { recent, run: run ?? null };
}
