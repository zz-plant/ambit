/**
 * Who may read and rewrite the agent config over HTTP.
 *
 * The origin allow-list constrains browsers and nothing else. Anything that
 * simply omits the header — curl, a stray script, another agent on the same
 * machine — reached `GET /api/config` and `POST /api/config/apply` and got a
 * 200. That config decides which MCP servers an agent runtime loads, so "any
 * local process may rewrite it" was a larger grant than this server intends.
 */
import { expect, test } from 'vitest';
import { isAllowedHost, isAllowedOrigin, mayEditConfig, ownEntry } from './config.ts';

const TOKEN = 'a'.repeat(64);
process.env.AMBIT_API_TOKEN = TOKEN;

test('a browser is judged by its origin, as before', () => {
  expect(mayEditConfig('/api/config', 'http://localhost:5173', undefined)).toBe(true);
  expect(mayEditConfig('/api/config', 'http://127.0.0.1:3000', undefined)).toBe(true);
  expect(mayEditConfig('/api/config', 'https://evil.example', undefined)).toBe(false);
  // A token does not buy a foreign page anything; the origin still decides.
  expect(mayEditConfig('/api/config', 'https://evil.example', TOKEN)).toBe(false);
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

test('the routes that are not about config stay open', () => {
  // Telemetry especially: it is append-only observation with no read-back, and
  // the agent-runtime plugin posts to it unattended.
  for (const path of ['/api/telemetry', '/api/health', '/api/tech-tree', '/api/proposals']) {
    expect(mayEditConfig(path, '', undefined)).toBe(true);
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
