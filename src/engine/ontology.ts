/**
 * What kind of thing a node is, and what a relation between two of them means.
 *
 * Everything in `capabilities` was distinguished only by an id prefix and a
 * loose `category` string, and every edge carried its meaning in a free-text
 * `description`: `providersOf` matched three English sentences, so an adapter
 * that phrased one differently dropped a provider out of impact and
 * single-point-of-failure analysis without anything failing.
 *
 * Ids are deliberately unchanged. `combo:version-control` and `mcp:git` keep
 * theirs, because every stored frontier snapshot records ids and the ledger's
 * whole value is that its history is continuous. Kind is a column, not a
 * prefix — which does mean an id no longer tells you what it is, and callers
 * must read `kind` rather than pattern-match the prefix.
 */

/**
 * capability  an action the system can bring about — the coarse curated nodes
 * action      one concrete thing a capability can do, or that a person supplies
 * provider    a thing that supplies a capability: an MCP server, a skill, a tool
 * resource    a thing a provider needs in order to supply it: a model, an
 *             inference endpoint, a machine
 * actor       a person, who supplies authority, money, judgement, physical access
 * runtime     an agent runtime, which contributes providers rather than owning them
 */
export const KINDS = ['capability', 'action', 'provider', 'resource', 'actor', 'runtime'] as const;
export type Kind = (typeof KINDS)[number];

/**
 * provides     from supplies to. The relation redundancy is counted over.
 * contributes  a runtime configured this provider. Provision, with attribution.
 * requires     to cannot be reached without from.
 * optional     from strengthens to without being necessary.
 * authorizes   from is a person whose approval to depends on.
 * runs_on      to executes on or is served by from.
 */
export const EDGE_KINDS = ['provides', 'contributes', 'requires', 'optional', 'authorizes', 'runs_on'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

/** Prefixes carry no meaning of their own now; this is the one place that reads them. */
const PREFIX_KIND: Record<string, Kind> = {
  combo: 'capability',
  act: 'action',
  human: 'actor',
  runtime: 'runtime',
  // `provider:` is an inference endpoint — Ollama, Anthropic — not a provider
  // in this vocabulary's sense. It serves models, so it is a resource. The
  // collision is unfortunate and predates the split; the column disambiguates.
  provider: 'resource',
  model: 'resource',
  device: 'resource',
};

const CATEGORY_KIND: Record<string, Kind> = {
  combo: 'capability',
  'human-action': 'action',
  human: 'actor',
  runtime: 'runtime',
  provider: 'resource',
  model: 'resource',
  device: 'resource',
  service: 'resource',
};

/**
 * The kind of an existing row, from whatever the row already carries.
 *
 * Category wins over prefix where both are known, because a config mapping can
 * name a key anything while categories come from the seeder. Everything
 * unrecognised is a provider: an MCP server, a skill or a command is the
 * default thing a config file contains.
 */
export function kindOf(id: string, category?: string): Kind {
  if (category && CATEGORY_KIND[category]) return CATEGORY_KIND[category];
  const prefix = id.slice(0, id.indexOf(':'));
  return PREFIX_KIND[prefix] || 'provider';
}

/** The edge kind for the descriptions written before edges were typed. */
const DESCRIPTION_KIND: Record<string, EdgeKind> = {
  'Provides this capability': 'provides',
  'Provides this action': 'provides',
  'Supplied by a person': 'provides',
  'Contributed by runtime': 'contributes',
  'Tech tree prerequisite': 'requires',
  'Hard prerequisite': 'requires',
  'Strengthens this capability': 'optional',
  'Soft prerequisite': 'optional',
  'Requires approval from a person': 'authorizes',
  'Model served by provider': 'runs_on',
  'Agent pinned to model': 'runs_on',
  'Agent pinned to provider': 'runs_on',
  'Hosts this service': 'runs_on',
  'Controls this service': 'runs_on',
};

/**
 * The edge kind for a pre-existing row.
 *
 * `is_hard_requisite` is the fallback rather than the primary signal: it says
 * how much the edge matters, not what it means, and a provides edge and a
 * prerequisite edge are both hard.
 */
export function edgeKindOf(description: string | null | undefined, isHard: number | boolean): EdgeKind {
  return (description && DESCRIPTION_KIND[description]) || (isHard ? 'requires' : 'optional');
}

/** Relations that count as supplying a capability, for redundancy and impact. */
export const PROVISION_EDGES: EdgeKind[] = ['provides', 'contributes'];
