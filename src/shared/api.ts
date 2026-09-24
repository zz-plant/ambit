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

/** Whether a capability may act without asking. The engine's three modes. */
export const AUTHORITY_MODES = ['autonomous', 'confirm', 'forbidden'] as const;
export type AuthorityMode = (typeof AUTHORITY_MODES)[number];

/** A failure the runtime reported, classified by the engine, counted over a window. */
export interface FailureCount {
  class: string;
  signal: string;
  times: number;
  last: string;
}

/**
 * What a node may do without asking. `ungranted` marks a reached node no
 * execute grant names: the gate refuses it with "No grant covers ...", so its
 * mode is `forbidden`, and the flag says the refusal is waiting on a grant,
 * not one somebody made.
 */
export interface NodeAuthority {
  execute: AuthorityMode;
  observe?: AuthorityMode;
  ungranted?: true;
}

/** One action a capability confers, and the mode it resolves to. */
export interface ConferredAction {
  id: string;
  name: string;
  mode: AuthorityMode;
  ungranted?: true;
}

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
  /**
   * The nodes that supply this one, by provision edge. With one, losing it
   * ends the capability; with more, losing one only thins the redundancy,
   * which is the difference an outage simulation has to draw.
   */
  providers?: string[];
  /** The credential nodes this one presents, so shared ones can be named. */
  credentials?: string[];
  /** Declared checks that ran: how many passed, of how many. */
  reliability?: { passed: number; total: number };
  /** The effective, unscoped modes: may it act, and may it look, without asking. */
  authority?: NodeAuthority;
  /** What the runtime reported failing here in the last thirty days. */
  failures?: FailureCount[];
  /**
   * The concrete actions this capability confers, each with whether it may be
   * performed without asking. Authority is per action, so "asks before acting"
   * on the capability is the narrowest of these, and the finer answer is the
   * one an agent acts on.
   */
  actions?: ConferredAction[];
  /** Days since this capability's configuration last changed: what has stopped being tended. */
  daysSinceChange?: number;
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
  // Categories the engine actually stores. Their absence was not theoretical:
  // the tree served `tool`, `runtime` and `meta` to a client whose own type
  // did not admit them, so they reached the renderer as values it had no case
  // for. api.test.ts holds this list against what the engine can emit.
  'tool',
  'runtime',
  'meta',
  'action',
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
  /** What the edge means to the engine: provides, contributes, requires, uses. */
  kind?: string;
}

export interface TechTreeResponse {
  items: TreeItem[];
  connections: TreeConnection[];
  /** How the frontier moved this week; null before a second observation. */
  since?: LoopSince | null;
}

// ── GET /api/proposals, POST /api/proposals/:id/approve ──────────────────────

/**
 * What a person needs to decide on a proposal: what it would save, what it
 * costs, whether it can be undone, what it unlocks, and how they have decided
 * on things like it before. Composed by the server from the stored steps,
 * simulation and economic case; hand-written on the demo's rows.
 */
export interface ProposalDecision {
  setup_hours: number;
  /** Every step is a config change with a computed inverse. */
  reversible: boolean;
  /** Some step describes work only a person can do. */
  requires_person: boolean;
  recurring?: string;
  privacy?: string;
  forecast: {
    hours_month_now: number;
    hours_month_after: number;
    savings_dollars_month: number;
    confidence: string;
  } | null;
  /** What the frontier simulation says becomes reachable. */
  unlocks: string[];
  /** The record's leaning on the traits this proposal has, where it has one. */
  precedent: { trait: string; leans: string; approved: number; rejected: number }[];
}

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
  decision?: ProposalDecision;
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

export interface RejectRequest {
  actor?: string;
  reason?: string;
}

export interface RejectResponse {
  proposal: string;
  rejected_by: string;
  reason?: string;
}

// ── GET /api/briefing ────────────────────────────────────────────────────────

