/**
 * The wire contract between the API server and the client.
 *
 * Both ends used to shape these by hand — the server building an object literal
 * per route, the store reading fields out of `await res.json()` with no type at
 * all — which made every endpoint two independent guesses that only disagreed
 * at runtime, in a browser, silently. Importing the same declarations is what
 * makes a rename a compile error instead of an empty panel.
 */
import type { InfrastructureNode, InfrastructureLink, InfrastructureFinding } from './types.ts';

/** Every route answers either its payload or `{ error }`. */
export interface ApiError {
  error: string;
}

export type ApiResult<T> = T | ApiError;

export function isApiError<T>(value: ApiResult<T>): value is ApiError {
  return typeof value === 'object' && value !== null && 'error' in value;
}

// ── GET /api/health ──────────────────────────────────────────────────────────

export interface HealthResponse {
  status: 'ok';
  configPath: string;
  configExists: boolean;
  infraManifestPath: string;
}

// ── GET /api/config, POST /api/config/apply, POST /api/config/mcp-snippet ────

export interface ConfigResponse {
  config: Record<string, unknown>;
}

/**
 * The only edits the server will make. It cannot create an entry: a new MCP
 * server carries a command the agent runtime executes, so adding one stays a
 * hand edit. See src/server/config.ts.
 */
export interface ConfigApplyRequest {
  disableMcp?: string[];
  enableMcp?: string[];
  updateAgent?: { name: string; updates: { description?: string; model?: string } };
  updateCommand?: { name: string; updates: { description?: string } };
}

export interface ConfigApplyResponse {
  ok: true;
}

export interface McpSnippetRequest {
  name: string;
  config?: Record<string, unknown>;
}

export interface McpSnippetResponse {
  configPath: string;
  snippet: string;
}

// ── GET /api/tech-tree ───────────────────────────────────────────────────────

export interface TreeItemMeta {
  /** The client renders meta generically, so extra keys have to be allowed. */
  [key: string]: unknown;
  domain: string;
  state: string;
  setupSeconds: number;
  era?: number;
  eraName?: string;
  /** Locked, but everything it requires is already reached. */
  next: boolean;
  lifecycle: string;
  lastChecked?: string;
}

/**
 * The node types the client knows how to render. The server maps a
 * capability's `category` onto this list and falls back to 'config' for
 * anything else — an unrecognised category used to reach the renderer verbatim
 * and draw as nothing.
 */
export const NODE_TYPES = [
  'framework',
  'mcp-server',
  'agent',
  'provider',
  'model',
  'command',
  'skill',
  'config',
  'possibility',
  'device',
  'service',
  'api',
  'network',
  'workflow',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const PROPOSAL_STATUSES = ['draft', 'approved', 'applied', 'rejected'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface TreeItem {
  id: string;
  name: string;
  type: NodeType;
  status: 'built' | 'specified';
  description: string;
  position: { x: number; y: number; z: number };
  meta: TreeItemMeta;
}

export interface TreeConnection {
  from: string;
  to: string;
  type: 'hard-dep' | 'soft-dep';
}

export interface TechTreeResponse {
  items: TreeItem[];
  connections: TreeConnection[];
}

// ── GET /api/proposals, POST /api/proposals/:id/approve ──────────────────────

export interface ProposalRow {
  id: string;
  goal: string;
  status: ProposalStatus;
  steps: string;
  /** The stored frontier simulation. Absent on a hand-written demo row. */
  simulated?: string;
  created_at: string;
  approved_by?: string | null;
  approved_at?: string | null;
  budget_cents?: number | null;
  expires_at?: string | null;
  approval_artifact?: string | null;
  economic_case?: string | null;
}

export interface ProposalsResponse {
  proposals: ProposalRow[];
}

/** The signed artifact. It is data the executor checks; it never carries a command. */
export interface ApprovalArtifact {
  proposal_hash: string;
  actor: string;
  budget_cents: number | null;
  scope_exclude: string[];
  expires_at: string;
  timestamp: string;
  sig: string;
}

export interface ApproveRequest {
  actor?: string;
  budgetCents?: number;
  ttlHours?: number;
}

export interface ApproveResponse {
  proposal: string;
  approved_by: string;
  artifact?: ApprovalArtifact;
}

// ── GET /api/attention ───────────────────────────────────────────────────────

export interface InterventionRow {
  capability_id: string;
  count: number;
  last_seen: string;
}

export interface AttentionResponse {
  interventions: InterventionRow[];
}

// ── GET /api/infrastructure/scan ─────────────────────────────────────────────

export interface InfrastructureScanResponse {
  generatedAt: string;
  source: string;
  nodes: InfrastructureNode[];
  links: InfrastructureLink[];
  findings: InfrastructureFinding[];
  summary: { online: number; degraded: number; offline: number; unknown: number };
}

// ── GET /api/repos/scan ──────────────────────────────────────────────────────

export interface RepoDrift {
  name: string;
  drift: number;
  driftItems: number;
  uniqueMcps: string[];
  missingMcps: string[];
  uniqueAgents: string[];
  uniqueCommands: string[];
  defaultAgent: string | null;
}

export interface RepoScanResponse {
  globalStats: {
    mcps: number;
    agents: number;
    commands: number;
    providers: number;
    totalRepos: number;
  };
  repos: RepoDrift[];
}

/** Every endpoint, keyed by path — so neither side can invent a route. */
export interface ApiRoutes {
  '/api/health': HealthResponse;
  '/api/config': ConfigResponse;
  '/api/config/apply': ConfigApplyResponse;
  '/api/config/mcp-snippet': McpSnippetResponse;
  '/api/tech-tree': TechTreeResponse;
  '/api/proposals': ProposalsResponse;
  '/api/attention': AttentionResponse;
  '/api/infrastructure/scan': InfrastructureScanResponse;
  '/api/repos/scan': RepoScanResponse;
}
