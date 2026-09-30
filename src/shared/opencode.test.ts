/**
 * An OpenCode config read the same way whichever major version wrote it.
 *
 * The V2 fixtures are the examples in OpenCode's own V1 migration guide, so a
 * rename there that this reader missed shows up as a node missing here.
 */
import { expect, test } from 'vitest';
import {
  configSection,
  entryInShape,
  isOpencodeV2,
  mcpEntries,
  normalizeOpencode,
  opencodeAuthority,
  parseJsonc,
} from './opencode.ts';

const V2 = {
  mcp: {
    servers: {
      playwright: {
        type: 'local',
        command: ['npx', '@playwright/mcp'],
        disabled: false,
        timeout: { catalog: 30000, execution: 30000 },
      },
      sentry: { type: 'remote', url: 'https://mcp.sentry.dev/mcp', disabled: true },
    },
  },
  agents: {
    reviewer: {
      system: 'Review for correctness...',
      model: 'anthropic/claude-sonnet-4-5#high',
      disabled: false,
    },
  },
  commands: { review: { template: 'Review changes.', subagent: true } },
  providers: {
    acme: {
      package: 'aisdk:@ai-sdk/openai-compatible',
      settings: { baseURL: 'https://llm.example.com/v1' },
      models: [{ modelID: 'fast-1', name: 'Fast One' }, { name: 'no id' }],
    },
  },
  permissions: [
    { action: 'shell', resource: 'git push *', effect: 'ask' },
    { action: 'edit', resource: '*', effect: 'allow' },
  ],
  plugins: ['opencode-example-plugin'],
};

test('comments and trailing commas are read, and nothing inside a string is taken for one', () => {
  const text = `{
    // a line comment
    "url": "https://example.com/a//b", /* a block */
    "glob": "src/**/*.ts",
    "list": [1, 2,],
  }`;
  expect(parseJsonc(text)).toEqual({
    url: 'https://example.com/a//b',
    glob: 'src/**/*.ts',
    list: [1, 2],
  });
  expect(parseJsonc('{"a": "x, }"}')).toEqual({ a: 'x, }' });
  expect(() => parseJsonc('{ not json')).toThrow();
});

test('a V2 config is read into the names every reader already knows', () => {
  expect(isOpencodeV2(V2)).toBe(true);
  const c = normalizeOpencode(V2);

  // Before this, `mcp.servers` was one server named "servers".
  expect(Object.keys(c.mcp).sort()).toEqual(['playwright', 'sentry']);
  expect(c.mcp.playwright.enabled).toBe(true);
  expect(c.mcp.sentry.enabled).toBe(false);

  expect(c.agent.reviewer).toMatchObject({
    model: 'anthropic/claude-sonnet-4-5',
    variant: 'high',
    prompt: 'Review for correctness...',
    disable: false,
  });
  expect(c.command.review.subtask).toBe(true);
  // A listed model is keyed by its id; one with no id has nothing to be known by.
  expect(Object.keys(c.provider.acme.models)).toEqual(['fast-1']);
});

test('a V1 config passes through, and a V1 server may be named "servers"', () => {
  const v1 = {
    mcp: { git: { type: 'local', command: ['git-mcp'], enabled: false } },
    agent: { writer: { model: 'acme/fast-1' } },
  };
  expect(isOpencodeV2(v1)).toBe(false);
  expect(normalizeOpencode(v1)).toEqual(v1);

  const named = { mcp: { servers: { type: 'local', command: ['x'] } } };
  expect(isOpencodeV2(named)).toBe(false);
  expect(normalizeOpencode(named).mcp.servers.command).toEqual(['x']);
  expect(mcpEntries(named)).toEqual({ bag: named.mcp, v2: false });
});

test('a file holding both names reads the V2 entry where they share one', () => {
  const c = normalizeOpencode({
    agent: { a: { description: 'v1' }, b: { description: 'only v1' } },
    agents: { a: { description: 'v2' } },
  });
  expect(c.agent.a.description).toBe('v2');
  expect(c.agent.b.description).toBe('only v1');
});

test('only a rule covering every shell command speaks for the runtime', () => {
  // `git push *` is a statement about one command, not the general rule.
  expect(opencodeAuthority(V2)).toBeUndefined();

  const v2 = {
    permissions: [
      { action: 'shell', resource: '*', effect: 'allow' },
      { action: 'shell', resource: '*', effect: 'ask' },
    ],
  };
  // The last covering rule is the one that holds.
  expect(opencodeAuthority(v2)).toMatchObject({ runtime: { execute: 'confirm' } });
  expect(opencodeAuthority({ permission: { bash: 'deny' } })).toMatchObject({
    runtime: { execute: 'forbidden' },
  });
  expect(
    opencodeAuthority({ permission: { bash: { '*': 'allow', 'rm *': 'deny' } } })
  ).toMatchObject({ runtime: { execute: 'autonomous' } });
  expect(opencodeAuthority({ permission: { edit: 'allow' } })).toBeUndefined();
  expect(opencodeAuthority({})).toBeUndefined();
});

test('a V1 patch lands where the file keeps its servers, in the file’s words', () => {
  const v2 = { mcp: { servers: { a: { type: 'local' } } } };
  const bag = configSection(v2, 'mcp', true) as Record<string, unknown>;
  expect(bag).toBe(v2.mcp.servers);
  expect(entryInShape(v2, 'mcp', { type: 'local', enabled: true })).toEqual({
    type: 'local',
    disabled: false,
  });

  const v1: Record<string, any> = {};
  expect(configSection(v1, 'mcp')).toBeUndefined();
  expect(configSection(v1, 'mcp', true)).toBe(v1.mcp);
  expect(entryInShape(v1, 'mcp', { enabled: true })).toEqual({ enabled: true });
});
