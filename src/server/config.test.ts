/**
 * Who may read and rewrite the agent config over HTTP.
 *
 * The origin allow-list constrains browsers and nothing else. Anything that
 * simply omits the header — curl, a stray script, another agent on the same
 * machine — reached `GET /api/config` and `POST /api/config/apply` and got a
 * 200. That config decides which MCP servers an agent runtime loads, so "any
 * local process may rewrite it" was a larger grant than this server intends.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  apiTokenPath,
  isAllowedHost,
  isAllowedOrigin,
  mayEditConfig,
  ownEntry,
  pagePorts,
  readApiToken,
} from './config.ts';

const TOKEN = 'a'.repeat(64);
process.env.AMBIT_API_TOKEN = TOKEN;
// The API on its default port and the dev page on its, as `npm run dev` runs them.
process.env.AMBIT_API_PORT = '3001';
process.env.AMBIT_WEB_PORT = '3000';

/** Runs `fn` with the environment changed, and puts it back. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  const set = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  for (const [k, v] of Object.entries(vars)) set(k, v);
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) set(k, v);
  }
}

test('a browser is judged by its origin, and the origin by its port', () => {
  expect(mayEditConfig('/api/config', 'http://localhost:3000', undefined)).toBe(true);
  expect(mayEditConfig('/api/config', 'http://127.0.0.1:3001', undefined)).toBe(true);
  expect(mayEditConfig('/api/config', 'https://evil.example', undefined)).toBe(false);
  // A token does not buy a foreign page anything; the origin still decides.
  expect(mayEditConfig('/api/config', 'https://evil.example', TOKEN)).toBe(false);
  // Another page on this machine is not this app's page, whatever name it uses.
  for (const origin of [
    'http://localhost:5173',
    'http://127.0.0.1:8000',
    'http://[::1]:8080',
    'http://localhost',
  ]) {
    expect([origin, mayEditConfig('/api/config', origin, undefined)]).toEqual([origin, false]);
    expect([origin, mayEditConfig('/api/config', origin, TOKEN)]).toEqual([origin, false]);
  }
});

test('an Origin is allowed on a page port of this app, by any name for this machine', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]', 'LOCALHOST']) {
    for (const port of [3000, 3001]) {
      expect(isAllowedOrigin(`http://${host}:${port}`)).toBe(true);
    }
    expect(isAllowedOrigin(`http://${host}:3002`)).toBe(false);
  }
  // The same port under a name that is not this machine is still refused.
  expect(isAllowedOrigin('http://localhost.evil.example:3000')).toBe(false);
  expect(isAllowedOrigin('http://0.0.0.0:3000')).toBe(false);
  // An Origin a browser sends for a file, a sandboxed frame or an extension.
  expect(isAllowedOrigin('null')).toBe(false);
  expect(isAllowedOrigin('file://')).toBe(false);
  expect(isAllowedOrigin('chrome-extension://abcdef')).toBe(false);
});

test('an Origin with no port means the default port of its scheme', () => {
  // A browser leaves :80 off an http Origin and :443 off an https one.
  expect(isAllowedOrigin('http://localhost', [80])).toBe(true);
  expect(isAllowedOrigin('http://localhost:80', [80])).toBe(true);
  expect(isAllowedOrigin('http://localhost', [443])).toBe(false);
  expect(isAllowedOrigin('https://localhost', [443])).toBe(true);
  expect(isAllowedOrigin('https://localhost', [80])).toBe(false);
  expect(isAllowedOrigin('http://localhost:443', [443])).toBe(true);
  expect(isAllowedOrigin('http://localhost', [3001])).toBe(false);
  expect(isAllowedOrigin('https://127.0.0.1', [3001, 3000])).toBe(false);
});

test('the dev port is accepted only when the dev script names it', () => {
  // `npm start`, `npm run server` and an installed `ambit web` set no dev port,
  // so 3000, where so many other projects' dev servers run, is not this app's.
  withEnv({ AMBIT_WEB_PORT: undefined, AMBIT_API_PORT: undefined }, () => {
    expect(pagePorts()).toEqual([3001]);
    expect(isAllowedOrigin('http://localhost:3000')).toBe(false);
    expect(isAllowedOrigin('http://localhost:3001')).toBe(true);
  });
  for (const unusable of ['', 'abc', '0', '-1', '3000.5']) {
    withEnv({ AMBIT_WEB_PORT: unusable, AMBIT_API_PORT: '4011' }, () => {
      expect([unusable, pagePorts()]).toEqual([unusable, [4011]]);
    });
  }
  withEnv({ AMBIT_WEB_PORT: '4173', AMBIT_API_PORT: '3011' }, () => {
    expect(pagePorts()).toEqual([3011, 4173]);
    expect(isAllowedOrigin('http://localhost:4173')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:3011')).toBe(true);
    expect(isAllowedOrigin('http://localhost:3000')).toBe(false);
    expect(isAllowedOrigin('http://localhost:3001')).toBe(false);
  });
});

test('something that is not a browser must present the token', () => {
  expect(mayEditConfig('/api/config', '', undefined)).toBe(false);
  expect(mayEditConfig('/api/config', '', 'wrong')).toBe(false);
  expect(mayEditConfig('/api/config', '', TOKEN)).toBe(true);
  expect(mayEditConfig('/api/config/apply', '', undefined)).toBe(false);
  expect(mayEditConfig('/api/config/mcp-snippet', '', undefined)).toBe(false);
});

test('every decision on a proposal, one or many, needs the token without a browser', () => {
  // The per-id routes were open to a local script that named any actor it liked,
  // and signed an approval the control plane then accepted. The page itself
  // still needs nothing.
  for (const path of [
    '/api/proposals/approve',
    '/api/proposals/reject',
    '/api/proposals/prop-1/approve',
    '/api/proposals/prop-1/reject',
  ]) {
    expect(mayEditConfig(path, '', undefined)).toBe(false);
    expect(mayEditConfig(path, '', 'wrong')).toBe(false);
    expect(mayEditConfig(path, '', TOKEN)).toBe(true);
    expect(mayEditConfig(path, '', undefined, 'same-origin')).toBe(true);
    expect(mayEditConfig(path, 'http://localhost:3000', undefined)).toBe(true);
    expect(mayEditConfig(path, 'https://evil.example', TOKEN)).toBe(false);
  }
});

test('a token of the wrong length is refused, not compared', () => {
  // timingSafeEqual throws on a length mismatch; the guard has to handle that
  // rather than turning a bad header into a 500.
  expect(mayEditConfig('/api/config', '', 'short')).toBe(false);
  expect(mayEditConfig('/api/config', '', `${TOKEN}extra`)).toBe(false);
});

test('telemetry needs the token without a browser, because a recorded use can promote a grant', () => {
  // A use in a run that ended in success counts toward a promotion threshold,
  // so an open route let a local page or script push a grant across one.
  expect(mayEditConfig('/api/telemetry', '', undefined)).toBe(false);
  expect(mayEditConfig('/api/telemetry', '', 'wrong')).toBe(false);
  expect(mayEditConfig('/api/telemetry', '', TOKEN)).toBe(true);
  expect(mayEditConfig('/api/telemetry', '', undefined, 'same-origin')).toBe(true);
  expect(mayEditConfig('/api/telemetry', '', undefined, 'same-site')).toBe(false);
  expect(mayEditConfig('/api/telemetry', 'http://localhost:3000', undefined)).toBe(true);
  expect(mayEditConfig('/api/telemetry', 'http://localhost:8000', TOKEN)).toBe(false);
});

test('the routes that only read the graph stay open', () => {
  for (const path of ['/api/health', '/api/tech-tree', '/api/proposals', '/api/loop']) {
    expect(mayEditConfig(path, '', undefined)).toBe(true);
  }
});

test('a client finds the token the server made, and never makes one itself', () => {
  const home = mkdtempSync(join(tmpdir(), 'ambit-token-'));
  try {
    withEnv({ HOME: home, AMBIT_API_TOKEN: undefined }, () => {
      expect(apiTokenPath()).toBe(join(home, '.config', 'opencode', 'ambit-api.token'));
      expect(readApiToken()).toBeUndefined();
      expect(existsSync(apiTokenPath())).toBe(false);
      mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
      writeFileSync(apiTokenPath(), `${'c'.repeat(64)}\n`, { mode: 0o600 });
      expect(readApiToken()).toBe('c'.repeat(64));
      // The file is what the server checks against, so it is what a client sends.
      expect(mayEditConfig('/api/telemetry', '', 'c'.repeat(64))).toBe(true);
    });
    withEnv({ HOME: home, AMBIT_API_TOKEN: 'from-env' }, () => {
      expect(readApiToken()).toBe('from-env');
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('an entry is one the config owns, and a name Object.prototype supplies is not', () => {
  // The switch edits `enabled` on an entry that is there and never makes one, so
  // "is there" is the whole gate. The page asks the same question of its copy of
  // the config before it offers a switch.
  const bag = JSON.parse('{"git": {"enabled": true}, "off": null, "flag": true}');
  expect(ownEntry(bag, 'git')).toBe(true);
  expect(ownEntry(bag, 'nonesuch')).toBe(false);
  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    expect(ownEntry(bag, name), name).toBe(false);
  }
  // An own key that holds no entry, and lookups that are not names at all.
  expect(ownEntry(bag, 'off')).toBe(false);
  expect(ownEntry(bag, 'flag')).toBe(false);
  expect(ownEntry(bag, 42)).toBe(false);
  expect(ownEntry(undefined, 'git')).toBe(false);
});

test('an absent Origin is still same-origin for everything else', () => {
  expect(isAllowedOrigin('')).toBe(true);
  expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
  expect(isAllowedOrigin('http://localhost:5173')).toBe(false);
  expect(isAllowedOrigin('https://example.com')).toBe(false);
  expect(isAllowedOrigin('not a url')).toBe(false);
});

test('the names that mean this machine are the only ones a request may be addressed to', () => {
  for (const host of [
    'localhost',
    'localhost:3001',
    '127.0.0.1',
    '127.0.0.1:3001',
    '[::1]',
    '[::1]:3001',
    'LOCALHOST:3001',
  ]) {
    expect([host, isAllowedHost(host)]).toEqual([host, true]);
  }
  for (const host of [
    'attacker.example',
    'attacker.example:3001',
    'localhost.attacker.example',
    '127.0.0.1.attacker.example',
    'attacker.example:3001@localhost',
    '0.0.0.0:3001',
    '192.168.1.20:3001',
    'a b',
    '',
  ]) {
    expect([host, isAllowedHost(host)]).toEqual([host, false]);
  }
  expect(isAllowedHost(undefined)).toBe(true);
});
