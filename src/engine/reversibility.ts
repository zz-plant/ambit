/**
 * What stands between an acquisition and a person having to do it.
 *
 * `ambit apply` refuses any step without a computed inverse, and that refusal
 * is the strongest safety property in the project: nothing can change the
 * environment unless the undo was worked out first. It is also, read the other
 * way, the exact list of what the agent cannot do for itself. Every capability
 * whose acquisition gains a reversible recipe is one more thing a person no
 * longer has to sit down and install.
 *
 * So reversibility is not only a safety property. It is the growth lever, and
 * this report makes the investment visible: which unreached capabilities would
 * become applicable if their acquisition were expressed as a declarative patch,
 * ranked by how much each would unblock.
 */
import type { Db } from './db.ts';
import { loadTechTree } from './paths.ts';
import { usable } from './assurance.ts';
import { catalogReport } from './catalog.ts';

interface Alternative {
  name?: string;
  config_patch?: unknown;
  setup_seconds?: number;
  privacy?: string;
  recurring_cost?: string;
}

/**
 * Unreached capabilities, split by whether acquiring one could ever be applied
 * without a person.
 *
 * A capability whose every alternative needs an installer or a running service
 * is not a gap in Ambit; it is work that genuinely requires hands. The useful
 * distinction is between those and the ones that are only manual because nobody
 * has written the patch yet.
 */
function reversibilityReport(db: Db) {
  let tree: any;
  try {
    tree = loadTechTree();
  } catch {
    return { error: 'No curated model to read acquisition recipes from.' };
  }

  const caps = db
    .prepare(
      `SELECT id, name, state, lifecycle, unlock_cost_setup FROM capabilities WHERE kind = 'capability'`
    )
    .all<any>();
  const byId = new Map(caps.map(c => [c.id, c]));
  const reached = (c: any) => c && c.state !== 'locked' && usable(c.lifecycle);

  const dependents = new Map<string, number>();
  for (const d of db
    .prepare(
      "SELECT from_capability f, to_capability t FROM dependencies WHERE is_hard_requisite = 1 AND to_capability LIKE 'combo:%'"
    )
    .all<{ f: string; t: string }>()) {
    dependents.set(d.f, (dependents.get(d.f) || 0) + 1);
  }

  const applicable: any[] = [];
  const manual: any[] = [];

  for (const node of tree.nodes || []) {
    const id = `combo:${node.id}`;
    const cap = byId.get(id);
    if (!cap || reached(cap)) continue;
    // Alternatives hang off the acquisition recipe, which is also where the
    // absence of one is meaningful: a capability with no recipe at all is a
    // different investment from one whose recipes all need hands.
    //
    // The catalog is consulted as well, because it also holds alternatives
    // declared in config rather than in the curated model — reading only the
    // model would report "no acquisition recipe at all" about a capability
    // somebody had catalogued by hand. Only the model carries patches, so the
    // reversible count still comes from there.
    const alternatives: Alternative[] = node.acquisition?.alternatives || [];
    const catalogued = catalogReport(db, id) as any;
    const catalogCount = Array.isArray(catalogued?.options) ? catalogued.options.length : 0;
    const withPatch = alternatives.filter(a => a.config_patch);
    const entry = {
      capability: node.name || node.id,
      id,
      unblocks: dependents.get(id) || 0,
      setup: node.setup_seconds ? `${Math.round(node.setup_seconds / 60)}m` : 'unknown',
      alternatives: Math.max(alternatives.length, catalogCount),
      reversible_alternatives: withPatch.length,
      hint: node.hint,
    };
    if (withPatch.length) applicable.push(entry);
    else
      manual.push({
        ...entry,
        // Two different investments, and the report should not blur them: one
        // needs a patch written, the other needs the recipe itself.
        blocker: Math.max(alternatives.length, catalogCount)
          ? 'the recipes exist and none of them is a config change'
          : 'no acquisition recipe at all',
      });
  }

  const rank = (a: any, b: any) => b.unblocks - a.unblocks;
  applicable.sort(rank);
  manual.sort(rank);

  return {
    summary: `${applicable.length} of ${applicable.length + manual.length} unreached capabilities could be applied without a person`,
    applicable_now: applicable.slice(0, 10),
    needs_a_recipe: manual.slice(0, 10),
    note: manual.length
      ? 'Each of these is manual because its acquisition has no declarative patch, not because it is dangerous. A patch with a computable inverse turns an afternoon of work into an approval, which is the highest-leverage contribution this repository takes.'
      : 'Every unreached capability has a reversible acquisition. Nothing here needs hands.',
    why_it_matters:
      'apply refuses any step without a computed inverse, so this list is also the list of what an agent can never do for itself. Reversibility is the safety property and the growth lever at once.',
    how: 'An alternative earns an inverse by carrying a `config_patch` in src/engine/techtree.json. `inverseOf` derives the undo from it: removing what it adds, restoring what it overwrites.',
  };
}

export { reversibilityReport };
