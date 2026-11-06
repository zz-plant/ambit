/**
 * Shared ontology and domain types for Ambit.
 * Single source of truth across Node engine, Bun server, MCP server, and client.
 */

export const KINDS = [
  'capability',
  'action',
  'provider',
  'resource',
  'actor',
  'runtime',
  'credential',
] as const;
export type NodeKind = (typeof KINDS)[number];
export type Kind = NodeKind;

/**
 * Kinds that are not part of the frontier.
 *
 * A credential is not something the system can do; it is part of how a provider
 * reaches what it supplies. Counting one would report acquiring a token as
 * acquiring a capability — and because nothing `provides` a credential, the
 * ledger's vocabulary rule cannot catch it: `ledgerSince` classifies a new node
 * with no providers as `gained`, so declaring three credentials on an unchanged
 * machine would read as three capabilities gained.
 *
 * Excluding one new kind leaves every existing kind counted exactly as before,
 * so a snapshot taken now stays comparable with one taken before credentials
 * existed. That comparability is the whole value of the ledger.
 *
 * A person is not something the system can do either. Counting one made the
 * first approval from the page, which declares the person at the browser,
 * read as a capability gained that week and move every reach count by one.
 * What a person supplies is a node of its own and is still counted.
 */
export const NON_FRONTIER_KINDS: NodeKind[] = ['credential', 'actor'];

export const EDGE_KINDS = [
  'provides',
  'contributes',
  'requires',
  'optional',
  'authorizes',
  'runs_on',
  'uses',
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const STATES = ['reached', 'next', 'blocked'] as const;
export type State = (typeof STATES)[number];

export const AUTHORITY_MODES = ['autonomous', 'confirm', 'forbidden'] as const;
export type AuthorityMode = (typeof AUTHORITY_MODES)[number];

export interface InfrastructureNode {
  id: string;
  name: string;
  kind: 'device' | 'service' | 'api' | 'network' | 'workflow';
  status: 'online' | 'degraded' | 'offline' | 'unknown';
  description: string;
  meta?: Record<string, unknown>;
}

export interface InfrastructureLink {
  from: string;
  to: string;
  type: string;
}

export type InfraHealth = 'online' | 'degraded' | 'offline' | 'unknown';

export interface InfrastructureFinding {
  severity: 'warn' | 'info' | 'error';
  message: string;
  relatedIds?: string[];
}

export interface InfrastructureScan {
  generatedAt: string;
  source: string;
  nodes: InfrastructureNode[];
  links: InfrastructureLink[];
  findings: InfrastructureFinding[];
  summary: { online: number; degraded: number; offline: number; unknown: number };
}
