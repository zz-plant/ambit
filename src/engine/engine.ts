#!/usr/bin/env node --experimental-sqlite
/**
 * The engine's public surface, and the executable the CLI and MCP server run.
 *
 * The implementation lives in modules named after the thing they do rather than
 * in one file: what the system is (`ontology`), how it finds out (`discovery`),
 * what it can infer (`inference`), what it has evidence for (`assurance`), what
 * it could do next (`planning`), who may authorise it (`governance`), and how
 * the frontier moved (`ledger`). Ambit's conceptual architecture is the point of
 * the project, so it may as well be the file layout.
 *
 * This file stays the entry point and re-exports the same names it always did,
 * so nothing importing the engine has to know the split happened.
 */
import { main } from './cli.ts';

export { getDb, migrate } from './db.ts';
export { seedFromConfig, seedEconomics, seedCatalog } from './discovery.ts';
export {
  computeDecay,
  discoverCombos,
  sessionDiff,
  domainHealth,
  findBottlenecks,
  analyzeImpact,
  nearMissCombos,
  singlePointsOfFailure,
  affordanceDomains,
  surfaceFor,
  credentialReport,
} from './inference.ts';
export {
  runVerification,
  evidenceFor,
  declaredCheck,
  authorityReport,
  actionsReport,
  scopeReport,
  canExecute,
  recordSpend,
  setPromotion,
  evaluatePromotions,
  promotionReport,
  suggestPromotions,
  declareSandbox,
  removeSandbox,
} from './assurance.ts';
export { setBudget, budgetReport, clearBudget } from './budgets.ts';
export { reversibilityReport } from './reversibility.ts';
export { observedPreferences, observedReport, preferredOption } from './observed.ts';
export { objectReport, knownObjects } from './objects.ts';
export { briefing, briefingText } from './briefing.ts';
export { nextSteps, nextLines } from './next.ts';
export { classifySignal, captureFailure, recordRefusal, signalReport } from './failures.ts';
export { registerSkill, registeredSkills } from './skills.ts';
export { exportSync, importSync } from './sync.ts';
export { ledgerSince, ledgerHistory } from './ledger.ts';
export {
  planFor,
  recordFailure,
  deficits,
  simulateFrontier,
  propose,
  preferencesReport,
} from './planning.ts';
export { goalFor, pathsFor } from './goals.ts';
export {
  humanDigest,
  digestMessage,
  notify,
  pendingApprovals,
  pendingDrafts,
  pendingMessage,
  notifyPending,
} from './attention.ts';
export {
  beginRun,
  endRun,
  addEvent,
  recordUse,
  recordIntervention,
  recordResource,
  recordOutcome,
  workReport,
  usageReport,
} from './telemetry.ts';
export {
  valueCents,
  metricByEntity,
  attentionValueCentsPerHour,
  goalValue,
  economicsReport,
} from './economics.ts';
export { opportunitiesFor, opportunityFor, economicCaseFor } from './opportunities.ts';
export { roiFor, roiSummary } from './roi.ts';
export { exportSummary, importSummary } from './federation.ts';
export { portfolio } from './portfolio.ts';
export { incidents, resolveIncident } from './incident.ts';
export { catalogReport } from './catalog.ts';
export { auditFor } from './audit.ts';
export {
  applyRemoval,
  listProposals,
  showProposal,
  approveProposal,
  approveProposals,
  rejectProposal,
  pendingProposals,
  inverseOf,
  applyProposal,
  rollbackProposal,
} from './governance.ts';
export { proposalHash, mintApproval, verifyApproval } from './approval.ts';
export {
  executeThroughControlPlane,
  setupControlPlaneGraph,
  createInitialSimulatedEnvironment,
  readSimulatedEnvironment,
  writeSimulatedEnvironment,
  type AgentExecutionRequest,
  type ControlPlaneResult,
  type SimulatedEnvironment,
  type OpenTelemetrySpan,
} from '../control_plane/proxy.ts';

if (import.meta.main) main();
