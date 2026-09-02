/**
 * The colour and glyph for each kind of node, read from the design tokens.
 *
 * Three files each kept their own copy of this table, and they disagreed: the
 * map painted a server `#ffaa00`, the detail panel `#f59e0b`, the docs modal a
 * third value, and the map's runtime node was a cyan no token defined. One
 * table, resolved through CSS variables so the palette lives in App.css alone.
 */

const TYPE_COLORS: Record<string, string> = {
  framework: 'var(--type-framework)',
  runtime: 'var(--type-framework)',
  service: 'var(--type-framework)',
  'mcp-server': 'var(--type-server)',
  api: 'var(--type-server)',
  agent: 'var(--type-agent)',
  skill: 'var(--type-skill)',
  provider: 'var(--type-provider)',
  model: 'var(--type-model)',
  possibility: 'var(--type-combo)',
  combo: 'var(--type-combo)',
  workflow: 'var(--type-combo)',
  tool: 'var(--type-tool)',
  command: 'var(--type-tool)',
  config: 'var(--type-tool)',
  device: 'var(--type-device)',
  network: 'var(--type-network)',
};

const TYPE_SYMBOLS: Record<string, string> = {
  framework: '★',
  runtime: '★',
  'mcp-server': '◈',
  agent: '◆',
  skill: '◇',
};

export function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? 'var(--type-other)';
}

export function typeSymbol(type: string): string {
  return TYPE_SYMBOLS[type] ?? '●';
}
