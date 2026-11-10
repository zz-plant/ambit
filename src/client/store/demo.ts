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
import type {
  AuditEvent,
  AuditResponse,
  FrontierHistoryResponse,
  ProposalRow,
} from '../../shared/api';
import { type OutageImpact, outageImpact, outageSplit } from '../components/civ/layout';
import { toUtcEpoch } from '../../shared/format';
import type { Connection, Item } from '../utils/configImporter';
import { WEB_ACTOR } from '../utils/copy';
import demoData from '../utils/demo-data.json';

interface Graph {
  items: Item[];
  connections: Connection[];
}

/**
 * The capability tree that ships in the bundle. Used by the published demo and
 * by `?demo=1` locally, so the two show the same thing; it is what the README's
 * hero image is a picture of.
 */
export function demoTreeGraph(): Graph {
  tree ??= onOneClock(demoData.tree as unknown as Graph);
  return tree;
}

/** How long ago the sample's last check ran: the one that found Browser Automation failing. */
const LAST_CHECK_AGO = 3 * 3_600_000;

const stampOf = (epoch: number) => new Date(epoch).toISOString().slice(0, 19).replace('T', ' ');

/**
 * The sample's checks, dated from the day the page is opened.
 *
 * generate-demo-data.ts stamps every check on a fixed day, so the file is the
 * same on every build, and the trail below is dated from now. Read as written,
 * the two told one event twice: the trail said Browser Automation's check
 * failed three hours ago, and its panel said the last check failed 45 days
 * ago, a day more every day. The latest check in the file is moved to where
 * the trail puts it and every other check keeps its distance from that one.
 */
function onOneClock(graph: Graph): Graph {
  const checkedAt = (i: Item) =>
    typeof i.meta?.lastChecked === 'string' ? toUtcEpoch(i.meta.lastChecked) : undefined;
  const stamps = graph.items.flatMap(i => checkedAt(i) ?? []);
  if (!stamps.length) return graph;
  const shift = Date.now() - LAST_CHECK_AGO - Math.max(...stamps);
  return {
    ...graph,
    items: graph.items.map(i => {
      const at = checkedAt(i);
      return at === undefined ? i : { ...i, meta: { ...i.meta, lastChecked: stampOf(at + shift) } };
    }),
  };
}

/** Shifted once a page load, so every reader of the tree holds the same list. */
let tree: Graph | undefined;

/**
 * The outage the demo opens on. A visitor who has read nothing yet should see
 * the product's one claim happen: a piece goes away, and what went with it
 * turns red. Tool Protocol is "at least one MCP server", and in the sample
 * what the agents do every day rests on it: the database, memory, secrets and
 * search. Hosted Inference was the first choice and cuts
 * off twelve, but none of the twelve is reached, so "twelve things stopped"
 * would have been a claim about things that never worked.
 */
export const COLD_OPEN_OUTAGE = 'combo:tool-protocol';

/** The cold open's root in words a visitor uses. The node's own name is the tree's. */
export const COLD_OPEN_PLAIN = "this setup's MCP servers";

/**
 * What the cold open takes down, split the way `outageImpact` splits every
 * outage: `stopped` could run and now cannot, `broken` was failing already,
 * `cutOff` was never set up. The map draws all three red; only the first
 * stopped.
 */
export function coldOpen(items: Item[], connections: Connection[]): OutageImpact | null {
  if (!items.some(i => i.id === COLD_OPEN_OUTAGE)) return null;
  return outageImpact(items, outageSplit(items, connections, COLD_OPEN_OUTAGE));
}

/**
 * The frontier through time on the demo's machine, in the shape /api/frontier
 * serves. generate-demo-data.ts records it on fixed dates, so the timeline
 * shows the same series on every build; a fixture without one is a machine
 * with no history yet.
 */
export function demoHistory(): FrontierHistoryResponse {
  return (
    (demoData as { history?: FrontierHistoryResponse }).history ?? {
      ticks: [],
      movedSinceLast: null,
    }
  );
}

