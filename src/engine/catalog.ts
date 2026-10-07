import { readFileSync } from 'node:fs';
import type { Migratable } from './migrate.ts';
import { techTreePath } from './paths.ts';
import type { CatalogRow } from './rows.ts';

/**
 * The acquisition catalog: the supply side for a capability, compared.
 *
 * The opportunity engine proposes that something be built, bought or
 * subscribed; this answers *how*. Every row is one way to acquire the
 * capability — build it, buy it, subscribe, delegate, hire, reuse existing
 * hardware — with the numbers a comparison needs: setup, one-time and
 * recurring cost, privacy, verification, runtimes, expected reliability,
 * rollback. Where a figure is unknown it is reported as unknown, not guessed.
 *
 * Demand first: the catalog fills in for capabilities the opportunity engine
 * keeps proposing, not an invented marketplace.
 */

/**
 * The ways a capability can be acquired, ranked by total first-year cost.
 *
 *   ambit catalog <capability>
 */
function catalogReport(db: Migratable, capabilityId?: string) {
  if (!capabilityId) return { error: 'Usage: ambit catalog <capability>' };
  const id =
    capabilityId.startsWith('combo:') || capabilityId.includes(':')
      ? capabilityId
      : `combo:${capabilityId}`;

  const rows = db
    .prepare(
      `SELECT provider, kind, setup_seconds, cost_one_time_cents, recurring_cents_per_month,
            privacy, verification, runtimes, expected_reliability, rollback, source
     FROM catalog WHERE capability_id = ? ORDER BY provider`
    )
    .all<Omit<CatalogRow, 'id' | 'capability_id'>>(id);
  if (rows.length === 0) {
    return {
      capability: id,
      note: 'No acquisition options catalogued. Declare a catalog block in the config, or a techtree alternative.',
      options: [],
    };
  }

  const dollars = (cents: number | null) => (cents == null ? undefined : Math.round(cents) / 100);
  const setupHours = (s: number) =>
    s >= 3600 ? `${(s / 3600).toFixed(1)}h` : `${Math.round(s / 60)}m`;

  const options = rows
    .map(r => {
      const hasCost = r.cost_one_time_cents != null || r.recurring_cents_per_month != null;
      const oneTime = r.cost_one_time_cents || 0;
      const recurring = r.recurring_cents_per_month || 0;
      const firstYear = hasCost ? oneTime + recurring * 12 : null;
      return {
        provider: r.provider,
        kind: r.kind,
        setup: setupHours(r.setup_seconds),
        cost_one_time_dollars: dollars(r.cost_one_time_cents),
        recurring_dollars_per_month: dollars(r.recurring_cents_per_month),
        total_first_year_dollars: firstYear == null ? undefined : Math.round(firstYear) / 100,
        privacy: r.privacy,
        verification: r.verification || undefined,
        runtimes: r.runtimes || undefined,
        expected_reliability: r.expected_reliability,
        rollback: r.rollback || undefined,
        source: r.source,
      };
    })
    .sort(
      (a, b) => (a.total_first_year_dollars ?? Infinity) - (b.total_first_year_dollars ?? Infinity)
    );

  return {
    capability: id,
    options,
    note: 'ranked by total first-year cost (one-time + 12×recurring). Dollars are declared; where none is declared the figure is absent, not zero.',
  };
}

/**
 * The curated tree as it ships. A project overlay is a file in the working
 * directory, so it is not read here: see `installText`.
 */
function shippedTree(): any {
  try {
    return JSON.parse(readFileSync(techTreePath(), 'utf8'));
  } catch {
    return { nodes: [] };
  }
}

/**
 * The entry that installs one catalogued option, as text for a person to paste.
 *
 * Only an alternative the curated tree gave a `config_patch` has one, and the
 * catalog does not store it: a patch names a command, and a row that carried
 * one would travel with the graph. It is read from the tree when asked for, in
 * the shape `/api/config/mcp-snippet` returns, and never applied by anything.
 *
 * It comes from the tree that ships with Ambit and never from a project
 * overlay. An overlay is data that can arrive with a cloned repository, and the
 * page would be offering whatever command it named as the way to install
 * something; the overlay is documented as naming none, and this keeps it so.
 *
 * The row has to say it came from the tree and is reversible, which is how the
 * seed records that the alternative had a patch. Two alternatives can share a
 * name, and the catalog keeps the later; without that check the earlier one's
 * patch would be shown against the other's row.
 */
function installText(
  capabilityId: string,
  option: { provider: string; source?: string; rollback?: string }
): string | undefined {
  if (option.source !== 'techtree' || option.rollback !== 'reversible') return undefined;
  const node = (shippedTree().nodes || []).find((n: any) => `combo:${n.id}` === capabilityId);
  const alternative = (node?.acquisition?.alternatives || []).find(
    (a: any) => a.name === option.provider && a.config_patch
  );
  return alternative ? JSON.stringify(alternative.config_patch, null, 2) : undefined;
}

export { catalogReport, installText, shippedTree };
