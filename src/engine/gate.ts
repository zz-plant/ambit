/**
 * The gate, at the moment a runtime is about to run a tool.
 *
 * Ambit's decisions were binding only where Ambit itself acts: `ambit apply`
 * and the control plane. A runtime had to choose to ask `ambit_can`, and an
 * agent that did not ask was not stopped. A Claude Code PreToolUse hook puts
 * the question on the path of every tool call: `ambit gate` reads the call the
 * hook is given, finds the capability it exercises, and answers.
 *
 * It can only narrow. Forbidden, or over a budget, is a deny. A capability
 * with no grant yet, one whose last check failed, or one that asks first is
 * put to the person. Allowed, or a tool the graph does not know, is no answer
 * at all, so the runtime's own permission settings decide as they did before:
 * the gate never answers "allow", because that would let the graph widen what
 * the person set in their runtime.
 *
 * A recovering capability, whose last check passed after a failure, is
 * decided by its grant like any other. The latest check decides, here as in
 * every plan; asking on mixed evidence would put each tool a fix brought back
 * to the person until five passes in a row had been typed by hand.
 */
import { canExecute } from './assurance.ts';
import type { Db } from './db.ts';
import { attribute } from './failures.ts';
import { PROVISION_EDGES } from './ontology.ts';

export interface ToolCall {
  tool_name?: string;
  tool_input?: unknown;
}

export interface GateAnswer {
  /** What the runtime is told; null says nothing, and its own settings decide. */
  decision: 'deny' | 'ask' | null;
  reason?: string;
  /** The capabilities the call was decided against, for the record and for a test. */
  capabilities: string[];
}

const ORDER = { null: 0, ask: 1, deny: 2 } as const;

/**
 * The capabilities a tool call exercises: the one its name attributes to, or
 * the built-in tool's own entry; and for an entry, the capabilities it
 * supplies, since grants are declared on those and not on the entry.
 */
export function capabilitiesFor(db: Db, tool: string): string[] {
  const named =
    attribute(db, tool) ??
    (db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(`tool:${tool.toLowerCase()}`)
      ? `tool:${tool.toLowerCase()}`
      : null);
  if (!named) return [];
  if (named.startsWith('combo:')) return [named];
  const kinds = (PROVISION_EDGES as string[]).map(() => '?').join(', ');
  const supplied = db
    .prepare(
      `SELECT c.id FROM dependencies d JOIN capabilities c ON c.id = d.to_capability
       WHERE d.from_capability = ? AND d.kind IN (${kinds}) AND c.kind = 'capability'`
    )
    .all<{ id: string }>(named, ...(PROVISION_EDGES as string[]))
    .map(r => r.id);
  return supplied.length ? supplied : [named];
}

/** The answer for one tool call: the narrowest of the answers for what it exercises. */
export function gateToolCall(db: Db, call: ToolCall): GateAnswer {
  const tool = typeof call.tool_name === 'string' ? call.tool_name : '';
  const capabilities = tool ? capabilitiesFor(db, tool) : [];
  let answer: GateAnswer = { decision: null, capabilities };
  for (const capability of capabilities) {
    const d = canExecute(db, { capability }) as {
      decision: string;
      reason?: string;
      refused?: string;
    };
    const decision: GateAnswer['decision'] =
      d.decision === 'ALLOW'
        ? null
        : d.decision === 'CONFIRM'
          ? 'ask'
          : d.refused === 'forbidden' || d.refused === 'budget'
            ? 'deny'
            : 'ask';
    if (
      ORDER[String(decision) as keyof typeof ORDER] >
      ORDER[String(answer.decision) as keyof typeof ORDER]
    ) {
      answer = { decision, reason: `Ambit: ${d.reason ?? ''}`.trim(), capabilities };
    }
  }
  return answer;
}

/** What a Claude Code PreToolUse hook prints: the decision, or nothing at all. */
export function claudeHookOutput(answer: GateAnswer): string {
  if (!answer.decision) return '';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: answer.decision,
      permissionDecisionReason: answer.reason,
    },
  });
}

/** The settings entry a person pastes into ~/.claude/settings.json to put the gate on every call. */
export function claudeHookSnippet(command = 'ambit gate'): string {
  return JSON.stringify(
    {
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command, timeout: 10 }] }],
      },
    },
    null,
    2
  );
}
