/**
 * Whether a remote MCP server answers.
 *
 * A remote server is most of what a plugin brings, and what goes wrong with
 * one is rarely in the config: the endpoint moved, the host is gone, or the
 * server errors. `ambit verify --mcp --remote`, or the server named after
 * `--mcp`, sends each one request and records what came back as a check run.
 * Nothing else here opens a socket, and nothing calls this on its own: it runs
 * when a person types it (AGENTS.md security posture, invariant 4).
 *
 * The request carries no sign-in. A runtime holds the token for a server it
 * signed in to, and that token stays where it is, so a server that asks for
 * one is reported as answering and asking, which proves nothing about the
 * runtime's own sign-in and is never counted as a pass. A URL carrying a
 * credential or a variable is not contacted, and a query string, where some
 * servers take a key, is left off. Redirects are reported, not followed. A
 * project's committed `.mcp.json` names no server here: that file travelled,
 * and a URL in it is a request to a host its author chose (rule 7).
 *
 * What an answer means is `classifyProbe` in failures.ts (rule 8).
 */
import { join } from 'node:path';
import { enabledPlugins, pluginServerName, pluginServers } from './claude-code.ts';
import { classifyProbe, type ProbeAnswer, type ProbeVerdict } from './failures.ts';
import { launchOf, toolServers } from './weight.ts';

/** One remote server a config switches on, and where it is reached. */
export interface RemoteServer {
  id: string;
  name: string;
  url: string;
  /** The runtime, or the plugin, that declares it. */
  from: string;
}

/**
 * Every remote server the user-level configs switch on, and every one an
 * enabled Claude Code plugin brings. OPENCODE_CONFIG narrows it to that one
 * file, as it narrows the seed.
 */
export function remoteServers(home = process.env.HOME || '/'): RemoteServer[] {
  const found = new Map<string, RemoteServer>();
  for (const s of toolServers(home)) {
    if (s.remote && s.enabled && s.url) {
      found.set(s.id, { id: s.id, name: s.name, url: s.url, from: s.runtimes.join(', ') });
    }
  }
  if (!process.env.OPENCODE_CONFIG) {
    const claudeHome = process.env.CLAUDE_HOME || join(home, '.claude');
    for (const plugin of enabledPlugins(claudeHome)) {
      for (const [server, raw] of Object.entries<any>(pluginServers(plugin.root))) {
        const launch = launchOf(raw);
        const name = pluginServerName(plugin.plugin, server);
        if (!launch.remote || !launch.url || found.has(`mcp:${name}`)) continue;
        found.set(`mcp:${name}`, {
          id: `mcp:${name}`,
          name,
          url: launch.url,
          from: `the ${plugin.plugin} plugin`,
        });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The URL a probe may be sent to, or why none is: http or https only, with no
 * credential in it and no variable left for a runtime to fill in. The query
 * string and fragment are dropped.
 */
export function probeTarget(raw: string): { url: URL; dropped: boolean } | { refused: string } {
  if (raw.includes('${')) return { refused: 'its URL names a variable its runtime fills in' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { refused: 'its URL does not parse' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { refused: `${url.protocol} is not http or https` };
  }
  if (url.username || url.password) return { refused: 'its URL carries a credential' };
  const dropped = Boolean(url.search || url.hash);
  url.search = '';
  url.hash = '';
  return { url, dropped };
}

const MAX_BODY = 64 * 1024;

/** Whether a body is a JSON-RPC message, or a batch of them. */
function isJsonRpc(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    const one = (m: any) => m?.jsonrpc === '2.0' && ('result' in m || 'error' in m);
    return Array.isArray(parsed) ? parsed.some(one) : one(parsed);
  } catch {
    return false;
  }
}

async function readSome(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  while (text.length < MAX_BODY) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return text;
}

/** One request, and what came back as the network stated it. */
async function ask(url: URL, init: RequestInit, timeoutMs: number): Promise<ProbeAnswer> {
  try {
    const res = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'ambit', ...(init.headers as Record<string, string>) },
    });
    const contentType = res.headers.get('content-type') ?? undefined;
    const answer: ProbeAnswer = { status: res.status, contentType };
    const location = res.headers.get('location');
    if (location) {
      try {
        answer.redirectHost = new URL(location, url).host;
      } catch {
        /* a location that does not parse names no host */
      }
    }
    if (contentType?.toLowerCase().includes('json')) {
      answer.jsonrpc = isJsonRpc(await readSome(res));
    } else {
      await res.body?.cancel().catch(() => {});
    }
    return answer;
  } catch (e: any) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return { timedOut: true };
    const code = e?.cause?.code ?? e?.code;
    return { errorCode: typeof code === 'string' ? code : 'UNKNOWN' };
  }
}

/**
 * Asks one remote server whether it answers: `initialize` posted as the
 * streamable transport takes it, and where that path is not found or not
 * allowed, a GET for an event stream, as the older SSE transport serves.
 */
export async function probeServer(
  url: URL,
  timeoutMs = 10_000
): Promise<{ answer: ProbeAnswer; verdict: ProbeVerdict; ran: string }> {
  const post = await ask(
    url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'ambit-verify', version: '1' },
        },
      }),
    },
    timeoutMs
  );
  const where = `${url.origin}${url.pathname}`;
  if (post.status === 404 || post.status === 405) {
    const get = await ask(
      url,
      { method: 'GET', headers: { accept: 'text/event-stream' } },
      timeoutMs
    );
    if (get.status && get.status >= 200 && get.status < 300) {
      return { answer: get, verdict: classifyProbe(get), ran: `GET ${where}` };
    }
  }
  return { answer: post, verdict: classifyProbe(post), ran: `POST ${where}` };
}
