/**
 * Reading the capability graph: four different questions about one structure.
 *
 * This was a single 790-line file. The questions had nothing to do with each
 * other beyond sharing a database, and grouping them by the question each
 * answers is what makes the file you want obvious.
 *
 *   graph/frontier.ts   what could be reached next, and what is rotting
 *   graph/health.ts     how each domain is doing, and where the leverage is
 *   graph/fragility.ts  what breaks if something goes away
 *   graph/surface.ts    the graph as another program reads it
 *
 * Re-exported here so no importer changed.
 */
export { nearMissCombos, computeDecay, discoverCombos, sessionDiff } from './graph/frontier.ts';
export { domainHealth, findBottlenecks } from './graph/health.ts';
export {
  providersOf,
  credentialsOf,
  sharedCredentials,
  analyzeImpact,
  singlePointsOfFailure,
  credentialReport,
} from './graph/fragility.ts';
export { exportGraph, surfaceFor, affordanceDomains } from './graph/surface.ts';
