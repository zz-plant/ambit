/**
 * Runtime approval settings, translated into the three modes Ambit records.
 *
 * Both adapters already read authority as the runtime states it — Hermes
 * publishes `approvals.mode` and `approvals.cron_mode`, Claude Code publishes
 * `permissions.defaultMode` — and both only printed it. This is the translation
 * that lets it reach the graph, where it can narrow what the curated model says
 * an action is like in general.
 *
 * Unrecognised settings become `confirm` rather than `autonomous`. Guessing
 * wrong in the permissive direction would describe a system as freer to act
 * than the runtime in front of it actually permits, which is the one error
 * worth ruling out by construction.
 */
export type Mode = 'autonomous' | 'confirm' | 'forbidden';

const AUTONOMOUS = /^(auto|yolo|never|allow|bypass|bypasspermissions|dontask|accept.*all)$/i;
const FORBIDDEN = /^(deny|denied|forbid|forbidden|block|blocked|off|plan)$/i;

export function approvalMode(setting: unknown): Mode | null {
  if (setting === null || setting === undefined || setting === '') return null;
  const value = String(setting).trim();
  if (AUTONOMOUS.test(value)) return 'autonomous';
  if (FORBIDDEN.test(value)) return 'forbidden';
  return 'confirm';
}

/**
 * The `authority` block the engine seeds from, or undefined when the runtime
 * said nothing. An absent block is not the same claim as an unrestricted one.
 */
export function authorityBlock(opts: {
  execute?: unknown;
  scheduled?: unknown;
  note?: string;
  scheduledNote?: string;
}): Record<string, unknown> | undefined {
  const execute = approvalMode(opts.execute);
  const scheduled = approvalMode(opts.scheduled);
  if (!execute && !scheduled) return undefined;

  const block: Record<string, any> = {};
  if (execute) block.runtime = { execute, note: opts.note };
  if (scheduled) {
    block.scoped = { execute: { mode: scheduled, scope: 'scheduled', note: opts.scheduledNote } };
  }
  return block;
}
