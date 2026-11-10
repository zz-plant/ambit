/**
 * What is wired into each agent on this machine, and what is still not.
 *
 * Three steps stand between reading a config and the rest of Ambit working:
 * the agents have to be able to ask (the MCP server), what they do has to be
 * recorded (a bridge into the ledger), and what a person refused has to stop a
 * tool call (the gate). Each is a file on this machine, so each is read here
 * and none is guessed from the graph. It reads files and writes nothing, and it
 * stays light, because the gate hook imports it on every tool call.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from '../shared/opencode.ts';
import { CLAUDE_PLUGIN_INSTALL, telemetryBridgeInstall } from './paths.ts';

/** The one shape a runtime's detection has to give this module. */
interface RuntimeSeen {
  runtime: string;
  has_ambit: boolean;
}

/** A step still missing: what it does for the person, and what to type. */
export interface SetupStep {
  kind: 'connect' | 'record' | 'gate';
  says: string;
  command: string;
}

/** Whichever of Claude Code's two user-level settings files parse, in the order it reads them. */
function claudeSettings(home: string): Record<string, any>[] {
  const found: Record<string, any>[] = [];
  for (const name of ['settings.json', 'settings.local.json']) {
    try {
      const parsed = parseJsonc(readFileSync(join(home, '.claude', name), 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) found.push(parsed);
    } catch {
      // absent or unreadable: it says nothing either way
    }
  }
  return found;
}

/** Whether Claude Code's settings turn this plugin on: `enabledPlugins`, by `name@marketplace`. */
export function claudePluginEnabled(home: string, plugin: string): boolean {
  return claudeSettings(home).some(s => s.enabledPlugins?.[plugin] === true);
}

/** What one of Claude Code's own permission rules says about a call, and the rule that said it. */
export interface RuntimeRule {
  runtime: 'claude-code';
  says: 'deny' | 'ask' | 'allow';
  rule: string;
}

/** Whether one permission rule covers a call. A rule with a specifier needs the command to compare. */
function ruleCovers(rule: string, tool: string, command?: string): boolean {
  const form = /^([^()]+)\(([\s\S]*)\)$/.exec(rule.trim());
  if (!form) {
    const name = rule.trim().replace(/__\*$/, '');
    return name === tool || (name.startsWith('mcp__') && tool.startsWith(`${name}__`));
  }
  if (form[1] !== tool || command === undefined) return false;
  const spec = form[2];
  if (spec.endsWith(':*')) {
    const prefix = spec.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  if (!spec.includes('*')) return command === spec;
  const pattern = spec.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\s\\S]*');
  return new RegExp(`^${pattern}$`).test(command);
}

/**
 * What Claude Code's user-level permission rules say about a tool call, when
 * one of them names it: deny first, then ask, then allow, the order Claude
 * Code reads them in. Reported beside Ambit's answer and never folded into it,
 * since a rule in the runtime is the person's word about the runtime and a
 * grant is their word about the graph (rule 20). Undefined when no rule names
 * the call: the session's permission mode decides then, and no file holds it.
 * An allow rule is not matched against a command that chains others, because
 * Claude Code asks about each part.
 */
export function claudeRuleFor(
  home: string,
  call: { tool_name?: string; tool_input?: unknown }
): RuntimeRule | undefined {
  const tool = typeof call.tool_name === 'string' ? call.tool_name : '';
  if (!tool) return undefined;
  const given = (call.tool_input as { command?: unknown } | null | undefined)?.command;
  const command = typeof given === 'string' ? given.trim() : undefined;
  const chained = command !== undefined && /[;&|`]|\$\(/.test(command);
  const settings = claudeSettings(home);
  for (const says of ['deny', 'ask', 'allow'] as const) {
    if (says === 'allow' && chained) continue;
    for (const s of settings) {
      const rules: unknown = s.permissions?.[says];
      if (!Array.isArray(rules)) continue;
      const rule = rules.find(r => typeof r === 'string' && ruleCovers(r, tool, command));
      if (rule) return { runtime: 'claude-code', says, rule };
    }
  }
  return undefined;
}

/** Whether a hook's command runs Ambit's gate, by name or from a checkout's cli.js. */
function runsGate(command: unknown): boolean {
  return typeof command === 'string' && /\b(ambit(-cli)?|cli\.js)\b.*\bgate\b/.test(command);
}

/** Whether a hook's matcher covers all tools: absent, empty, or one of the two wildcards. */
function matchesEveryTool(matcher: unknown): boolean {
  return matcher === undefined || matcher === '' || matcher === '*' || matcher === '.*';
}

/**
 * Whether Claude Code puts the gate on every tool call here: the `ambit-gate`
 * plugin, or a PreToolUse hook that runs the command for all tools. A hook on
 * `Read` alone leaves `Bash` unchecked, so it does not count, and `--gate` adds
 * the full one beside it. Claude Code is the one runtime with a gate, so nothing
 * else can answer yes.
 */
export function gateInstalled(home: string): boolean {
  if (claudePluginEnabled(home, 'ambit-gate@ambit')) return true;
  return claudeSettings(home).some(s => {
    const entries = s.hooks?.PreToolUse;
    if (!Array.isArray(entries)) return false;
    return entries.some(
      e =>
        matchesEveryTool(e?.matcher) &&
        Array.isArray(e?.hooks) &&
        e.hooks.some((h: any) => runsGate(h?.command))
    );
  });
}

/** Whether Claude Code is on this machine at all. */
export function claudeCodeFound(home: string): boolean {
  return existsSync(join(home, '.claude.json')) || existsSync(join(home, '.claude'));
}

/** The PreToolUse entry that runs the gate, as settings.json holds it. */
export function gateHookEntry(command: string) {
  return { matcher: '*', hooks: [{ type: 'command', command, timeout: 10 }] };
}

/** Whether this runtime's bridge into the ledger is in place, where it has one here. */
function recording(home: string, runtime: string): boolean {
  if (runtime === 'claude-code') return claudePluginEnabled(home, 'ambit@ambit');
  if (runtime === 'opencode')
    return existsSync(join(home, '.config', 'opencode', 'plugins', 'ambit-telemetry.js'));
  if (runtime === 'cursor') {
    try {
      return readFileSync(join(home, '.cursor', 'hooks.json'), 'utf8').includes('ambit-ledger');
    } catch {
      return false;
    }
  }
  // Codex and Amp keep session logs Ambit reads as they are, and the rest have
  // no bridge to install: neither is a step anyone can take.
  return true;
}

const recordSays = (label: string) =>
  `Record what ${label} does, so the time and cost reports fill`;

/**
 * What is still missing here, in the order to do it. Empty when no runtime was
 * found, because a step for an agent the person does not run is noise.
 *
 * Claude Code's plugin both registers the server and records, so where Claude
 * Code is the only agent it is the one step. Elsewhere `ambit connect` writes
 * every runtime it finds, and each bridge follows.
 */
export function setupSteps(runtimes: RuntimeSeen[], home: string): SetupStep[] {
  const steps: SetupStep[] = [];
  const has = (runtime: string) => runtimes.some(r => r.runtime === runtime);
  const pluginDoesBoth = runtimes.length === 1 && has('claude-code');
  if (runtimes.length && !runtimes.some(r => r.has_ambit)) {
    steps.push(
      pluginDoesBoth
        ? {
            kind: 'connect',
            says: 'Let your agent ask Ambit, and record what it does',
            command: CLAUDE_PLUGIN_INSTALL,
          }
        : {
            kind: 'connect',
            says: 'Let your agents ask Ambit, so each session opens with the briefing',
            command: 'ambit connect',
          }
    );
  }
  const covered = steps[0]?.command === CLAUDE_PLUGIN_INSTALL;
  if (has('claude-code') && !covered && !recording(home, 'claude-code'))
    steps.push({ kind: 'record', says: recordSays('Claude Code'), command: CLAUDE_PLUGIN_INSTALL });
  if (has('cursor') && !recording(home, 'cursor'))
    steps.push({
      kind: 'record',
      says: recordSays('Cursor'),
      command: 'ambit connect cursor --ledger',
    });
  if (has('opencode') && !recording(home, 'opencode'))
    steps.push({ kind: 'record', says: recordSays('OpenCode'), command: telemetryBridgeInstall() });
  if ((has('claude-code') || claudeCodeFound(home)) && !gateInstalled(home))
    steps.push({
      kind: 'gate',
      says: 'Stop tool calls you refused, and ask about any with no grant',
      command: 'ambit connect claude-code --gate',
    });
  return steps;
}

/**
 * What a new refusal or ceiling reaches on this machine, said when the gate is
 * not on: `ambit can` answers from it at once, and a tool call nobody asked
 * about still runs. Nothing to say when the gate is on, or for a grant that
 * asks nothing of it.
 */
export function gateNote(home: string, mode?: string): string | undefined {
  if (mode !== undefined && mode !== 'forbidden' && mode !== 'confirm') return undefined;
  if (gateInstalled(home)) return undefined;
  const reach =
    'Recorded, and ambit can answers from it, but no gate is on: a tool call that does not ask still runs.';
  return claudeCodeFound(home)
    ? `${reach} ambit connect claude-code --gate puts the gate on every call.`
    : `${reach} Claude Code is the one runtime with a gate, and it was not found here.`;
}
