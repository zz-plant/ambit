/**
 * The store's former name. `useAmbitStore` in ./ambitStore.ts is the real
 * thing; this re-export keeps imports written before the rename working.
 */
export {
  useAmbitStore,
  useAmbitStore as useToolchainStore,
  backendAvailable,
  TREE_FILTERS,
  type TreeFilter,
  type ActiveLens,
  type SimulationMode,
  type ProposalItem,
  type InfrastructureScan,
  type InfrastructureNode,
  type InfrastructureLink,
  type InfrastructureFinding,
} from './ambitStore';
