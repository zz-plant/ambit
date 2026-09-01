/**
 * The agent config this server reads, and the narrow set of edits it will make.
 *
 * The API can change an entry that already exists and nothing else. It cannot
 * create one: a new MCP server carries a `command` array the agent runtime
 * later executes, which would make an HTTP request a way to run code on this
 * machine. Adding a server stays a hand edit — see the mcp-snippet route.
 */
import { readFile, writeFile } from 'node:fs/promises';

export const CONFIG_PATH =
  process.env.OPENCODE_CONFIG || `${process.env.HOME}/.config/opencode/opencode.json`;
export const REPO_PATH = process.env.REPO_PATH || `${process.env.HOME}/Documents/GitHub`;
export const INFRA_MANIFEST_PATH =
  process.env.INFRA_MANIFEST || `${process.env.HOME}/.config/opencode/infrastructure.json`;

export async function readConfig(): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export async function writeConfig(data: Record<string, unknown>): Promise<boolean> {
  try {
    await writeFile(CONFIG_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

/** Editable fields, by entry kind. Anything else in a payload is dropped. */
export const AGENT_FIELDS = ['description', 'model'] as const;
export const COMMAND_FIELDS = ['description'] as const;

/**
 * True only for a real, own entry. A plain `bag[name]` truth test would accept
 * '__proto__' or 'constructor' — inherited from Object.prototype — and the
 * assignment that followed would pollute every object in the process.
 */
export function ownEntry(bag: any, name: unknown): boolean {
  return (
    typeof name === 'string' &&
    !!bag &&
    Object.hasOwn(bag, name) &&
    typeof bag[name] === 'object' &&
    bag[name] !== null
  );
}

export function pick(updates: unknown, allowed: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!updates || typeof updates !== 'object') return out;
  for (const key of allowed) {
    const value = (updates as Record<string, unknown>)[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/**
 * Only local dev origins may talk to this server.
 *
 * Reflecting the caller's Origin (the original behaviour) let any website the
 * user visited read /api/config and POST to /api/config/apply, because the
 * browser would honour the reflected header.
 */
export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return true; // same-origin and non-browser clients send no Origin
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export function corsHeaders(origin: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Ambit-Token',
    Vary: 'Origin',
  };
  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}
