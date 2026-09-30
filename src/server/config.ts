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
import { copyFile, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { opencodeConfigIn } from '../engine/paths.ts';
import { normalizeOpencode, parseJsonc } from '../shared/opencode.ts';

export const CONFIG_PATH =
  process.env.OPENCODE_CONFIG || opencodeConfigIn(`${process.env.HOME}/.config/opencode`);
export const REPO_PATH = process.env.REPO_PATH || `${process.env.HOME}/Documents/GitHub`;
export const INFRA_MANIFEST_PATH =
  process.env.INFRA_MANIFEST || `${process.env.HOME}/.config/opencode/infrastructure.json`;

/**
 * The config as every reader here reads it: OpenCode 1 or 2, with or without
 * comments, in the V1 shape (src/shared/opencode.ts). For showing and
 * comparing, never for writing back: a V2 file written from this would come
 * out in V1's shape.
 */
export async function readConfig(): Promise<Record<string, unknown> | null> {
  const file = await readConfigFile();
  return file ? normalizeOpencode(file.raw) : null;
}

/**
 * The config as it sits in the file, for an edit to go back into. `plain` is
 * whether the file is plain JSON: a commented `.jsonc` file parses, but writing
 * it back would delete every comment the person wrote, so the edit is refused.
 */
export async function readConfigFile(): Promise<{
  raw: Record<string, any>;
  plain: boolean;
} | null> {
  let text: string;
  try {
    text = await readFile(CONFIG_PATH, 'utf8');
  } catch {
    return null;
  }
  try {
    return { raw: JSON.parse(text), plain: true };
  } catch {}
  try {
    return { raw: parseJsonc(text), plain: false };
  } catch {
    return null;
  }
}

/**
 * Writes the config, keeping what it replaces in `<config>.bak` first.
 *
 * SECURITY.md says the visualiser's config editing writes a `.bak` before it
 * changes anything, as `ambit apply` does. This is where that stops being a
 * sentence. The copy is byte for byte, so it keeps the formatting the JSON
 * round trip below would lose, and it keeps the file's mode: a config that
 * holds a key and is chmod 600 gets a backup no more readable than itself. Each
 * edit replaces the last backup, so the file is always the config as it stood
 * before the most recent edit.
 *
 * The copy is made beside the backup and renamed over it. Copying straight to
 * `<config>.bak` follows a link that is already there, so a link planted at that
 * name made the write land wherever it pointed, and a link pointing nowhere made
 * the copy fail in a way this function once read as "there is no config yet".
 * A rename replaces the name itself and follows nothing.
 *
 * No config yet means nothing to keep, and the write goes ahead. That is decided
 * by asking about the config, never by which step failed. A backup that cannot be
 * made stops the write instead: an edit this server cannot undo is not one it
 * should make.
 */
export async function writeConfig(data: Record<string, unknown>): Promise<boolean> {
  try {
    if (await configExists()) {
      const backup = `${CONFIG_PATH}.bak`;
      const beside = `${backup}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        await copyFile(CONFIG_PATH, beside, constants.COPYFILE_EXCL);
        await rename(beside, backup);
      } catch (e) {
        await rm(beside, { force: true });
        throw e;
      }
    }
    await writeFile(CONFIG_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

async function configExists(): Promise<boolean> {
  try {
    await stat(CONFIG_PATH);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
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

/**
 * Whether the request was addressed to this machine by a name that means this
 * machine.
 *
 * The origin check judges who *sent* a request, and a page that rebinds its own
 * name to 127.0.0.1 is sent by no foreign origin at all: from the browser's
 * point of view the page and this server are one origin, so it attaches no
 * Origin to a read and `Sec-Fetch-Site: same-origin` to all of them. What such a
 * request cannot hide is the name it used. Its Host is the attacker's, and a
 * request for `attacker.example` has no business at a server that listens on
 * loopback for the person at this machine. Every route answers to
 * `localhost`, `127.0.0.1` and `[::1]` and nothing else.
 *
 * A request with no Host at all is not a browser's, since a browser always
 * sends one, so it is left to the token rules below. One that names something
 * that is not a name is refused.
 */
export function isAllowedHost(host: string | undefined): boolean {
  if (host === undefined) return true;
  // A Host header is a name and maybe a port. A URL parser would also accept
  // credentials, a path or a fragment in front of a name that means this machine
  // (`attacker.example:80@localhost`), so what is not a name is refused first.
  if (!/^[a-z0-9.:[\]-]+$/i.test(host)) return false;
  try {
    const { hostname } = new URL(`http://${host}`);
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
 *
 * The two queue routes are on it though they never touch the config. One
 * request there signs or turns down as many as fifty proposals as the person
 * at the browser, so something with no browser behind it has to hold the token
 * to do it. The per-proposal routes are held to the same rule below.
 */
const CONFIG_ROUTES = [
  '/api/config',
  '/api/config/apply',
  '/api/config/mcp-snippet',
  '/api/proposals/approve',
  '/api/proposals/reject',
];

/**
 * The per-proposal decisions, `/api/proposals/<id>/approve` and `/reject`.
 *
 * They were left off the list above, and the body's `actor` was honoured, so
 * anything on the machine that could make one loopback request could sign an
 * approval as any person the graph knew, with no browser and no token. The
 * control plane then accepted that artifact for a production deploy. They are
 * behind the same rule as the queue now, and decide as the person at the page.
 * The ids differ per proposal, so this is a pattern where the list is exact names.
 */
const DECISION_ROUTE = /^\/api\/proposals\/[^/]+\/(approve|reject)$/;

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
  if (!CONFIG_ROUTES.includes(pathname) && !DECISION_ROUTE.test(pathname)) return true;
  if (origin) return isAllowedOrigin(origin);
  if (fetchSite === 'same-origin' || fetchSite === 'none') return true;
  return Boolean(header) && sameToken(header as string, apiToken());
}
