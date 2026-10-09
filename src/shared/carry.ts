/**
 * What a loadout carries, added up per runtime.
 *
 * Each runtime loads its own servers' tool lists into its own sessions, so the
 * figure that means something is per runtime: a server two runtimes declare is
 * carried twice, once by each, and a total across runtimes describes a session
 * nobody runs. `ambit weigh` and My Setup both add up with this, so the
 * terminal and the page say the same number.
 */
export interface Carried {
  tokens: number;
  /** The runtimes whose configs carry it, as their labels. */
  runtimes: readonly string[];
}

export interface RuntimeCarry {
  runtime: string;
  tokens: number;
  servers: number;
}

/** Each runtime's weighed servers and their total, heaviest runtime first. */
export function carryByRuntime(servers: readonly Carried[]): RuntimeCarry[] {
  const by = new Map<string, { tokens: number; servers: number }>();
  for (const s of servers) {
    for (const runtime of s.runtimes) {
      const total = by.get(runtime) ?? { tokens: 0, servers: 0 };
      total.tokens += s.tokens;
      total.servers += 1;
      by.set(runtime, total);
    }
  }
  return [...by]
    .map(([runtime, t]) => ({ runtime, ...t }))
    .sort((a, b) => b.tokens - a.tokens || a.runtime.localeCompare(b.runtime));
}
