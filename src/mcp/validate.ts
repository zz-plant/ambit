/**
 * Checking a call's arguments against the schema the tool advertised.
 *
 * Nothing did this. A missing argument reached the engine as `undefined` and
 * failed wherever it happened to be used: most tools that need one answered
 * with "Provided value cannot be bound to SQLite parameter 1", a CLI usage
 * string that told an agent to run a shell command it may not have, or a
 * TypeError from inside a string method. A misspelt name was worse, because it
 * was silently dropped: `ambit_verify` called with `capability_id` ran every
 * declared check, since "no capId" is how one asks for all of them.
 *
 * So the schema is the contract, and it is checked before dispatch. What comes
 * back is either the arguments in the spellings the server reads, or one
 * message that names everything wrong at once and says what the tool takes, so
 * that a single retry is enough.
 *
 * It is lenient exactly where a model is predictably loose and the meaning is
 * not in doubt: `null` for an omitted optional, a number sent as a string,
 * `true` as the word, `capability_id` for `capId`. It is strict everywhere
 * else, since a guess about what an unknown argument meant is the mistake this
 * exists to prevent.
 */
import { squash } from '../shared/nearest.ts';
import { CAPABILITY_KEYS, type Prop, type ToolDef } from './tools.ts';

type Checked =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; error: string; takes: string };

/** `capId* (string), option (number)`: what a tool takes, starred where required. */
function signature(tool: ToolDef): string {
  const required = new Set(tool.inputSchema.required ?? []);
  const parts = Object.entries(tool.inputSchema.properties).map(
    ([name, prop]) => `${name}${required.has(name) ? '*' : ''} (${prop.type})`
  );
  return parts.length ? parts.join(', ') : 'no arguments';
}

function coerce(value: unknown, prop: Prop): { ok: true; value: unknown } | { ok: false } {
  switch (prop.type) {
    case 'string':
      if (typeof value === 'string') return { ok: true, value };
      if (typeof value === 'number' || typeof value === 'boolean') {
        return { ok: true, value: String(value) };
      }
      return { ok: false };
    case 'number': {
      if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, value };
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
        return { ok: true, value: Number(value) };
      }
      return { ok: false };
    }
    case 'boolean':
      if (typeof value === 'boolean') return { ok: true, value };
      if (typeof value === 'string' && /^(true|false)$/i.test(value.trim())) {
        return { ok: true, value: value.trim().toLowerCase() === 'true' };
      }
      return { ok: false };
  }
}

function checkArguments(tool: ToolDef, raw: unknown): Checked {
  const label = tool.name;
  const takes = signature(tool);
  const fail = (problems: string[]): Checked => ({
    ok: false,
    error: `${label}: ${problems.join('; ')}.`,
    takes,
  });

  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    return fail(['arguments must be an object']);
  }
  const given = (raw ?? {}) as Record<string, unknown>;
  const props = tool.inputSchema.properties;

  // Which spellings reach which declared name. A tool that takes a capability
  // takes it under any of its three names, whichever one the schema shows.
  const spellings = new Map<string, string>();
  for (const name of Object.keys(props)) spellings.set(squash(name), name);
  const capKey = Object.keys(props).find(k => (CAPABILITY_KEYS as readonly string[]).includes(k));
  if (capKey) {
    for (const alias of CAPABILITY_KEYS)
      if (!spellings.has(squash(alias))) spellings.set(squash(alias), capKey);
  }

  const out: Record<string, unknown> = {};
  const problems: string[] = [];
  const unknown: string[] = [];

  for (const [key, value] of Object.entries(given)) {
    // A model that has no value for an optional argument often sends null, or
    // an empty string. Either says the same as leaving it out.
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    const name = Object.hasOwn(props, key) ? key : spellings.get(squash(key));
    if (!name) {
      unknown.push(key);
      continue;
    }
    const prop = props[name];
    const checked = coerce(value, prop);
    if (!checked.ok) {
      const shown = typeof value === 'string' ? JSON.stringify(value) : typeof value;
      problems.push(`${name} must be a ${prop.type}, got ${shown}`);
      continue;
    }
    // The schema's own spelling wins if both were sent.
    if (out[name] === undefined || key === name) out[name] = checked.value;
  }

  for (const name of tool.inputSchema.required ?? []) {
    if (out[name] === undefined || out[name] === '') problems.push(`${name} is required`);
  }
  if (unknown.length) {
    problems.push(
      `${unknown.length === 1 ? 'no argument' : 'no arguments'} named ${unknown.join(', ')}`
    );
  }
  return problems.length ? fail(problems) : { ok: true, args: out };
}

export { checkArguments, signature, type Checked };
