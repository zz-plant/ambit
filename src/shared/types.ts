/**
 * Shared ontology and domain types for Ambit.
 * Single source of truth across Node engine, Bun server, MCP server, and client.
 */

export const KINDS = ['capability', 'action', 'provider', 'resource', 'actor', 'runtime'] as const;
export type NodeKind = (typeof KINDS)[number];
export type Kind = NodeKind;

export const EDGE_KINDS = ['provides', 'contributes', 'requires', 'optional', 'authorizes', 'runs_on'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const LIFECYCLES = ['unknown', 'detected', 'configured', 'verified', 'reliable', 'degraded', 'broken'] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export const STATES = ['reached', 'next', 'blocked'] as const;
export type State = (typeof STATES)[number];

export const AUTHORITY_MODES = ['autonomous', 'confirm', 'forbidden'] as const;
export type AuthorityMode = (typeof AUTHORITY_MODES)[number];

export const INTERVENTION_KINDS = ['judgment', 'authority', 'knowledge', 'physical', 'clerical', 'exception'] as const;
export type InterventionKind = (typeof INTERVENTION_KINDS)[number];

export const AFFORDANCE_DOMAINS = [
  'digital',
  'cognitive',
  'physical',
  'social',
  'institutional',
  'economic',
  'machine-composed-human',
] as const;
export type AffordanceDomain = (typeof AFFORDANCE_DOMAINS)[number];

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

export interface ContractAction {
  id: string;
  verify?: string;
}
