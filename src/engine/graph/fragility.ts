/**
 * What breaks if something goes away.
 *
 * Providers, the credentials they present, blast radius, and the single points
 * of failure a naive count would miss — two providers presenting one key are
 * not redundancy, and that is exactly the case a count calls safe.
 */
import type { Db } from '../db.ts';
import { PROVISION_EDGES } from '../ontology.ts';
import { usable } from '../assurance.ts';
import type { CapabilityRow } from '../rows.ts';

/** The columns the fragility reports read off a node. */
type CapNode = Pick<CapabilityRow, 'id' | 'name' | 'state' | 'kind' | 'lifecycle'>;

// ─── Impact Analysis ─────────────────────────────────────────────────────────

/**
 * Who supplies each capability.
 *
 * A capability with three providers survives losing one. Nothing consulted
 * these edges, so every analysis treated each provider as though it were the
 * only one — which inflates loss exactly where there is redundancy, the case
 * you most want to distinguish from a single point of failure.
 */
function providersOf(db: Db): Map<string, string[]> {
  // Selected by kind rather than by matching three English sentences. The
  // prose match was silent when it failed: an adapter writing 'Provided by
  // this server' contributed a provider the redundancy analysis could not see,
  // so a capability with two providers still reported as a single point of
  // failure and its loss still read as critical.
  const rows = db
    .prepare(
      `SELECT from_capability f, to_capability t FROM dependencies
       WHERE kind IN (${PROVISION_EDGES.map(() => '?').join(', ')})`
    )
    .all(...PROVISION_EDGES);
  const map = new Map<string, string[]>();
  for (const r of rows) {
    if (!map.has(r.t)) map.set(r.t, []);
    if (!map.get(r.t)!.includes(r.f)) map.get(r.t)!.push(r.f);
  }
  return map;
}

/**
 * What each provider authenticates with.
 *
 * Empty for a graph that declares no credentials, which is what keeps every
 * analysis below identical to what it returned before they existed.
 */
function credentialsOf(db: Db): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of db
    .prepare("SELECT from_capability f, to_capability t FROM dependencies WHERE kind = 'uses'")
    .all()) {
    if (!map.has(r.f)) map.set(r.f, []);
    if (!map.get(r.f)!.includes(r.t)) map.get(r.f)!.push(r.t);
  }
  return map;
}

/**
 * The credentials every one of these providers depends on.
 *
 * Redundancy assumes providers fail independently, and providers presenting the
 * same token do not: revoking it takes all of them at once. So the question a
 * count of providers cannot answer is whether anything is held *in common* —
 * the intersection, not the union.
 *
 * The intersection rather than any shared credential, because partial sharing
 * is genuinely not a single point of failure. Given providers holding {A},
 * {A,B} and {B}, losing A leaves the third still working and losing B leaves
 * the first — the capability survives either. Only a credential all of them
 * present takes it down alone, and reporting the chained case as fragile would
 * be the same overstatement in the other direction.
 */
function sharedCredentials(providers: string[], credsOf: Map<string, string[]>): string[] {
  if (providers.length === 0) return [];
  return (credsOf.get(providers[0]) || []).filter(c =>
    providers.every(p => (credsOf.get(p) || []).includes(c))
  );
}

/**
 * What would actually be lost if this went away.
 *
 * Only the loss of the *last* provider takes a capability down. Anything else
 * is a reduction in redundancy, which matters but is not the same claim.
 */
