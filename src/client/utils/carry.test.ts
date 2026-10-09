/**
 * What the page says about a tool server's carry weight: the figure, the
 * sentence behind it, and each runtime's total, which must be the CLI's.
 */
import { expect, test } from 'vitest';
import type { ToolCarry } from '../../shared/api';
import type { Item } from './configImporter';
import { carryDetail, carryFigure, runtimeCarry, runtimeCarryLine, weighedAgo } from './carry';

const carry = (over: Partial<ToolCarry> = {}): ToolCarry => ({
  tokens: 7_100,
  tools: 26,
  measuredAt: '2026-10-01 12:00:00',
  runtimes: ['Claude Code'],
  heaviest: [
    { name: 'create_issue', tokens: 1_000 },
    { name: 'search_code', tokens: 600 },
  ],
  ...over,
});

const server = (id: string, c?: ToolCarry): Item => ({
  id: `mcp:${id}`,
  name: id,
  type: 'mcp-server',
  status: 'built',
  description: '',
  position: { x: 0, y: 0, z: 0 },
  meta: c ? { carry: c } : {},
});

test('each runtime carries its own servers, and one never weighed adds nothing', () => {
  const items = [
    server('github', carry({ runtimes: ['Claude Code', 'Cursor'] })),
    server('notion', carry({ tokens: 2_000 })),
    server('unweighed'),
  ];
  const totals = runtimeCarry(items);
  expect(totals).toEqual([
    { runtime: 'Claude Code', tokens: 9_100, servers: 2 },
    { runtime: 'Cursor', tokens: 7_100, servers: 1 },
  ]);
  expect(runtimeCarryLine(totals)).toBe('about 9.1K tokens in Claude Code, 7.1K in Cursor');
});

test('"not called" is said only when the ledger saw calls to something else', () => {
  expect(carryFigure(carry())).toBe('about 7.1K tokens');
  expect(carryFigure(carry({ calls: 0 }))).toBe('about 7.1K tokens · not called');
  expect(carryDetail(carry({ calls: 0 }))).toContain('no call to it recorded in 30 days');
  expect(carryDetail(carry({ calls: 3 }))).toContain('3 calls recorded in 30 days');
  expect(carryDetail(carry())).not.toContain('call');
});

test('the detail names the heaviest tools, and a lone tool is not called the heaviest', () => {
  expect(carryDetail(carry())).toMatch(
    /^26 tools loaded into every session of Claude Code · heaviest: create_issue \(1K\), search_code \(600\)/
  );
  expect(carryDetail(carry({ tools: 1 }))).not.toContain('heaviest');
});

test('a measurement time this clock cannot place names no interval', () => {
  expect(weighedAgo(undefined)).toBeUndefined();
  expect(weighedAgo('not a time')).toBeUndefined();
  expect(weighedAgo('2999-01-01 00:00:00')).toBeUndefined();
  expect(weighedAgo('2026-10-01 12:00:00')).toMatch(/ago$/);
});
