import { test, expect } from 'vitest';
import { importConfig } from './configImporter';

// Every item needs meta.domain — without it CivTree drops the item into the
// 'meta' column and the whole era tree collapses to a single stripe.
test('every imported item gets a domain', () => {
  const { items } = importConfig({
    mcp: { cloudflare: { type: 'remote', url: 'https://mcp.cloudflare.com/mcp' } },
    agent: { oracle: { description: 'debugging agent' } },
    command: { deploy: { description: 'ship it' } },
    skills: { paths: ['~/.agents/skills/vitest'] },
    provider: { anthropic: { models: { opus: { name: 'Opus' } } } },
  });

  expect(items.length).toBeGreaterThan(0);
  for (const item of items) {
    expect(typeof item.meta.domain).toBe('string');
    expect(item.meta.domain).not.toBe('');
  }
});

test('domains come from names, not just types', () => {
  const { items } = importConfig({
    mcp: { cloudflare: { type: 'remote' }, tailscale: {}, playwright: {} },
  });
  const domain = (id: string) => items.find(i => i.id === id)?.meta.domain;

  expect(domain('mcp:cloudflare')).toBe('backend');
  expect(domain('mcp:tailscale')).toBe('infra');
  expect(domain('mcp:playwright')).toBe('frontend');
});

test('disabled MCP servers import as specified, not built', () => {
  const { items, connections } = importConfig({ mcp: { off: { enabled: false } } });
  expect(items.find(i => i.id === 'mcp:off')?.status).toBe('specified');
  expect(connections.some(c => c.to === 'mcp:off')).toBe(false);
});