/** What an agent is told at connect, shown to the person it describes the machine to. */
export interface BriefingResponse {
  text: string;
  /** How many tokens the prose is allowed, so the person knows what was trimmed against. */
  budget: number;
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

// ── GET /api/loop ────────────────────────────────────────────────────────────

/**
 * One priced opportunity: the burden observed, what removing it would cost,
 * and what it would return. The engine's own `OpportunityCase` is a superset —
 * this is the part the dashboard draws.
 */
export interface LoopOpportunity {
  id: string;
  title: string;
  capability: string;
  /** The node the map selects when the row is shown there. */
  capability_id?: string;
  kind: string;
  burden: {
    interventions_month: number;
    human_hours_month: number;
    attention_dollars_month: number;
  };
  proposal: { action: string; setup_hours: number };
  expected: { human_hours_month_after: number; savings_dollars_month: number };
  /** Null when nothing is saved, so the setup never pays back. */
  payback_months: number | null;
  confidence: 'high' | 'medium' | 'low';
  acquisition_options?: {
    provider: string;
    kind: string;
    total_first_year_dollars?: number;
    privacy: string;
    /** The one the record of this person's decisions favours, where it leans. */
    favoured?: boolean;
  }[];
}

/** A capability work has asked for and never had. */
export interface LoopDemand {
  id: string;
  name: string;
  times: number;
  /** The same cause recurs: an acquisition, not an incident. */
  structural: boolean;
  /** Configured but failing its check: repair it, do not re-add it. */
  failing: boolean;
}

/**
 * The economic half of the product in one payload: what the graph can prove,
 * where a person's time went, what to buy next, and whether the last purchase
 * paid. The hosted demo builds the same shape by hand — see
 * src/client/utils/demoSnapshot.ts — so one dashboard renders both.
 */
/** What runs without a person, what does not, and what could. */
export interface LoopAuthority {
  /** Reached capabilities by the mode their execute grant resolves to. */
  autonomous: number;
  confirm: number;
  forbidden: number;
  /** Grants that have earned a threshold nobody set, with the command that sets one. */
  promotable: {
    capability: string;
    id: string;
    action: string;
    asked: number;
    evidence: string;
    command: string;
  }[];
  /** Spend delegated in advance, and how much of each ceiling is used. */
  budgets: {
    capability: string;
    action: string;
    ceiling_dollars: number;
    spent_dollars: number;
    period: string;
  }[];
  /** Targets declared as places where acting does not matter. */
  sandboxes: string[];
}

/** One capability worth reaching next, with the reason and the price. */
export interface LoopNext {
  id: string;
  capability: string;
  why: string;
  cost: string;
  /** Whether the ranking rests on recorded blocks or on structural leverage. */
  basis: 'observed' | 'structural';
  missing?: string[];
}

/** How the frontier moved since a past observation. */
export interface LoopSince {
  from: string;
  gained: string[];
  /** Became reachable although nothing providing them was added: composition. */
  emergent: string[];
  lost: string[];
  /** Still reached, no longer usable: a check started failing. */
  diminished: string[];
}

export interface LoopSnapshot {
  status: {
    reached: number;
    total: number;
    verified: number;
    failing: number;
    degraded: string[];
    spofs: string[];
    deficits: string[];
    pending: { id: string; goal: string }[];
  };
  attention: {
    interventions: number;
    reducible: {
      kind: string;
      capability: string;
      capability_id?: string;
      times: number;
      hours: number;
      suggested_fix: string;
    }[];
    keepers: {
      kind: string;
      capability: string;
      capability_id?: string;
      times: number;
      hours: number;
    }[];
  };
  opportunities: LoopOpportunity[];
  roi: {
    hours_per_year: number;
    dollars_per_year: number;
    /** Observed ÷ predicted. Null until an applied proposal has been measured. */
    accuracy: number | null;
    verdict: string;
    /** Hours a person spent in the loop, month by month, oldest first. */
    monthly_hours: { month: string; hours: number; acquired?: string }[];
    forecast: { predicted_hours: number; observed_hours: number } | null;
  };
  authority: LoopAuthority;
  next: LoopNext[];
  since: LoopSince | null;
  /** Asked for and never there, worst first. Heads the queue of what to reach. */
  demand: LoopDemand[];
}

export interface LoopResponse extends LoopSnapshot {
  /** Where the numbers came from: this machine's ledger, or the demo's illustration. */
  source: 'ledger' | 'sample';
  /** True when the ledger has recorded nothing yet, so the page explains itself. */
  empty: boolean;
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

// ── GET /api/unmapped ────────────────────────────────────────────────────────

/** One thing the agents used that no node of the map accounts for. */
export interface UnmappedEntry {
  /** The config entry the tools came from, when the tool name says which. */
  entry?: { id: string; name: string };
  tools: string[];
  lastUsed: string;
}

/**
 * What was used and is not on the map. `seen` is how many distinct tools the
 * ledger recorded in the window; zero means nothing was recorded, which the
 * page explains, not that everything used is on the map.
 */
export interface UnmappedResponse {
  days: number;
  seen: number;
  unmapped: UnmappedEntry[];
  note?: string;
  /** A .ambit/techtree.json body for a person to paste. Nothing writes it. */
  overlay?: string;
  overlay_note?: string;
}

/** Every endpoint, keyed by path — so neither side can invent a route. */
export interface ApiRoutes {
  '/api/health': HealthResponse;
  '/api/config': ConfigResponse;
  '/api/config/apply': ConfigApplyResponse;
  '/api/config/mcp-snippet': McpSnippetResponse;
  '/api/tech-tree': TechTreeResponse;
  '/api/briefing': BriefingResponse;
  '/api/proposals': ProposalsResponse;
  '/api/attention': AttentionResponse;
  '/api/loop': LoopResponse;
  '/api/unmapped': UnmappedResponse;
  '/api/infrastructure/scan': InfrastructureScanResponse;
  '/api/repos/scan': RepoScanResponse;
}
