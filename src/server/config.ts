/**
 * The agent config this server reads, and the narrow set of edits it will make.
 *
 * The API can change an entry that already exists and nothing else. It cannot
 * create one: a new MCP server carries a `command` array the agent runtime
 * later executes, which would make an HTTP request a way to run code on this
 * machine. Adding a server stays a hand edit — see the mcp-snippet route.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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

/**
 * The routes that read or rewrite the agent config, and why they need more
 * than an origin check.
 *
 * `isAllowedOrigin` stops a *browser* on someone else's page. It cannot stop
 * anything that simply omits the header: curl, a stray script, another agent
 * on the same machine all reached `GET /api/config` and `POST
 * /api/config/apply` and got 200. The config decides which MCP servers an
 * agent runtime loads, so "any local process may rewrite it" is a bigger grant
 * than this server means to make.
 *
 * Telemetry is deliberately not on this list: it is append-only observation
 * with no read-back, the agent-runtime plugin posts to it unattended, and
 * requiring a secret there would buy little and break that.
 */
const CONFIG_ROUTES = ['/api/config', '/api/config/apply', '/api/config/mcp-snippet'];

/** Same shape as the approval key: a 0600 file beside the agent config. */
export function apiToken(): string {
  const override = process.env.AMBIT_API_TOKEN;
  if (override) return override;
  const dir = join(process.env.HOME || '/', '.config', 'opencode');
  const path = join(dir, 'ambit-api.token');
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  mkdirSync(dir, { recursive: true });
  const token = randomBytes(32).toString('hex');
  writeFileSync(path, token + '\n', { mode: 0o600 });
  return token;
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Whether a request may touch the config routes.
 *
 * Three cases, and the middle one is why this is not simply "no Origin means
 * no browser". A same-origin `fetch` sends no Origin header at all, so the
 * visualiser this server serves to its own page looked exactly like curl —
 * which is how the first version of this locked the app out of its own API.
 * `Sec-Fetch-Site` is what separates them: browsers set it on every request
 * and script cannot override it, because it is a forbidden header.
 *
 *   - an Origin present → judged by the allow-list, as before. This is the
 *     vite dev path, where the page is on :3000 and the API on :3001.
 *   - a same-origin browser fetch → allowed; it is this server's own page.
 *   - anything else → must present the token.
 *
 * What this stops is a web page the user happens to visit reading or rewriting
 * their agent config, and a script or another agent doing it casually. It is
 * not a boundary against a determined local process: anything running as the
 * user can send the header itself or read the token file. Loopback binding and
 * 0600 permissions are what carry that weight.
 */
export function mayEditConfig(
  pathname: string,
  origin: string,
  header: string | undefined,
  fetchSite?: string
): boolean {
  if (!CONFIG_ROUTES.includes(pathname)) return true;
  if (origin) return isAllowedOrigin(origin);
  if (fetchSite === 'same-origin' || fetchSite === 'none') return true;
  return Boolean(header) && sameToken(header as string, apiToken());
}
