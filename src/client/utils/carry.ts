/**
 * What My Setup and the panel say about a tool server's carry weight.
 *
 * The figure comes from `ambit weigh`, through the tree: the page never starts
 * a server to find out. A server never weighed has no `carry`, and says
 * nothing, because that is not a weight of zero.
 */
import type { ToolCarry } from '../../shared/api';
import { carryByRuntime, type RuntimeCarry } from '../../shared/carry';
import { formatCount, formatRelativeTime } from '../../shared/format';
import type { Item } from './configImporter';

export const carryOf = (item: Item): ToolCarry | undefined =>
  item.meta?.carry as ToolCarry | undefined;

/** Each runtime's total over the given entries, heaviest runtime first. */
export function runtimeCarry(items: readonly Item[]): RuntimeCarry[] {
  return carryByRuntime(
    items.flatMap(item => {
      const carry = carryOf(item);
      return carry ? [carry] : [];
    })
  );
}

/** "about 11K tokens in Claude Code, 7.1K in Cursor". */
export function runtimeCarryLine(runtimes: readonly RuntimeCarry[]): string {
  return runtimes
    .map((r, i) =>
      i === 0
        ? `about ${formatCount(r.tokens)} tokens in ${r.runtime}`
        : `${formatCount(r.tokens)} in ${r.runtime}`
    )
    .join(', ');
}

/**
 * How long ago it was weighed, or nothing when the stored time cannot be read
 * or lies ahead of this clock, which names no interval.
 */
export function weighedAgo(measuredAt: string | undefined): string | undefined {
  if (!measuredAt) return undefined;
  const at = new Date(measuredAt.includes('T') ? measuredAt : `${measuredAt.replace(' ', 'T')}Z`);
  const ms = Date.now() - at.getTime();
  return Number.isFinite(ms) && ms >= 0 ? formatRelativeTime(at) : undefined;
}

/** "about 7.1K tokens". */
export const carryTokens = (carry: ToolCarry): string =>
  `about ${formatCount(carry.tokens)} tokens`;

/** The row's figure. "Not called" only when the ledger recorded calls to something else. */
export function carryFigure(carry: ToolCarry): string {
  return `${carryTokens(carry)}${carry.calls === 0 ? ' · not called' : ''}`;
}

/** What the figure stands for, said in full. */
export function carryDetail(carry: ToolCarry): string {
  const tools = `${carry.tools} ${carry.tools === 1 ? 'tool' : 'tools'}`;
  const parts = [
    `${tools} loaded into every session${carry.runtimes.length ? ` of ${carry.runtimes.join(', ')}` : ''}`,
  ];
  if (carry.heaviest.length && carry.tools > 1) {
    parts.push(
      `heaviest: ${carry.heaviest.map(h => `${h.name} (${formatCount(h.tokens)})`).join(', ')}`
    );
  }
  if (carry.calls === 0) parts.push('no call to it recorded in 30 days');
  else if (carry.calls) {
    parts.push(`${carry.calls} ${carry.calls === 1 ? 'call' : 'calls'} recorded in 30 days`);
  }
  const ago = weighedAgo(carry.measuredAt);
  if (ago) parts.push(`weighed ${ago}`);
  return parts.join(' · ');
}
