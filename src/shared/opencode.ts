/**
 * An OpenCode config, read the way OpenCode itself reads it, whichever major
 * version wrote it.
 *
 * OpenCode 2 renamed most of the config (`agent` became `agents`, `command`
 * became `commands`, `provider` became `providers`, `permission` became a list
 * of rules under `permissions`) and moved MCP servers one level down, under
 * `mcp.servers`, with `enabled` inverted to `disabled`. It still accepts the
 * V1 fields, and normalizes both in memory without rewriting the file. This
 * does the same in the other direction: every reader in Ambit was written
 * against the V1 shape, so a V2 config is read into that shape here, once, and
 * no reader has to know there were two.
 *
 * Read on a V2 config, the V1 readers were wrong in the quiet way: `mcp.servers`
 * became one MCP server named "servers", and every agent, command and provider
 * was missing. Nothing failed, and the map drew a machine with one tool on it.
 *
 * Writing is the other half. An edit goes back into the file in the shape the
 * file already has, which is what `mcpEntries` answers, so a switch flipped on
 * the page never leaves a V1 field in a V2 file for OpenCode to warn about.
 *
 * Imported by the engine, the API server and the browser (a dropped config),
 * so it touches no file and no environment.
 */
import { authorityBlock } from './authority.ts';

type Bag = Record<string, any>;

const isBag = (v: unknown): v is Bag => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * JSON with comments and trailing commas, the format `opencode.jsonc` is in.
 *
 * A comment is only a comment outside a string: `"https://x"` holds `//` and a
 * glob such as `"src/**\/*.ts"` holds `/*`, and a stripper that ignores quotes
 * cuts both in half. Plain JSON passes through unchanged.
 */
