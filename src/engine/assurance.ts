/**
 * Assurance: whether a capability actually works, and whether it may be used.
 *
 * Two different questions that the engine has always kept together, because
 * both gate the same thing — a permission over something broken is not an
 * ability. This was one 749-line file holding the verification runner, the
 * lifecycle derivation and the whole authority model; it is now the seam that
 * names them, and every importer's surface is unchanged.
 *
 *   assure/lifecycle.ts  what state the evidence puts a capability in, and
 *                        `usable`, the gate the rest of the engine reads
 *   assure/verify.ts     running a declared check and recording what happened
 *   assure/decide.ts     canExecute — the gate the control plane consults
 *   assure/promote.ts    authority that widens on evidence and narrows on one
 *                        failing check
 *   assure/reports.ts    the same model, read rather than enforced
 */
export {
  FAILING_LIFECYCLES,
  usable,
  RECENT_RUNS,
  lifecycleFrom,
  deriveLifecycles,
} from './assure/lifecycle.ts';
export {
  verifyCheck,
  verifyCapability,
  verifyAction,
  declaredCheck,
  evidenceFor,
  runVerification,
} from './assure/verify.ts';
export {
  MODE_RANK,
  narrower,
  scopeCovers,
  missingPrerequisites,
  canExecute,
  recordSpend,
} from './assure/decide.ts';
export {
  setPromotion,
  evaluatePromotions,
  promotionReport,
  evidenceCount,
} from './assure/promote.ts';
export { authorityReport, actionsReport, scopeReport } from './assure/reports.ts';
