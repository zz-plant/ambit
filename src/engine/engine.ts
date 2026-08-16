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
import { main } from "./cli.ts";

export { getDb, migrate } from "./db.ts";
export { seedFromConfig, seedEconomics, seedCatalog } from "./discovery.ts";
export {
  computeDecay, discoverCombos, sessionDiff, domainHealth, findBottlenecks,
  analyzeImpact, nearMissCombos, singlePointsOfFailure,
  affordanceDomains, surfaceFor,
} from "./inference.ts";
export { runVerification, evidenceFor, authorityReport, actionsReport, scopeReport, canExecute, recordSpend } from "./assurance.ts";
export { ledgerSince, ledgerHistory } from "./ledger.ts";
export { planFor, recordFailure, deficits, simulateFrontier, propose, preferencesReport } from "./planning.ts";
export { goalFor, pathsFor } from "./goals.ts";
export { humanDigest, digestMessage, notify, pendingApprovals, pendingMessage, notifyPending } from "./attention.ts";
export {
  beginRun, endRun, addEvent, recordUse, recordIntervention,
  recordResource, recordOutcome, workReport, usageReport,
} from "./telemetry.ts";
export {
  valueCents, metricByEntity, attentionValueCentsPerHour, goalValue, economicsReport,
} from "./economics.ts";
export { opportunitiesFor, opportunityFor, economicCaseFor } from "./opportunities.ts";
export { roiFor, roiSummary } from "./roi.ts";
export { exportSummary, importSummary } from "./federation.ts";
export { portfolio } from "./portfolio.ts";
export { incidents, resolveIncident } from "./incident.ts";
export { catalogReport } from "./catalog.ts";
export { auditFor } from "./audit.ts";
export {
  applyRemoval, listProposals, showProposal, approveProposal, inverseOf,
  applyProposal, rollbackProposal,
} from "./governance.ts";
export { proposalHash, mintApproval, verifyApproval } from "./approval.ts";

if (import.meta.main) main();
