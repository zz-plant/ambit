/**
 * The planning loop: route to a goal, record what blocked it, propose a fix.
 *
 * Three stages of one loop, which is why they lived in one 652-line file — but
 * they are asked at different times and read by different callers.
 *
 *   plan/route.ts     how to reach a goal, and whose preferences it fights
 *   plan/deficits.ts  what keeps stopping work, and whether it is structural
 *   plan/propose.ts   what a change would buy, as something approvable
 *
 * Re-exported here so no importer changed.
 */
export { conflictForChosen, planFor, preferencesReport } from './plan/route.ts';
export {
  BLOCK_CLASSES,
  BLOCK_PREFIX,
  blockedAction,
  recordFailure,
  deficits,
} from './plan/deficits.ts';
export { simulateFrontier, propose } from './plan/propose.ts';
