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
 *
 * A runtime's own tool is asked about as the action it is (tool-names.ts): a
 * read as `observe`, which the tree lets run unasked, so `Read` and `Grep` are
 * no answer while `Write` is asked about as `Edit` is. A shell call is also
 * asked about as each program its command runs, so a grant on Version Control
 * reaches `git push` and not only the git server. The command is read here and
 * kept nowhere.
 */
import { canExecute } from './assurance.ts';
import type { Db } from './db.ts';
import { attribute } from './failures.ts';
import { PROVISION_EDGES } from './ontology.ts';
import { resolveCapability } from './resolve.ts';
import { type Act, builtInTool, commandExercises } from './tool-names.ts';
import { claudeRuleFor, gateHookEntry } from './wiring.ts';

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
 * The capabilities a tool call exercises: the one its name attributes to, and
 * for an entry, the capabilities it supplies, since grants are declared on
 * those and not on the entry.
 */
export function capabilitiesFor(db: Db, tool: string): string[] {
  const named = attribute(db, tool);
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

/**
 * What the gate asks about one call: each capability it exercises, with the
 * action asked for. A tool the runtime does not own is asked about as
 * `execute`, and one whose work arrives as calls of their own not at all.
 */
function questionsFor(db: Db, call: ToolCall): Array<{ capability: string; action: Act }> {
  const tool = typeof call.tool_name === 'string' ? call.tool_name : '';
  if (!tool) return [];
  const own = builtInTool(tool);
  const action = own ? own.act : 'execute';
  const asked = action ? capabilitiesFor(db, tool).map(capability => ({ capability, action })) : [];
  const command = (call.tool_input as { command?: unknown } | null | undefined)?.command;
  if (own?.means === 'tool:bash' && typeof command === 'string') {
    const exists = db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?');
    for (const e of commandExercises(command)) {
      if (exists.get(e.means)) asked.push({ capability: e.means, action: e.act });
    }
  }
  return asked;
}

/** The answer for one tool call: the narrowest of the answers for what it exercises. */
export function gateToolCall(db: Db, call: ToolCall): GateAnswer {
  const questions = questionsFor(db, call);
  const capabilities = [...new Set(questions.map(q => q.capability))];
  let answer: GateAnswer = { decision: null, capabilities };
  for (const { capability, action } of questions) {
    const d = canExecute(db, { capability, action }) as {
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

/**
 * A tool call, from the words an agent has for one: `Bash`,
 * `mcp__github__create_issue`, or `Bash(git push origin main)`, the form a
 * Claude Code permission rule takes. Null for anything else, which is a
 * capability's name and the resolver's to read.
 */
export function callFromWords(given: string): ToolCall | null {
  const word = given.trim();
  const form = /^([A-Za-z_][\w-]*)\(([\s\S]*)\)$/.exec(word);
  const name = form ? form[1] : word;
  if (!/^mcp__\w/.test(name) && !builtInTool(name)) return null;
  return {
    tool_name: name,
    tool_input: form ? { command: form[2].replace(/:\*$/, '') } : {},
  };
}

/**
 * What the ledger holds against the capabilities a call exercises: failures a
 * runtime reported in the last week, counted, with the latest signal. Told to
 * the agent about to make the same call, and weighed by nothing: a failed run
 * is not evidence a capability fails (rule 10), so the verdict beside it is
 * the grant's and the check's alone. Undefined when there are none.
 */
function recentFailures(db: Db, tool: string, capabilities: string[]) {
  const ids = [...new Set([attribute(db, tool), ...capabilities])].filter((id): id is string =>
    Boolean(id)
  );
  if (!ids.length) return undefined;
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS times, MAX(timestamp) AS last_at FROM failure_signals
         WHERE source != 'can' AND timestamp >= datetime('now', '-7 days')
           AND capability_id IN (${ids.map(() => '?').join(', ')})`
      )
      .get<{ times: number; last_at: string | null }>(...ids);
    if (!row?.times) return undefined;
    const last = db
      .prepare(
        `SELECT class, signal FROM failure_signals
         WHERE source != 'can' AND capability_id IN (${ids.map(() => '?').join(', ')})
         ORDER BY id DESC LIMIT 1`
      )
      .get<{ class: string; signal: string }>(...ids);
    return {
      times: row.times,
      days: 7,
      last_at: row.last_at,
      last: last && `${last.class}: ${last.signal}`,
    };
  } catch {
    // a graph from before failure_signals has nothing to say
    return undefined;
  }
}

const VERDICT_ORDER: Record<string, number> = { yes: 0, ask: 1, no: 2 };

/**
 * `ambit can` asked with a tool's name in place of a capability's.
 *
 * An agent knows the tool it is about to call, not the node the tree files it
 * under, and `ambit can Bash` used to resolve to the entry `tool:bash`, which
 * carries no grant, and answer no for a call the gate only asks about. This
 * asks what the gate asks: each capability the call exercises, with the
 * narrowest answer given and every question listed beside it. The answer
 * keeps `canExecute`'s words, so no grant yet is still a no here. Beside it
 * goes the Claude Code permission rule that names the call, when one does.
 *
 * Null when the words are not a call, when they are a node's exact id, which
 * is a question about that node, or when the graph names nothing the call
 * exercises.
 */
export function decideCall(
  db: Db,
  given: string,
  input: { actor?: string; target?: string; spendCents?: number } = {},
  home = process.env.HOME || '/'
) {
  const call = callFromWords(given);
  if (!call) return null;
  const exact = resolveCapability(db, given);
  if (exact.ok && exact.via !== 'name') return null;
  const answers = questionsFor(db, call).map(q => ({
    ...q,
    decision: canExecute(db, { ...input, ...q }) as { verdict: string; [key: string]: unknown },
  }));
  if (!answers.length) return null;
  const narrowest = answers.reduce((a, b) =>
    VERDICT_ORDER[b.decision.verdict] > VERDICT_ORDER[a.decision.verdict] ? b : a
  );
  return {
    ...narrowest.decision,
    asked_as: {
      tool: call.tool_name,
      exercises: answers.map(a => ({
        capability: a.capability,
        action: a.action,
        verdict: a.decision.verdict,
      })),
    },
    // What the runtime's own settings say about the same call, beside the
    // graph's answer: the two are separate facts, and the narrower one holds.
    runtime_rule: claudeRuleFor(home, call),
    failed_recently: recentFailures(
      db,
      call.tool_name as string,
      answers.map(a => a.capability)
    ),
  };
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
        PreToolUse: [gateHookEntry(command)],
      },
    },
    null,
    2
  );
}
