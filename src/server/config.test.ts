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
import { isAllowedOrigin, mayEditConfig } from './config.ts';

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

test('an absent Origin is still same-origin for everything else', () => {
  expect(isAllowedOrigin('')).toBe(true);
  expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
  expect(isAllowedOrigin('https://example.com')).toBe(false);
  expect(isAllowedOrigin('not a url')).toBe(false);
});
