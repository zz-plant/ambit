// Plain-language names for the internal type/status vocabulary. The graph data
// keeps its raw values (they are stable IDs and CSS keys); only what people
// read goes through here.
//
// Every label that names a glossary concept is that concept's exact term —
// `possibility` read as "Possibility" in the detail panel, "Combo" in the
// legend and "Tech tree node" in the docs, which is three names for one circle.
// src/client/vocabulary.test.ts holds these against src/shared/concepts.json.
import { isNext } from '../components/civ/layout';
import type { Item } from './configImporter';

const TYPE_LABELS: Record<string, string> = {
  framework: 'Framework',
  'mcp-server': 'Tool server',
  agent: 'Agent',
  provider: 'AI provider',
  model: 'Model',
  command: 'Command',
  skill: 'Skill',
  config: 'Configuration',
  possibility: 'Combo',
  device: 'Device',
  service: 'Service',
  api: 'API',
  network: 'Network',
  workflow: 'Workflow',
  tool: 'Tool',
  runtime: 'Runtime',
  meta: 'Meta',
  action: 'Action',
};

/** What a status is called on the tech tree, where reaching things is the point. */
const STATUS_LABELS: Record<string, string> = {
  built: 'Reached',
  specified: 'Not yet reached',
  deprecated: 'Being retired',
};

/**
 * What a status is called in My Setup, where it is not a journey but a switch.
 *
 * The same three values arrive from two graphs. On the tree, `built` means a
 * capability has been reached. In the config view it means `enabled` is not
 * false — so the panel said "Tool server · Reached" directly above a switch
 * reading "Enabled", two words for one fact, disagreeing.
 */
const CONFIG_STATUS_LABELS: Record<string, string> = {
  built: 'Enabled',
  specified: 'Disabled',
  deprecated: 'Being retired',
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/**
 * An entry read out of the agent config, rather than a node of the curated
 * tree. Tree nodes carry an era and a state; config entries carry neither.
 */
export function isConfigEntry(item: { meta?: Record<string, unknown> }): boolean {
  return item.meta?.era === undefined && item.meta?.state === undefined;
}

/**
 * What to call a node's status, in the words of the graph it came from.
 *
 * Without the item this is the tree's vocabulary, which is what the accessible
 * announcement and any caller with only a status string want.
 */
export function statusLabel(status: string, item?: Item): string {
  if (item && isConfigEntry(item)) return CONFIG_STATUS_LABELS[status] ?? status;
  // On the tree, "not yet reached" is two different situations, and which one
  // is the useful half of the answer: blocked means a prerequisite is missing.
  if (item && status === 'specified') return isNext(item) ? 'Next step' : 'Blocked';
  return STATUS_LABELS[status] ?? status;
}

// "maxTokens" → "Max tokens" for the detail panel's raw metadata rows.
export function metaKeyLabel(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * The node that everything else hangs off — the agent runtime itself.
 *
 * Keyed `runtime:opencode` by the engine and, since the config view was
 * realigned, by `importConfig` too. `framework` is still accepted because the
 * demo's hand-authored loop snapshot uses it.
 */
export function isRuntimeNode(item: { id: string; type: string }): boolean {
  return item.id === 'runtime:opencode' || item.type === 'runtime' || item.type === 'framework';
}
