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
  /** Where its execute grant stands on the rungs a grant climbs, and what moves it. */
  ladder?: AuthorityLadder;
}

/**
 * The second tree. A grant climbs from no grant, to asking first, to a
 * threshold a person set, to unattended, to unattended under a ceiling; it
 * climbs only by a person's command or against a threshold one set, and it
 * drops on a single failing check with nobody asked. A refusal is on no rung,
 * since a refusal takes no threshold.
 */
export interface AuthorityLadder {
  rung: 'ungranted' | 'confirm' | 'threshold' | 'autonomous' | 'budgeted' | 'forbidden';
  /** The rung's own reading: how far a threshold has got, since when, the ceiling. */
  note?: string;
  /** What moves it one rung up, for a person to paste. Absent at the top and on a refusal. */
  next?: { label: string; command: string };
}

/** One action a capability confers, and the mode it resolves to. */
export interface ConferredAction {
  id: string;
  name: string;
  mode: AuthorityMode;
  ungranted?: true;
}

/** How many runs of a check `meta.history` carries, and so how many slots a strip draws. */
export const CHECK_HISTORY_RUNS = 14;

/**
 * One run of a declared check. `id` is its row in the evidence ledger, which
 * orders runs where a timestamp cannot, since that resolves to the second and a
 * batch of checks lands inside one. It also orders a failure on one node against
 * a failure on another, which a reader picking the worst of several has to do.
 */
