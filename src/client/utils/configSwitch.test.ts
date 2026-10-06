/**
 * When the page may offer a switch, and what a click asks for.
 *
 * The switch writes to a real config, so the gate is stricter than "this looks
 * like a server": it has to be one the route will actually change, because the
 * route answers ok for anything else.
 */
import { expect, test } from 'vitest';
import { canSwitchMcp, flipMcp } from './configSwitch';

const server = (name: string, meta: Record<string, unknown> = {}) => ({
  type: 'mcp-server' as const,
  name,
  meta: { domain: 'devops', ...meta },
});

const CONFIG = { git: { type: 'local', enabled: true } };

test('a switch needs an engine, a tool server, an entry, and a name the config holds', () => {
  expect(canSwitchMcp(server('git'), 'live', CONFIG)).toBe(true);

  // No engine behind the page to write it back: the hosted demo, or a file
  // that was dropped in the tab.
  expect(canSwitchMcp(server('git'), 'static', CONFIG)).toBe(false);
  expect(canSwitchMcp(server('git'), 'unknown', CONFIG)).toBe(false);
  // A node of the curated tree names no config entry.
  expect(canSwitchMcp(server('git', { era: 3 }), 'live', CONFIG)).toBe(false);
  // Other kinds have no enabled state.
  for (const type of ['agent', 'model', 'tool', 'skill', 'provider', 'config'] as const) {
    expect(canSwitchMcp({ ...server('git'), type }, 'live', CONFIG)).toBe(false);
  }
  // Another runtime's server: in the graph, and not in this config.
  expect(canSwitchMcp(server('linear'), 'live', CONFIG)).toBe(false);
});

test('a name Object.prototype supplies is not a name the config holds', () => {
  // `configMcp.constructor` is truthy. The route's `ownEntry` asks for an own
  // key, and so must the page, or a server with one of these names is offered
  // a switch that changes nothing.
  for (const name of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
    expect(canSwitchMcp(server(name), 'live', {}), name).toBe(false);
  }
  // An own key that holds something other than an entry is not an entry.
  for (const held of [null, true, 'yes', 3]) {
    expect(canSwitchMcp(server('git'), 'live', { git: held }), String(held)).toBe(false);
  }
  // An own key is one, whatever it is called. JSON is how such a key arrives.
  const parsed = JSON.parse('{"__proto__": {"enabled": true}}');
  expect(canSwitchMcp(server('__proto__'), 'live', parsed)).toBe(true);
});

test('a switch asks for the opposite of what the entry is now', async () => {
  const asked: [string, boolean][] = [];
  const toggle = async (name: string, enabled: boolean) => {
    asked.push([name, enabled]);
    return null;
  };

  expect(await flipMcp({ name: 'git', status: 'built' }, toggle)).toBeNull();
  expect(await flipMcp({ name: 'github', status: 'specified' }, toggle)).toBeNull();
  expect(asked).toEqual([
    ['git', false],
    ['github', true],
  ]);
});

test('a write that did not happen is said, with the server named and the reason given', async () => {
  const message = await flipMcp(
    { name: 'git', status: 'built' },
    async () => '/home/me/.config/opencode/opencode.json has comments.'
  );
  expect(message).toBe(
    'Could not switch git. /home/me/.config/opencode/opencode.json has comments.'
  );
});