function analyzeImpact(db: Db, capId: string) {
  const cap = db
    .prepare('SELECT id, name, maturity_score FROM capabilities WHERE id = ?')
    .get(capId);
  if (!cap) {
    // An unknown id used to come back as a well-formed empty report — the same
    // shape a real capability with no dependents produces. A typo therefore
    // read as "nothing depends on this", which is the most dangerous possible
    // wrong answer from a blast-radius command.
    const needle = capId.includes(':') ? capId.slice(capId.indexOf(':') + 1) : capId;
    const near = db
      .prepare(
        `SELECT id FROM capabilities
         WHERE kind != 'action' AND (id LIKE ? OR lower(name) LIKE ?)
         ORDER BY length(id) LIMIT 5`
      )
      .all(`%${needle}%`, `%${needle.toLowerCase()}%`) as { id: string }[];
    return near.length
      ? { error: `No capability "${capId}" in this graph.`, did_you_mean: near.map(r => r.id) }
      : { error: `No capability "${capId}" in this graph.`, hint: 'ambit graph lists every id.' };
  }

  const deps = db
    .prepare('SELECT from_capability, to_capability, is_hard_requisite FROM dependencies')
    .all();
  const allCaps = db.prepare('SELECT id, name, maturity_score, state FROM capabilities').all();
  const capMap = new Map<string, Record<string, any>>(allCaps.map(c => [c.id, c]));
  const providers = providersOf(db);
  const credsOf = credentialsOf(db);

  /** Nothing else supplies it, so removing this ends it. */
  const isSoleProvider = (target: string) => {
    const list = providers.get(target) || [];
    return list.length > 0 && list.length === 1 && list[0] === capId;
  };
  const remaining = (target: string) => (providers.get(target) || []).filter(p => p !== capId);
  /**
   * Whether what survives this loss is actually independent. Two providers left
   * standing is not resilience if one revocation takes both, and the count on
   * its own cannot say which case you are in.
   */
  const nominal = (others: string[]) => {
    const shared = sharedCredentials(others, credsOf);
    if (others.length < 2 || shared.length === 0) return undefined;
    return capMap.get(shared[0])?.name || shared[0];
  };

  const decayed = deps
    .filter(d => d.from_capability === capId)
    .map(d => {
      const t = capMap.get(d.to_capability);
      const others = remaining(d.to_capability);
      return {
        name: t?.name || d.to_capability,
        // `is_hard_requisite` comes back from SQLite as 0 or 1, and `&&`
        // returns the operand rather than a boolean — so this field printed
        // `false` on some rows and `0` on others in the same report.
        becomes_unavailable: Boolean(d.is_hard_requisite) && isSoleProvider(d.to_capability),
        also_provided_by: others.length ? others.length : undefined,
        but_all_share: nominal(others),
      };
    });

  // Keyed by capability, not by edge. Iterating edges reported the same combo
  // once per prerequisite — "Version Control" four times for one risk.
  const risk = new Map<
    string,
    { name: string; severity: string; also_provided_by?: number; but_all_share?: string }
  >();
  for (const d of deps) {
    if (!d.to_capability.startsWith('combo:')) continue;
    if (d.from_capability !== capId) continue;
    const combo = capMap.get(d.to_capability);
    const others = remaining(d.to_capability);
    const sole = isSoleProvider(d.to_capability);
    const shared = nominal(others);
    risk.set(d.to_capability, {
      name: combo?.name || d.to_capability,
      // `nominal` rather than `redundant` where what is left over shares a
      // credential. Saying redundant there is the overstatement this whole
      // change exists to remove — the survivors are not independent, so the
      // count that makes them look safe is the reason they are not.
      severity:
        d.is_hard_requisite && sole
          ? 'critical'
          : shared
            ? 'nominal'
            : others.length
              ? 'redundant'
              : 'warning',
      also_provided_by: others.length || undefined,
      but_all_share: shared,
    });
  }

  return { capability: cap.name, decayed, combos_at_risk: [...risk.values()] };
}

/**
 * Capabilities with exactly one provider — where redundancy is absent rather
 * than merely thin. This is the question `tt bottlenecks` is often asked to
 * answer and does not: it ranks by how much depends on something, which is
 * leverage, not fragility.
 */
