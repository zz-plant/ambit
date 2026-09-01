/**
 * The passes over things a person *declares* rather than installs.
 *
 * Authority, the people who hold it, the credentials providers present, what
 * capabilities cost and what acquiring one would take. None of this can be
 * discovered by reading a config's tool list — it is stated, and the engine's
 * job is to model it rather than infer it.
 */
import type { Db } from '../db.ts';
import { loadTechTree } from '../paths.ts';
import { edgeWriter } from './writers.ts';

/**
 * Authority, from the two places that can legitimately state it.
 *
 * The curated model says what an action is like in general — restarting a
 * container is a confirm, reading a repository is not. The runtime that would
 * execute the step says what it permits on this machine, and that is not a
 * schema Ambit invented: Hermes publishes `approvals.mode` and
 * `approvals.cron_mode`, and an adapter can hand them over in the same config
 * fragment it already hands over its MCP servers.
 *
 *   "authority": {
 *     "runtime": { "execute": "confirm", "note": "approvals: manual" },
 *     "scoped":  { "execute": { "mode": "forbidden", "scope": "scheduled" } },
 *     "capabilities": { "combo:shell-execution": { "execute": "forbidden" } }
 *   }
 *
 * Nothing here is enforced. Ambit describes authority; it does not mediate
 * action, and saying so is more useful than implying otherwise.
 */
