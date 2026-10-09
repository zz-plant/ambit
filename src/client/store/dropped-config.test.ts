/**
 * Mapping a config the browser was handed.
 *
 * `loadFromJSON` existed in the store and nothing called it: no drop target,
 * no file picker, no window global — so the answer to "what does this look
 * like for my setup" was "clone the repository". It now backs the welcome
 * screen's drop zone, which means it has to tell an agent config from a graph
 * export, and both from a file that is neither.
 */
import { beforeEach, expect, test } from 'vitest';
import { useAmbitStore } from './ambitStore';

beforeEach(() => {
  useAmbitStore.setState({ items: [], connections: [], demo: true });
});

test('an agent config is mapped in the browser, with no engine behind it', () => {
  const ok = useAmbitStore.getState().loadFromJSON(
    JSON.stringify({
      mcp: { github: { type: 'local', command: ['gh', 'mcp'] } },
      agent: { oracle: { description: 'debugging' } },
    })
  );

  expect(ok).toBe(true);
  const { items, demo } = useAmbitStore.getState();
  expect(items.map(i => i.id)).toContain('mcp:github');
  expect(items.map(i => i.id)).toContain('agent:oracle');
  // What is on screen is now the visitor's own setup, not the sample.
  expect(demo).toBe(false);
});

test('an `ambit graph` export is drawn as it stands', () => {
  const ok = useAmbitStore.getState().loadFromJSON(
    JSON.stringify({
      items: [{ id: 'combo:deploy', name: 'Deploy', type: 'possibility' }],
      connections: [{ from: 'combo:deploy', to: 'combo:deploy' }],
    })
  );

  expect(ok).toBe(true);
  const { items, connections } = useAmbitStore.getState();
  expect(items[0]).toMatchObject({ id: 'combo:deploy', status: 'built' });
  expect(connections[0].type).toBe('connects');
});

test('anything else is refused rather than drawn as an empty graph', () => {
  const state = useAmbitStore.getState();
  expect(state.loadFromJSON('not json at all')).toBe(false);
  expect(state.loadFromJSON('{"unrelated":true}')).toBe(false);
  expect(state.loadFromJSON('[]')).toBe(false);
  // A refusal leaves the view alone; it does not blank it.
  expect(useAmbitStore.getState().items).toEqual([]);
});

test('an mcpServers config is mapped too, the block most runtimes write', () => {
  // Claude Desktop, Claude Code, Cursor, Windsurf, Gemini CLI, Cline and Roo
  // Code all keep their servers under `mcpServers`. The drop zone once refused
  // every one of them.
  const ok = useAmbitStore.getState().loadFromJSON(
    JSON.stringify({
      mcpServers: {
        github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
        linear: { url: 'https://mcp.linear.app/sse' },
        old: { command: 'old-server', disabled: true },
      },
    })
  );

  expect(ok).toBe(true);
  const { items } = useAmbitStore.getState();
  const byId = new Map(items.map(i => [i.id, i]));
  expect(byId.get('mcp:github')?.meta.command).toEqual([
    'npx',
    '-y',
    '@modelcontextprotocol/server-github',
  ]);
  expect(byId.get('mcp:linear')?.meta.type).toBe('remote');
  expect(byId.get('mcp:old')?.status).toBe('specified');
  // The file is not an OpenCode config, so its root does not claim to be one.
  expect(byId.get('runtime:opencode')?.name).toBe('Your MCP client');
});

test('an empty mcpServers block is refused, not drawn as a lone runtime', () => {
  expect(useAmbitStore.getState().loadFromJSON('{"mcpServers":{}}')).toBe(false);
});

test('a pasted config is placed on the tree, and the sample it replaced leaves with it', () => {
  // The paste used to end on a list and a note that the map needed the
  // engine, so the demo's question, what would one more step open, went
  // unanswered for the setup the visitor cared about.
  useAmbitStore.setState({
    proposals: [{ id: 'sample' } as never],
    history: { ticks: [], movedSinceLast: null },
  });
  const ok = useAmbitStore
    .getState()
    .loadFromJSON(JSON.stringify({ mcpServers: { github: { command: 'gh-mcp' } } }));

  expect(ok).toBe(true);
  const { items, reading, proposals, history } = useAmbitStore.getState();
  const byId = new Map(items.map(i => [i.id, i]));
  expect(byId.get('combo:tool-protocol')?.status).toBe('built');
  expect(byId.get('combo:version-control')?.meta.providers).toEqual(['mcp:github']);
  // The client's own model is counted, and the card says it was.
  expect(byId.get('combo:hosted-inference')?.status).toBe('built');
  expect(reading).toEqual({
    runtime: 'Your MCP client',
    named: false,
    entries: 1,
    model: "Your client's model",
    picked: false,
  });
  expect(byId.get('combo:embeddings')?.meta.next).toBe(true);
  expect(proposals).toEqual([]);
  expect(history).toBeNull();
});

test("~/.claude.json is read as Claude Code's, servers under a project included", () => {
  const ok = useAmbitStore.getState().loadFromJSON(
    JSON.stringify({
      numStartups: 4,
      mcpServers: { github: { command: 'gh-mcp' } },
      projects: { '/work/app': { mcpServers: { linear: { url: 'https://mcp.linear.app/sse' } } } },
    })
  );

  expect(ok).toBe(true);
  const { items, reading } = useAmbitStore.getState();
  const ids = items.map(i => i.id);
  expect(ids).toContain('runtime:claude-code');
  expect(ids).toContain('mcp:linear');
  expect(ids).toContain('provider:anthropic');
  expect(reading?.runtime).toBe('Claude Code');
  expect(items.find(i => i.id === 'combo:issue-tracking')?.status).toBe('built');
});

test('a Claude Code install with no server yet still has an ambit to place', () => {
  expect(useAmbitStore.getState().loadFromJSON('{"numStartups":1}')).toBe(true);
  const { items } = useAmbitStore.getState();
  expect(items.find(i => i.id === 'combo:tool-protocol')?.meta.next).toBe(true);
});

test('a config that names its own model is not given a second one', () => {
  useAmbitStore
    .getState()
    .loadFromJSON(
      JSON.stringify({ mcp: { github: { type: 'local' } }, provider: { ollama: { models: {} } } })
    );
  const { items, reading } = useAmbitStore.getState();
  expect(items.filter(i => i.type === 'provider').map(i => i.id)).toEqual(['provider:ollama']);
  expect(reading?.model).toBeNull();
});