export interface CheckRun {
  id: number;
  passed: boolean;
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
  /** The last runs of its check, oldest first. Absent when none has run. */
  history?: CheckRun[];
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
  /**
   * Times work was recorded blocked on it while it was missing: the pressure
   * behind a next step, which the map draws as a part-filled node. Absent when
   * none was recorded.
   */
  blocks?: number;
  /**
   * The affordance domains the engine derives from structure: institutional
   * (a person must approve it), economic (an acquisition costs every month),
   * cognitive (a person supplies it), physical (it runs on a device), and
   * machine-composed-human (a person and a machine supply it together).
   */
  structure?: string[];
  /** The people who approve or supply it, by name. */
  people?: string[];
  /** The devices its providers run on, by name. */
  devices?: string[];
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

// ── GET /api/frontier ────────────────────────────────────────────────────────

/**
 * One observation of the frontier, as the ledger recorded it: each
 * capability's state, and its kind and lifecycle where the row carries them.
 * A snapshot stores no names, eras, edges, authority or evidence times, so the
 * map draws a tick with today's names, eras and edges and none of the rest.
 */
export interface FrontierTick {
  /** The second it was taken, UTC, as the ledger stores it. */
  at: string;
  states: Record<string, string>;
  /** Null on observations recorded before kinds were. */
  kinds: Record<string, string> | null;
  /** Null on observations recorded before lifecycles were. */
  lifecycles: Record<string, string> | null;
  /** What moved since the tick before, in the words `ambit history since` prints. */
  moved: string;
  /**
   * Reached since the tick before with nothing new providing them: composition,
   * by name. Absent on a fixture written before it was recorded.
   */
  emergent?: string[];
}

/**
 * The frontier through time: one tick per second a snapshot was taken, oldest
 * first. Snapshots that share a second are one tick, showing the later.
 */
export interface FrontierHistoryResponse {
  ticks: FrontierTick[];
  /** What moved between the newest tick and the live graph; null when nothing did. */
  movedSinceLast: string | null;
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
  /** Every step carries a computed inverse. */
  reversible: boolean;
  /**
   * Every step is a config patch with an inverse, which is what `ambit apply`
   * needs before it runs anything. A step can carry an inverse and no patch,
   * as a control-plane draft does: it reads reversible, and apply refuses it.
   */
  applicable: boolean;
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
  /** Who drafted it, where something said: an agent's runtime, a person's --by, or `ambit`. */
  proposed_by?: string | null;
  /** The work the change is for, in the drafter's words, where they said. */
  purpose?: string | null;
  budget_cents?: number | null;
  expires_at?: string | null;
  approval_artifact?: string | null;
  economic_case?: string | null;
  decision?: ProposalDecision;
  /**
   * What the row hashes to, as an approval artifact binds it. The queue sends
   * it back with each id, so a proposal that changed after it was shown is
   * refused, not signed. Absent on a hand-written demo row.
   */
  proposal_hash?: string;
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

/**
 * A decision on one proposal names the hash its card was drawn from and no
 * actor. The person is the one at the loopback page whatever the body says, so
 * there is no field to claim to be someone else.
 */
export interface ApproveRequest {
  proposalHash: string;
}

export interface ApproveResponse {
  proposal: string;
  approved_by: string;
  artifact?: ApprovalArtifact;
}

export interface RejectRequest {
  proposalHash: string;
  reason?: string;
}

export interface RejectResponse {
  proposal: string;
  rejected_by: string;
  reason?: string;
}

// ── POST /api/proposals/approve, POST /api/proposals/reject ──────────────────

/** A draft as the page showed it: its id, and the `proposal_hash` its card was drawn from. */
export interface ShownProposal {
  id: string;
  proposalHash: string;
}

/**
 * The queue: explicit drafts, decided one by one as the web actor. There is
 * no actor field, and none is read: whoever is at the loopback page is the
 * person the per-id routes record too.
 */
export interface QueueDecisionRequest {
  items: ShownProposal[];
}

/** One id's answer. A refusal says why; the others still went ahead. */
export type QueueDecisionResult =
  | { id: string; decided: true }
  | { id: string; decided: false; refused: string };

export interface QueueDecisionResponse {
  decision: 'approved' | 'rejected';
  decided_by: string;
  results: QueueDecisionResult[];
}

// ── GET /api/audit ───────────────────────────────────────────────────────────

/**
 * What came of an event, where the ledger recorded it. The word is the
 * engine's; the tone is whether it went as meant, which the page draws as a
 * shape beside the word.
 */
export interface AuditOutcome {
  word: string;
  tone: 'good' | 'bad' | 'neutral';
}

/** One line of the trail. */
export interface AuditEvent {
  id: string;
  /** ISO 8601 in UTC, whichever form the row stored. */
  at: string;
  /** Who acted, where the record names someone. */
  actor?: string;
  /** What happened: the verb the record stores. */
  action: string;
  /** What it happened to. */
  target?: string;
  summary?: string;
  /** Only where one was recorded. An event that states no result shows none. */
  outcome?: AuditOutcome;
}

/**
 * The trail, one line per event: acts, proposals, runs and delegation records
 * merged newest first, and cut once, after the merge, at `limit`.
 */
export interface AuditResponse {
  days: number;
  limit: number;
  events: AuditEvent[];
  /** The window held more events than the limit let through. */
  truncated: boolean;
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
    /**
     * The config entry that installs it, as text for a person to paste. Present
     * only where the curated tree gives the alternative a patch, and never
     * something a surface runs.
     */
    install?: string;
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
  /** Standing spend ceilings, and how much of each is used. */
  budgets: {
    capability: string;
    action: string;
    ceiling_dollars: number;
    /** Spent this period. Zero once the period has run out, as the gate reads it. */
    spent_dollars: number;
    period: string;
    /**
     * When this period began, as the graph stamps it (UTC). Absent before a
     * period is recorded, and once one has run out and nothing has started the next.
     */
    period_start?: string | null;
    /** The day the period turns over. Absent with `period_start`. */
    period_ends_on?: string | null;
    /**
     * Where the period lands at the pace so far, and the day that pace reaches
     * the ceiling. Absent while nothing is recorded as spent, or too little of
     * the period has run for a pace: no tick and no date are drawn from nothing.
     */
    forecast?: { lands_dollars: number; hits_ceiling_on?: string };
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

/**
 * One seat on the council: one question the engine answers, read against the
 * step on the table. `says` is one sentence; `command` is what a person would
 * paste to see the whole answer, and nothing on the page runs it.
 */
export interface LoopAdvisor {
  seat: 'science' | 'defence' | 'treasury' | 'justice' | 'interior';
  /** What the seat reads: the frontier, fragility, the ledger, authority, the checks. */
  reads: string;
  says: string;
  command?: string;
  /** The node the sentence is about, where it names one on the map. */
  subject?: { id: string; name: string };
  /**
   * Where the seat stands on the step. Silent means nothing is recorded for it
   * to read, which the page says instead of drawing an opinion from nothing.
   */
  stance: 'for' | 'against' | 'neutral' | 'silent';
}

/** Five readings of the step `ambit next` puts first, and whether they agree. */
export interface LoopCouncil {
  /** The step on the table, or null when nothing is one step away. */
  motion: { id: string; name: string; cost: string; basis: 'observed' | 'structural' } | null;
  advisors: LoopAdvisor[];
  /** At least one seat for and one against. */
  split: boolean;
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
  /** The council on the first of `next`: five seats, one sentence each. */
  council: LoopCouncil;
  /**
   * Tokens sessions used in the window, per model, from session transcripts.
   * Absent when none were recorded. Priced only where a person declared a
   * price for the model, since the transcripts state none.
   */
  tokens?: LoopTokens;
}

export interface LoopTokens {
  /** The window, in days. */
  days: number;
  /** Sessions with a token count in the window. */
  sessions: number;
  /** Most used first. Cache reads apart from fresh input, which they dwarf. */
  models: {
    model: string;
    input: number;
    cached: number;
    output: number;
    /**
     * What the priced part cost, at the price declared when each session was
     * recorded. Absent when none of it was priced: undeclared, never $0.
     */
    spend_dollars?: number;
    /** Some of these tokens carry no price, because none was declared for them. */
    unpriced?: true;
  }[];
}

export interface LoopResponse extends LoopSnapshot {
  /** Where the numbers came from: this machine's ledger, or the demo's illustration. */
  source: 'ledger' | 'sample';
  /** True when the ledger has recorded nothing yet, so the page explains itself. */
  empty: boolean;
}

// ── GET /api/run ─────────────────────────────────────────────────────────────

/**
 * One run, laid out in time from what the ledger recorded and no more. Times
 * are ISO 8601 in UTC, normalized by the engine because the ledger holds two
 * spellings of one instant. Where nothing recorded a figure the field is null,
 * and a surface leaves it out; an unmeasured wait is never drawn as zero.
 */
export interface RunAsk {
  kind: string;
  actor: string;
  /** When the person was asked. */
  at: string;
  /** When they answered, where something recorded it. */
  ended_at: string | null;
  /**
   * What the ask took, in seconds, where the ledger has a figure: the recorded
   * active and waiting time, else the span between the two timestamps. Null
   * when nothing measured it, including the zero a recorder writes because it
   * cannot observe the reply.
   */
  seconds: number | null;
  /** A person being asked for permission: the kinds the engine's vocabulary calls a gate. */
  gate: boolean;
  capability?: string;
  action?: string;
  outcome?: string;
}

export interface RunUse {
  capability: string;
  capability_id: string;
  /**
   * When the use began, where it was timed, else when it was recorded. The bar
   * drawn from it lasts `seconds`.
   */
  at: string;
  /** How long it lasted, where that was measured. */
  seconds: number | null;
}

export interface RunEvent {
  at: string;
  kind: string;
  action?: string;
  actor?: string;
}

export interface RunView {
  id: string;
  goal?: string;
  started_at: string;
  /** Null while the run is open, and for a runtime that never reports the end. */
  ended_at: string | null;
  outcome?: string;
  uses: RunUse[];
  uses_total: number;
  events: RunEvent[];
  /** Events are not synced between machines, so a run that arrived in a sync file has none. */
  events_total: number;
  asks: RunAsk[];
  asks_total: number;
  /** A person's time in this run. Only asks something timed are counted in it. */
  human: { seconds: number; timed: number; untimed: number };
}

/** One run in the list a person picks from. */
export interface RunSummary {
  id: string;
  goal?: string;
  started_at: string;
  ended_at: string | null;
  asks: number;
  events: number;
}

export interface RunResponse {
  /** Newest first. */
  recent: RunSummary[];
  /** The run asked for, or the newest that recorded an ask; null when there are none. */
  run: RunView | null;
}

// ── GET /api/infrastructure/scan ─────────────────────────────────────────────

/**
 * What the gate answers for one action on one machine: `canExecute` with the
 * machine as the target, so a grant scoped to it counts and one scoped
 * elsewhere does not. CONFIRM is permitted with a person in the loop; DENY is
 * a refusal, and `reason` says which kind.
 */
export interface MachineAction {
  id: string;
  name: string;
  decision: 'ALLOW' | 'CONFIRM' | 'DENY';
  reason: string;
}

export interface MachineModes {
  /** The scan node this is about. */
  id: string;
  /** The graph's name for it, which is what a grant's scope is matched against. */
  target: string;
  actions: MachineAction[];
}

/**
 * What the graph holds about a device or service the scan found, beside the
 * reading itself. Only for a node the graph has something to say about.
 */
export interface InfraRecord {
  /** The scan node this is about. */
  id: string;
  /**
   * When `ambit incidents` last got an answer from it, as SQLite wrote it
   * (UTC, no zone). Absent until one has.
   */
  lastSeenAt?: string;
  /** The manifest's labels for it. Absent when it states none. */
  tags?: string[];
}

export interface InfrastructureScanResponse {
  generatedAt: string;
  source: string;
  nodes: InfrastructureNode[];
  links: InfrastructureLink[];
  findings: InfrastructureFinding[];
  summary: { online: number; degraded: number; offline: number; unknown: number };
  /** What an agent may do on each machine the scan found. Absent from a server that predates it. */
  machines?: MachineModes[];
  /** Last seen and tags, read from the graph. Absent from a server that predates it. */
  recorded?: InfraRecord[];
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
  '/api/frontier': FrontierHistoryResponse;
  '/api/briefing': BriefingResponse;
  '/api/proposals': ProposalsResponse;
  '/api/proposals/approve': QueueDecisionResponse;
  '/api/proposals/reject': QueueDecisionResponse;
  '/api/audit': AuditResponse;
  '/api/attention': AttentionResponse;
  '/api/loop': LoopResponse;
  '/api/run': RunResponse;
  '/api/unmapped': UnmappedResponse;
  '/api/infrastructure/scan': InfrastructureScanResponse;
  '/api/repos/scan': RepoScanResponse;
}