function seedAuthority(db: Db, config: any): number {
  const grant = db.prepare(
    `INSERT OR IGNORE INTO authority (capability_id, action, mode, holder, scope, source, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const has = (id: string) => !!db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(id);
  const source = `runtime:${process.env.AMBIT_RUNTIME || 'opencode'}`;
  let count = 0;

  // Each source's grants are replaced wholesale rather than merged into.
  //
  // `mode` is not part of the uniqueness key — deliberately, since a source
  // states one mode per action — so an INSERT OR IGNORE against an existing row
  // silently kept the old one. A runtime that tightened from `autonomous` to
  // `forbidden` went on being reported as autonomous, which is the direction
  // this code is supposed to rule out by construction: never describe a system
  // as freer to act than the runtime in front of it permits. A grant a source
  // has stopped making also has to disappear, and only a delete does that.
  //
  // Only the sources this run speaks for. Seeding through the OpenCode adapter
  // must not silently drop what Hermes said about itself.
  db.prepare("DELETE FROM authority WHERE source IN ('techtree', ?)").run(source);

  // Declared on the curated model.
  const tree = loadTechTree();
  for (const node of tree.nodes || []) {
    const id = `combo:${node.id}`;
    if (!node.authority || !has(id)) continue;
    for (const [action, mode] of Object.entries<any>(node.authority)) {
      if (typeof mode !== 'string') continue; // `actions` is the map below
      grant.run(id, action, mode, '', '', 'techtree', null);
      count++;
    }
    // Per-action authority. `execute` on the action node itself, because the
    // action is the thing being permitted — reading a repository and merging to
    // its default branch are one capability and two different permissions.
    for (const [action, mode] of Object.entries<any>(node.authority.actions || {})) {
      const actionId = `act:${node.id}/${action}`;
      if (typeof mode !== 'string' || !has(actionId)) continue;
      grant.run(actionId, 'execute', mode, '', '', 'techtree', null);
      count++;
    }
  }

  // Stated by the runtime that would execute it. Held against the runtime node,
  // not copied onto each capability: a contribution made in a later run would
  // otherwise miss a grant recorded in an earlier one.
  const spec = config.authority || {};
  const runtimeId = source;
  if (has(runtimeId)) {
    for (const [action, value] of Object.entries<any>(spec.runtime || {})) {
      if (action === 'note') continue;
      const mode = typeof value === 'string' ? value : value?.mode;
      if (!mode) continue;
      grant.run(runtimeId, action, mode, runtimeId, '', source, spec.runtime.note || null);
      count++;
    }
    for (const [action, value] of Object.entries<any>(spec.scoped || {})) {
      const mode = typeof value === 'string' ? value : value?.mode;
      if (!mode) continue;
      grant.run(
        runtimeId,
        action,
        mode,
        runtimeId,
        value?.scope || '',
        source,
        value?.note || null
      );
      count++;
    }
  }

  for (const [capId, actions] of Object.entries<any>(spec.capabilities || {})) {
    if (!has(capId)) continue;
    for (const [action, value] of Object.entries<any>(actions || {})) {
      const mode = typeof value === 'string' ? value : value?.mode;
      if (!mode) continue;
      grant.run(capId, action, mode, '', value?.scope || '', source, value?.note || null);
      count++;
    }
  }

  return count;
}

/**
 * Seeds the people in the system.
 *
 * Humans are not users of the graph, they are nodes in it. They supply things
 * machines cannot manufacture — legal authority, money, physical access,
 * subjective judgement, account ownership — and a capability that needs one of
 * those is not autonomous, however complete its technical dependencies are.
 *
 *   "actors": {
 *     "kanav": {
 *       "name": "Kanav",
 *       "provides": ["physical-access", "approve-purchases"],
 *       "authorizes": ["combo:continuous-delivery"],
 *       "prefers": ["local-when-practical", "minimize-recurring-cost"]
 *     }
 *   }
 *
 * `provides` becomes a capability the person supplies. `authorizes` becomes a
 * hard prerequisite edge, which is what makes a plan able to say that a step is
 * someone's rather than the machine's. `prefers` becomes a preference row a
 * plan can match against a step's alternatives — which is how a plan knows it
 * is asking the right person, and asking them about the wrong option.
 */
function seedActors(db: Db, config: any, mapping: any, insert: any): number {
  const actors = { ...(mapping.actors || {}), ...(config.actors || {}) };
  const link = edgeWriter(db);
  const has = (id: string) => !!db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(id);
  const pref = db.prepare('INSERT OR IGNORE INTO preferences (actor_id, preference) VALUES (?, ?)');
  let count = 0;

  for (const [key, spec] of Object.entries<any>(actors)) {
    const id = key.startsWith('human:') ? key : `human:${key}`;
    const name = spec?.name || key;
    insert.run(id, name, 'social', spec?.role || 'Person in the system', 'human', 'active', 1.0);
    count++;

    // Things only this person can supply.
    for (const provided of spec?.provides || []) {
      const pid = provided.includes(':') ? provided : `act:${provided}`;
      insert.run(
        pid,
        provided.replace(/-/g, ' '),
        'social',
        `Provided by ${name}`,
        'human-action',
        'unlocked',
        1.0
      );
      link.run(id, pid, 1, 'Supplied by a person');
      count++;
    }

    // Approval as a dependency rather than a policy note. Only for capabilities
    // that exist — a typo should leave a missing edge, not a dangling one.
    for (const gated of spec?.authorizes || []) {
      const gid = gated.startsWith('combo:') || gated.includes(':') ? gated : `combo:${gated}`;
      if (has(gid)) link.run(id, gid, 1, 'Requires approval from a person');
    }

    // How this person prefers things done. Stored as data, read by planning,
    // and never interpreted here — a preference is a word matched against the
    // properties a step's alternatives carry (local vs hosted, one-off vs
    // recurring), and the plan says where they fit and where they fight.
    for (const p of spec?.prefers || []) {
      pref.run(id, String(p));
      count++;
    }
  }
  return count;
}

/**
 * Seeds what providers authenticate with.
 *
 * Redundancy was counted by provider, so three things supplying one capability
 * read as threefold redundancy. If all three present the same token, revoking
 * it takes all three down at once — and Ambit would have called the capability
 * robust right up to the moment it was not, having actively excluded it from
 * `tt spof`. A credential is the thing that makes providers fail together, so
 * it has to be in the graph for the redundancy claim to mean anything.
 *
 *   "credentials": {
 *     "github/user-token": {
 *       "name": "GitHub user token",
 *       "used_by": ["mcp:github", "tool:bash"],
 *       "note": "classic PAT, repo scope"
 *     }
 *   }
 *
 * **No secret is ever read or stored.** Only `name`, `used_by` and `note` are
 * consulted, so there is no field a value could arrive in and no column it
 * could be written to. That is the same boundary the proposal system draws
 * around executable content: refuse the shape permanently rather than gate it.
 * `note` is displayed, so it is for provenance — "classic PAT, repo scope" —
 * and not for the token.
 *
 * Declared, never inferred. Guessing which providers share an credential from
 * environment variable names would produce a redundancy claim nobody stated,
 * and a wrong one is worse here than an absent one.
 */
function seedCredentials(db: Db, config: any, mapping: any, insert: any): number {
  const credentials = { ...(mapping.credentials || {}), ...(config.credentials || {}) };
  const link = edgeWriter(db);
  const has = (id: string) => !!db.prepare('SELECT 1 AS ok FROM capabilities WHERE id = ?').get(id);
  let count = 0;

  for (const [key, spec] of Object.entries<any>(credentials)) {
    const id = key.startsWith('cred:') ? key : `cred:${key}`;
    // Only providers already in the graph. A typo should leave a credential
    // holding nothing rather than a dangling edge, exactly as `seedActors`
    // treats an authorizes target that does not exist.
    const holders: string[] = (spec?.used_by || []).filter(has);
    if (holders.length === 0) continue;

    insert.run(
      id,
      spec?.name || key,
      'meta',
      spec?.note || 'Credential',
      'credential',
      'unlocked',
      1.0
    );
    count++;
    for (const holder of holders) link.run(holder, id, 1, 'Authenticates with');
  }

  return count;
}

/**
 * Seeds the economic model from the config's `economics` and `goals` blocks.
 *
 * The config declares dollars; the table stores cents, because every later
 * comparison (acquisition vs recurring, attention vs cash) is one arithmetic
 * operation away instead of a string to parse. The blocks are vocabulary over
 * nodes that already exist:
 *
 *   "economics": { "actors": { "kanav": { "attention_value_per_hour": 250 } },
 *                  "resources": { "device:nuc": { "purchase_cost": 3000 } },
 *                  "providers": { "provider:acme": { "recurring_cost_per_month": 80 } } }
 *
 *   "goals": { "recover-production": { "name": "Recover production service",
 *               "occurrence_rate_per_month": 2, "success_value_cents": 4000,
 *               "failure_cost_cents": 50000 } }
 *
 * A metric is declared or it is not; nothing is guessed at seed time. An
 * undeclared actor has no attention value until one is declared, and the
 * opportunity engine says "estimate" rather than pretending to know.
 */
function seedEconomics(db: Db, config: any): number {
  const put = db.prepare(
    "INSERT OR REPLACE INTO economics (entity_type, entity_id, metric, value_cents, period, source) VALUES (?, ?, ?, ?, ?, 'declared')"
  );
  let count = 0;

  // The config block names the kind of thing; the period is read from the
  // metric's own name, so one block stays prose-free.
  const entityTypeOf: Record<string, string> = {
    actors: 'actor',
    resources: 'resource',
    providers: 'provider',
    services: 'service',
  };
  const periodOf = (metric: string) =>
    metric.includes('_per_hour')
      ? 'per_hour'
      : metric.includes('_per_month')
        ? 'per_month'
        : metric.includes('_per_request')
          ? 'per_request'
          : metric.includes('_per_kwh')
            ? 'per_kwh'
            : 'one_time';

  for (const [block, entityType] of Object.entries(entityTypeOf)) {
    for (const [id, metrics] of Object.entries<any>(config.economics?.[block] || {})) {
      for (const [metric, dollars] of Object.entries<any>(metrics)) {
        if (typeof dollars !== 'number') continue;
        put.run(entityType, id, metric, dollars * 100, periodOf(metric));
        count++;
      }
    }
  }

  // Goals declare dollars; the table stores cents, like every other value.
  const goal = db.prepare(
    'INSERT OR REPLACE INTO goals (id, name, description, occurrence_rate_per_month, success_value_cents, failure_cost_cents) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const [id, spec] of Object.entries<any>(config.goals || {})) {
    goal.run(
      id,
      spec?.name || id,
      spec?.description || null,
      spec?.occurrence_rate_per_month ?? null,
      spec?.success_value != null ? spec.success_value * 100 : null,
      spec?.failure_cost != null ? spec.failure_cost * 100 : null
    );
    count++;
  }

  // Budgets: what a granted action may cost, per period. Dollars in, cents out.
  const budget = db.prepare(
    'INSERT OR REPLACE INTO budgets (capability_id, action, scope, budget_cents, period, spent_cents) VALUES (?, ?, ?, ?, ?, 0)'
  );
  for (const [id, actions] of Object.entries<any>(config.budgets || {})) {
    for (const [action, spec] of Object.entries<any>(actions)) {
      if (typeof spec !== 'object' || spec === null) continue;
      budget.run(
        id,
        action,
        spec.scope || '',
        spec.budget_cents != null
          ? spec.budget_cents
          : spec.budget_dollars != null
            ? spec.budget_dollars * 100
            : 0,
        spec.period || 'month'
      );
      count++;
    }
  }

  return count;
}

/**
 * Seeds the acquisition catalog: how a capability can be acquired, compared on
 * cost, privacy, verification and rollback.
 *
 * Two sources. The config's `catalog` block declares the supply side with
 * numbers — providers, setup, one-time and recurring cost in dollars (stored
 * as cents), privacy, verification, runtimes, expected reliability, rollback.
 * And every acquisition alternative the curated model names becomes a catalog
 * row, so a capability the opportunity engine keeps proposing already has a
 * supply side to compare even before anyone declares one.
 */
function seedCatalog(db: Db, config: any): number {
  const put = db.prepare(
    `INSERT OR REPLACE INTO catalog
       (capability_id, provider, kind, setup_seconds, cost_one_time_cents, recurring_cents_per_month,
        privacy, verification, runtimes, expected_reliability, rollback, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let count = 0;

  // The curated model's alternatives: qualitative, so recurring shows as a
  // kind and no dollar figure is invented.
  const tree = loadTechTree();
  for (const n of tree.nodes || []) {
    for (const a of n.acquisition?.alternatives || []) {
      const recurring = a.recurring_cost || 'none';
      put.run(
        `combo:${n.id}`,
        a.name,
        recurring === 'monthly' ? 'subscribe' : recurring === 'per-token' ? 'buy' : 'build',
        a.setup_seconds || 0,
        null,
        null,
        a.privacy || 'local',
        a.note || null,
        null,
        null,
        a.config_patch ? 'reversible' : 'irreversible',
        'techtree'
      );
      count++;
    }
  }

  // The declared supply side, with numbers.
  for (const [id, options] of Object.entries<any>(config.catalog || {})) {
    for (const o of Array.isArray(options) ? options : [options]) {
      if (!o?.provider) continue;
      put.run(
        id,
        o.provider,
        o.kind || 'build',
        o.setup_seconds || 0,
        o.cost_one_time_dollars != null ? o.cost_one_time_dollars * 100 : null,
        o.recurring_dollars_per_month != null ? o.recurring_dollars_per_month * 100 : null,
        o.privacy || 'local',
        o.verification || null,
        Array.isArray(o.runtimes) ? o.runtimes.join(',') : o.runtimes || null,
        o.expected_reliability ?? null,
        o.rollback || null,
        'declared'
      );
      count++;
    }
  }

  return count;
}

export { seedAuthority, seedActors, seedCredentials, seedEconomics, seedCatalog };