export function parseJsonc(text: string): any {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  // A comma before a closing bracket, outside any string: the strings are
  // intact at this point, so match them first and keep them as they are.
  return JSON.parse(
    out.replace(/("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g, (_m, str, close) => str ?? close)
  );
}

/**
 * True when `mcp.servers` is V2's container and not a V1 server that happens to
 * be named "servers". A server has a `type`, a `command` or a `url`; the
 * container has none of those, only entries.
 */
function hasServerContainer(mcp: unknown): mcp is { servers: Bag } {
  if (!isBag(mcp) || !isBag(mcp.servers)) return false;
  const s = mcp.servers;
  return !('type' in s) && !('command' in s) && !('url' in s);
}

/** Whether the file is written in OpenCode 2's native shape. */
export function isOpencodeV2(raw: unknown): boolean {
  if (!isBag(raw)) return false;
  return (
    hasServerContainer(raw.mcp) ||
    isBag(raw.agents) ||
    isBag(raw.commands) ||
    isBag(raw.providers) ||
    Array.isArray(raw.permissions) ||
    Array.isArray(raw.plugins)
  );
}

/**
 * The MCP entries as they sit in the file, and which word switches one off.
 * An edit goes here, into the shape the file already has.
 */
export function mcpEntries(raw: Bag): { bag: Bag | undefined; v2: boolean } {
  if (hasServerContainer(raw?.mcp)) return { bag: raw.mcp.servers, v2: true };
  return { bag: isBag(raw?.mcp) ? raw.mcp : undefined, v2: false };
}

/** `"anthropic/claude-sonnet-4-5#high"` names a model and a variant of it. */
function splitVariant(model: unknown): { model?: string; variant?: string } {
  if (typeof model !== 'string') return {};
  const hash = model.indexOf('#');
  return hash < 0 ? { model } : { model: model.slice(0, hash), variant: model.slice(hash + 1) };
}

function agentsV1(bag: unknown): Bag {
  const out: Bag = {};
  if (!isBag(bag)) return out;
  for (const [name, a] of Object.entries<any>(bag)) {
    if (!isBag(a)) continue;
    const { model, variant } = splitVariant(a.model);
    out[name] = {
      ...a,
      ...(a.system !== undefined && a.prompt === undefined ? { prompt: a.system } : {}),
      ...(a.disabled !== undefined && a.disable === undefined ? { disable: a.disabled } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(variant !== undefined && a.variant === undefined ? { variant } : {}),
    };
  }
  return out;
}

function commandsV1(bag: unknown): Bag {
  const out: Bag = {};
  if (!isBag(bag)) return out;
  for (const [name, c] of Object.entries<any>(bag)) {
    if (!isBag(c)) continue;
    const { model, variant } = splitVariant(c.model);
    out[name] = {
      ...c,
      ...(c.subagent !== undefined && c.subtask === undefined ? { subtask: c.subagent } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(variant !== undefined && c.variant === undefined ? { variant } : {}),
    };
  }
  return out;
}

/**
 * A provider's models, keyed by id. V1 keys them; a V2 list names each one by
 * `modelID` or `id`, and a model with neither has no id to be known by.
 */
function modelsV1(models: unknown): Bag | undefined {
  if (isBag(models)) return models;
  if (!Array.isArray(models)) return undefined;
  const out: Bag = {};
  for (const m of models) {
    const id = isBag(m) ? (m.modelID ?? m.id) : undefined;
    if (typeof id === 'string' && id) out[id] = m;
  }
  return out;
}

function providersV1(bag: unknown): Bag {
  const out: Bag = {};
  if (!isBag(bag)) return out;
  for (const [name, p] of Object.entries<any>(bag)) {
    if (!isBag(p)) continue;
    const models = modelsV1(p.models);
    out[name] = { ...p, ...(models ? { models } : {}) };
  }
  return out;
}

function mcpV1(mcp: unknown): Bag | undefined {
  if (!isBag(mcp)) return undefined;
  if (!hasServerContainer(mcp)) return mcp;
  const out: Bag = {};
  // V1 entries beside the container are still servers OpenCode reads.
  for (const [name, entry] of Object.entries(mcp)) if (name !== 'servers') out[name] = entry;
  for (const [name, entry] of Object.entries<any>(mcp.servers)) {
    if (!isBag(entry)) continue;
    out[name] = {
      ...entry,
      ...(entry.enabled === undefined && entry.disabled !== undefined
        ? { enabled: entry.disabled !== true }
        : {}),
    };
  }
  return out;
}

/**
 * The config in the V1 shape every Ambit reader expects. Keys Ambit reads for
 * itself (`authority`, `actors`, `combos` and the rest) pass through untouched;
 * where a file carries both the V1 and V2 name for one block, the V2 entries win
 * a name they share, as they do in OpenCode.
 */
export function normalizeOpencode(raw: unknown): Bag {
  if (!isBag(raw)) return {};
  const out: Bag = { ...raw };
  const mcp = mcpV1(raw.mcp);
  if (mcp) out.mcp = mcp;
  if (isBag(raw.agent) || isBag(raw.agents))
    out.agent = { ...agentsV1(raw.agent), ...agentsV1(raw.agents) };
  if (isBag(raw.command) || isBag(raw.commands))
    out.command = { ...commandsV1(raw.command), ...commandsV1(raw.commands) };
  if (isBag(raw.provider) || isBag(raw.providers))
    out.provider = { ...providersV1(raw.provider), ...providersV1(raw.providers) };
  return out;
}

/**
 * What OpenCode says about running a shell command, in either shape, as the
 * `authority` block the engine seeds from.
 *
 * Only a rule that covers every command speaks for the runtime: `"git push *":
 * "ask"` is a statement about one command, and reading it as the general rule
 * would claim a caution, or a freedom, the config never stated. V2 evaluates its
 * rules in order and the last match wins, so the last covering rule is the one
 * that holds. V1's `bash` is the same action under its old name.
 */
export function opencodeAuthority(raw: unknown): Bag | undefined {
  if (!isBag(raw)) return undefined;
  let setting: unknown;
  let note = '';
  if (Array.isArray(raw.permissions)) {
    for (const rule of raw.permissions) {
      if (!isBag(rule) || (rule.action !== 'shell' && rule.action !== 'bash')) continue;
      if (rule.resource !== undefined && rule.resource !== '*') continue;
      setting = rule.effect;
      note = `opencode permissions: ${rule.action} * ${rule.effect}`;
    }
  }
  if (setting === undefined) {
    const p = raw.permission;
    const bash = isBag(p) ? p.bash : undefined;
    if (typeof p === 'string') setting = p;
    else if (typeof bash === 'string') setting = bash;
    else if (isBag(bash) && typeof bash['*'] === 'string') setting = bash['*'];
    if (setting !== undefined)
      note = `opencode permission${typeof p === 'string' ? '' : '.bash'}: ${setting}`;
  }
  return authorityBlock({ execute: setting, note });
}

/**
 * Where a section a patch names in V1's words lives in this file.
 *
 * The curated tree's `config_patch` and its inverse are written against V1
 * (`mcp.<name>`), and a V2 file keeps its servers one level down. Apply,
 * rollback and the inverse drafted beside them all resolve the section here, so
 * the three agree on where an entry is and a rollback removes what the apply
 * wrote. Other sections keep their V1 names, which OpenCode 2 still reads.
 */
export function configSection(config: Bag, section: string, create = false): Bag | undefined {
  if (section === 'mcp') {
    const { bag, v2 } = mcpEntries(config);
    if (v2 || bag) return bag;
  } else if (isBag(config[section])) {
    return config[section];
  }
  if (!create) return undefined;
  config[section] = {};
  return config[section];
}

/**
 * An MCP entry from a V1-shaped patch, in the words of the file it is going
 * into: OpenCode 2 switches a server off with `disabled`, never `enabled`.
 */
export function entryInShape(config: Bag, section: string, value: unknown): unknown {
  if (section !== 'mcp' || !mcpEntries(config).v2 || !isBag(value) || !('enabled' in value))
    return value;
  const { enabled, ...rest } = value;
  return { ...rest, disabled: enabled === false };
}