function singlePointsOfFailure(db: Db) {
  const providers = providersOf(db);
  const names = new Map(
    db
      .prepare('SELECT id, name, state, kind, lifecycle FROM capabilities')
      .all<CapNode>()
      .map(c => [c.id, c] as const)
  );
  const credsOf = credentialsOf(db);
  const out: any[] = [];
  for (const [target, list] of providers) {
    const t = names.get(target);
    if (!t || t.state === 'locked' || !usable(t.lifecycle)) continue; // not available; nothing to lose
    // An action conferred by a capability has one provider by definition, not
    // by fragility, and listing all of them would bury the real answers. An
    // action a *person* supplies is a different matter — one provider there is
    // exactly the finding, because only that person can do it.
    if (t.kind === 'action' && names.get(list[0])?.kind === 'capability') continue;

    if (list.length === 1) {
      out.push({
        capability: t.name,
        id: target,
        sole_provider: names.get(list[0])?.name || list[0],
        provider_id: list[0],
      });
      continue;
    }

    // Several providers, and something they all present. The count says the
    // capability is redundant and it is not: this is the case that would
    // otherwise be excluded from this report by the very fact that makes it
    // fragile.
    const shared = sharedCredentials(list, credsOf);
    for (const cred of shared) {
      out.push({
        capability: t.name,
        id: target,
        providers: list.map(p => names.get(p)?.name || p),
        sole_credential: names.get(cred)?.name || cred,
        credential_id: cred,
      });
    }
  }
  return out.length
    ? out
    : { note: 'Every reached capability has more than one provider, or none are recorded.' };
}

/**
 * What revoking each credential would cost.
 *
 * The inverse of `tt spof`: that asks which capabilities are fragile, this asks
 * which secret they are all hanging from. Rotating a token is a routine act,
 * and the useful thing to know before doing it is which capabilities stop —
 * not which providers, since a provider going down matters only where nothing
 * else supplies what it supplied.
 *
 * `ends` is the strong claim and is deliberately narrow: the credential is
 * presented by *every* provider of that capability, so revoking it leaves
 * nothing. `weakens` is everything else the credential touches, where the
 * capability survives on another provider.
 */
function credentialReport(db: Db) {
  const creds = db
    .prepare(
      "SELECT id, name, description FROM capabilities WHERE kind = 'credential' ORDER BY name"
    )
    .all<Pick<CapabilityRow, 'id' | 'name' | 'description'>>();
  if (creds.length === 0) {
    return {
      note: 'No credentials declared. Add a `credentials` block naming which providers share one.',
    };
  }
  const providers = providersOf(db);
  const credsOf = credentialsOf(db);
  const nodes = new Map(
    db
      .prepare('SELECT id, name, state, kind, lifecycle FROM capabilities')
      .all<CapNode>()
      .map(c => [c.id, c] as const)
  );
  const nameOf = (id: string) => nodes.get(id)?.name || id;

  return creds.map(cred => {
    const holders = [...credsOf.entries()].filter(([, cs]) => cs.includes(cred.id)).map(([p]) => p);
    const ends: string[] = [];
    const weakens: string[] = [];
    for (const [target, list] of providers) {
      const t = nodes.get(target);
      // Availability read the same way `tt spof` reads it, so the two surfaces
      // cannot disagree about what a revocation would cost. A capability whose
      // check is already failing is not something this credential is holding up.
      if (!t || t.state === 'locked' || !usable(t.lifecycle)) continue;
      // Same exclusion `tt spof` makes: an action conferred by a capability
      // goes down with it by definition, and listing both doubles every entry.
      if (t.kind === 'action' && nodes.get(list[0])?.kind === 'capability') continue;
      if (!list.some(p => (credsOf.get(p) || []).includes(cred.id))) continue;
      (sharedCredentials(list, credsOf).includes(cred.id) ? ends : weakens).push(t.name);
    }
    return {
      credential: cred.name,
      id: cred.id,
      held_by: holders.map(nameOf),
      ends,
      weakens,
      note: ends.length
        ? `Revoking this ends ${ends.length} reached ${ends.length === 1 ? 'capability' : 'capabilities'}.`
        : undefined,
    };
  });
}

export {
  providersOf,
  credentialsOf,
  sharedCredentials,
  analyzeImpact,
  singlePointsOfFailure,
  credentialReport,
};
