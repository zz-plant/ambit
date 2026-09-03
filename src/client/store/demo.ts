/**
 * The hosted demo's data, kept apart from the live store.
 *
 * The published site is static files with no engine behind it, so every
 * action the store exposes has a second path: what to show when there is
 * nothing to fetch. Those paths used to sit inline in the store, between the
 * real fetches, so the file that owned the product's state was half fixture.
 * Everything here is the fixture half. Nothing here talks to the network, and
 * the store's job is to choose between this module and the API.
 */
import type { ProposalRow } from '../../shared/api';
import type { Connection, Item } from '../utils/configImporter';
import { WEB_ACTOR } from '../utils/copy';
import demoData from '../utils/demo-data.json';

interface Graph {
  items: Item[];
  connections: Connection[];
}

/** Lays a positionless fixture out on a grid, six across. */
function placed(items: Omit<Item, 'position'>[]): Item[] {
  return items.map((i, idx) => ({
    ...i,
    position: { x: 100 + (idx % 6) * 80, y: 50 + Math.floor(idx / 6) * 70, z: 0 },
  }));
}

/**
 * The capability tree that ships in the bundle. Used by the published demo and
 * by `?demo=1` locally, so the two show the same thing; it is what the README's
 * hero image is a picture of.
 */
export function demoTreeGraph(): Graph {
  const snapshot = demoData.tree as unknown as {
    items: Omit<Item, 'position'>[];
    connections: Connection[];
  };
  return { items: placed(snapshot.items), connections: snapshot.connections };
}

/** The config view's fixture: a flat list of discovered entries. */
export function demoConfigGraph(): Graph {
  const snapshot = demoData.config as unknown as {
    items: Omit<Item, 'position'>[];
    connections: Connection[];
  };
  return { items: placed(snapshot.items), connections: snapshot.connections };
}

/** What the attention lens warms before a real ledger has anything to say. */
/**
 * Interventions per capability, for the attention lens.
 *
 * Keyed on nodes the demo fixture actually contains. The previous keys —
 * `tool:bash`, `skill:vitest`, `mcp:cloudflare` — are in no fixture, so
 * pressing 2 on the view the demo link opens dimmed the whole map and warmed
 * nothing: a lens that appeared broken because its data pointed at a graph
 * that had been regenerated out from under it.
 *
 * The counts are the same four the Time & cost page prices, so the two
 * surfaces are reading one ledger rather than telling two stories.
 */
export const DEMO_ATTENTION: Record<string, number> = {
  'combo:data-access': 39, // manual data transfer
  'combo:continuous-delivery': 31, // deploy to production
  'combo:code-intelligence': 12, // architecture review — a keeper
  'combo:observability': 7, // payment anomaly
};

/** Two proposals for the Proposals panel: one waiting, one approved. */
export function demoProposals(): ProposalRow[] {
  return [
    {
      id: 'prop-deploy-staging-42',
      created_at: new Date(Date.now() - 3600000).toISOString(),
      goal: 'Deploy Billing Service Hotfix to Staging Cluster',
      status: 'draft',
      steps: JSON.stringify([
        { action: 'verify_kubeconfig', provider: 'tool:kubectl', status: 'pending' },
        { action: 'apply_k8s_manifest', provider: 'tool:kubectl', status: 'pending' },
        { action: 'run_smoke_tests', provider: 'skill:vitest', status: 'pending' },
      ]),
    },
    {
      id: 'prop-offline-semantic-search',
      created_at: new Date(Date.now() - 86400000).toISOString(),
      goal: 'Acquire pgvector extension on local Postgres for offline RAG',
      status: 'approved',
      steps: JSON.stringify([
        { action: 'enable_extension', provider: 'tool:postgres', status: 'done' },
      ]),
      approved_by: WEB_ACTOR,
      approved_at: new Date(Date.now() - 72000000).toISOString(),
    },
  ];
}

/**
 * The receipt the approval modal shows in the demo. The signature is a
 * placeholder string, not an HMAC: the real broker runs in the engine, which
 * the static site does not have.
 */
export function demoApproval(proposalId: string, actor: string) {
  return {
    proposal_id: proposalId,
    actor,
    timestamp: new Date().toISOString(),
    signature: 'hmac-sha256-demo-sig-7f8a9b2c3d4e5f',
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
}
