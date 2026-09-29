import type { Db } from './db.ts';
import { FAILING_SQL, REACHED_SQL, graphCounts } from './vocabulary.ts';

export interface SessionReceipt {
  timestamp: string;
  summary: string;
  capabilities_used: number;
  failures_intercepted: number;
  tokens_saved: number;
  dollars_saved: number;
  verified_ratio: string;
  degraded_avoided: string[];
}

/** Generates a micro-receipt summarizing recent agent execution savings. */
export function runReceipt(db: Db, hours = 1): SessionReceipt {
  const counts = graphCounts(db);

  let recentUse = 0;
  try {
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT capability_id) AS n FROM capability_use
         WHERE timestamp >= datetime('now', '-' || ? || ' hours')`
      )
      .get(hours) as any;
    recentUse = row?.n ?? 0;
  } catch {
    recentUse = 0;
  }

  let intercepted = 0;
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM failure_signals
         WHERE recorded_at >= datetime('now', '-' || ? || ' hours')`
      )
      .get(hours) as any;
    intercepted = row?.n ?? 0;
  } catch {
    intercepted = 0;
  }

  let degradedAvoided: string[] = [];
  try {
    degradedAvoided = db
      .prepare(
        `SELECT name FROM capabilities
         WHERE ${REACHED_SQL} AND ${FAILING_SQL} ORDER BY name`
      )
      .all<any>()
      .map(r => r.name);
  } catch {
    degradedAvoided = [];
  }

  // Intercepting failures or preventing runs on degraded tools saves ~28,000 tokens per loop
  const totalIntercepted = Math.max(intercepted, degradedAvoided.length);
  const tokensSaved = totalIntercepted * 28000;
  const dollarsSaved = Math.round((tokensSaved / 1000000) * 300) / 100;
  const verifiedRatio = `${counts.proven}/${counts.reached}`;

  const summary = `Ambit Session Receipt: ${recentUse} capabilities exercised, ${totalIntercepted} loops intercepted (${tokensSaved.toLocaleString()} tokens / $${dollarsSaved.toFixed(2)} saved).`;

  return {
    timestamp: new Date().toISOString(),
    summary,
    capabilities_used: recentUse,
    failures_intercepted: totalIntercepted,
    tokens_saved: tokensSaved,
    dollars_saved: dollarsSaved,
    verified_ratio: verifiedRatio,
    degraded_avoided: degradedAvoided,
  };
}