/** The config view's fixture: a flat list of discovered entries. */
export function demoConfigGraph(): Graph {
  return demoData.config as unknown as Graph;
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
      proposed_by: 'agent:opencode',
      purpose: 'Unattended staging deploys, so a fix reaches staging without waiting on you',
      goal: 'Deploy the billing hotfix to the staging cluster',
      status: 'draft',
      // None of these is a config change, so none has an inverse, and the
      // decision below says so: not reversible, and not something `ambit
      // apply` runs.
      steps: JSON.stringify([
        { action: 'verify_kubeconfig', provider: 'tool:kubectl', status: 'pending' },
        {
          action: 'apply_k8s_manifest',
          provider: 'tool:kubectl',
          status: 'pending',
          requires_person: true,
        },
        { action: 'run_smoke_tests', provider: 'skill:vitest', status: 'pending' },
      ]),
      // The decision context a live row gets from its stored steps, simulation
      // and economic case, written by hand here like the rest of the demo.
      decision: {
        setup_hours: 0.5,
        reversible: false,
        applicable: false,
        requires_person: true,
        privacy: 'local',
        forecast: {
          hours_month_now: 0.7,
          hours_month_after: 0.1,
          savings_dollars_month: 150,
          confidence: 'medium',
        },
        unlocks: [],
        precedent: [{ trait: 'privacy:local', leans: 'accepted', approved: 4, rejected: 0 }],
      },
    },
    {
      id: 'prop-offline-semantic-search',
      created_at: new Date(Date.now() - 86400000).toISOString(),
      proposed_by: 'agent:opencode',
      purpose: 'Searching your own code and notes offline, with nothing sent to a hosted API',
      goal: 'Add pgvector to the local Postgres, for offline retrieval',
      status: 'approved',
      // A config patch with its inverse written beside it, the shape a live
      // step stores and the only one `ambit apply` runs. The panel reads only
      // that both are there.
      steps: JSON.stringify([
        {
          action: 'enable_extension',
          provider: 'tool:postgres',
          status: 'done',
          config_patch: { mcp: { pgvector: { type: 'local', enabled: true } } },
          inverse: { remove: ['mcp.pgvector'] },
        },
      ]),
      approved_by: WEB_ACTOR,
      approved_at: new Date(Date.now() - 72000000).toISOString(),
      decision: {
        setup_hours: 0.5,
        reversible: true,
        applicable: true,
        requires_person: false,
        privacy: 'local',
        forecast: {
          hours_month_now: 1.1,
          hours_month_after: 0.1,
          savings_dollars_month: 248,
          confidence: 'medium',
        },
        unlocks: ['Vector Store', 'Local Embeddings'],
        precedent: [
          { trait: 'privacy:local', leans: 'accepted', approved: 4, rejected: 0 },
          { trait: 'cost:recurring', leans: 'refused', approved: 0, rejected: 3 },
        ],
      },
    },
  ];
}

/**
 * The trail the audit view shows in the demo, in the shape `/api/audit`
 * serves: the two proposals above, a check run that found Browser Automation
 * failing and the grant it narrowed, and an incident run. Written by hand like
 * the rest, and labelled a sample where it is drawn.
 */
export function demoAudit(): AuditResponse {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const hour = 3_600_000;
  const events: AuditEvent[] = [
    {
      id: 'prop-deploy-staging-42#proposed',
      at: ago(hour),
      actor: 'agent:opencode',
      action: 'proposed',
      target: 'prop-deploy-staging-42',
      summary: 'Deploy the billing hotfix to the staging cluster',
    },
    {
      id: 'ambit:revision:demo',
      at: ago(LAST_CHECK_AGO - 1000),
      actor: 'ambit',
      action: 'revision',
      target: 'combo:browser-automation/execute',
      summary: 'Browser Automation asks a person before it runs until its check passes again.',
      outcome: { word: 'grant narrowed', tone: 'bad' },
    },
    {
      id: 'act:demo-failed',
      at: ago(LAST_CHECK_AGO),
      action: 'failed',
      target: 'combo:browser-automation',
      outcome: { word: 'check failed', tone: 'bad' },
    },
    {
      id: 'act:demo-verified',
      at: ago(LAST_CHECK_AGO + 1000),
      action: 'verified',
      target: 'combo:version-control',
      outcome: { word: 'check passed', tone: 'good' },
    },
    {
      id: 'prop-offline-semantic-search#approved',
      at: ago(20 * hour),
      actor: WEB_ACTOR,
      action: 'approved',
      target: 'prop-offline-semantic-search',
      summary: 'Add pgvector to the local Postgres, for offline retrieval',
      outcome: { word: 'signed', tone: 'good' },
    },
    {
      id: 'prop-offline-semantic-search#proposed',
      at: ago(24 * hour),
      actor: 'agent:opencode',
      action: 'proposed',
      target: 'prop-offline-semantic-search',
      summary: 'Add pgvector to the local Postgres, for offline retrieval',
    },
    {
      id: 'run-demo-ollama#ended',
      at: ago(47 * hour),
      action: 'ended',
      target: 'run-demo-ollama',
      summary: 'Restart the Ollama service',
      outcome: { word: 'resolved', tone: 'good' },
    },
    {
      id: 'run-demo-ollama#started',
      at: ago(48 * hour),
      action: 'started',
      target: 'run-demo-ollama',
      summary: 'Restart the Ollama service',
    },
  ];
  return { days: 30, limit: 200, events, truncated: false };
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
