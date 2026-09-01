// Plain-language names for the internal type/status vocabulary. The graph data
// keeps its raw values (they are stable IDs and CSS keys); only what people
// read goes through here.

const TYPE_LABELS: Record<string, string> = {
  framework: 'Framework',
  'mcp-server': 'Tool server',
  agent: 'Agent',
  provider: 'AI provider',
  model: 'Model',
  command: 'Command',
  skill: 'Skill',
  config: 'Configuration',
  possibility: 'Possibility',
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

const STATUS_LABELS: Record<string, string> = {
  built: 'Reached',
  specified: 'Not yet reached',
  deprecated: 'Being retired',
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

// "maxTokens" → "Max tokens" for the detail panel's raw metadata rows.
export function metaKeyLabel(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
