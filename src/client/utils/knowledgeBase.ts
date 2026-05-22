import type { Item, Connection } from './configImporter';

// ── MCP Server Knowledge ──────────────────────────────────────────

interface McpKnowledge {
  purpose: string;
  category: 'infrastructure' | 'development' | 'data' | 'communication' | 'media' | 'security' | 'automation' | 'ai';
  alternatives?: string[];
  upgradeNote?: string;
  gapFill?: string;
}

const mcpKnowledge: Record<string, McpKnowledge> = {
  'dev-control': {
    purpose: 'Local machine orchestration — services, Ollama, projects',
    category: 'infrastructure',
    alternatives: ['docker-mcp'],
    gapFill: 'Essential for local dev. Consider pairing with a process monitor MCP.',
  },
  '1password': {
    purpose: 'Credential management and secret retrieval',
    category: 'security',
    alternatives: ['bitwarden-mcp', 'env-vault-mcp'],
    gapFill: 'Critical for secrets hygiene. Ensure all agents route through this.',
  },
  'tailscale': {
    purpose: 'Secure network connectivity across devices',
    category: 'infrastructure',
    gapFill: 'Enables remote agent execution. Pair with dev-control for off-machine orchestration.',
  },
  'github': {
    purpose: 'GitHub API — repos, PRs, issues, actions',
    category: 'development',
    alternatives: ['gitlab-mcp', 'gitea-mcp'],
    gapFill: 'Core for any code-generation agent flow.',
  },
  'playwright': {
    purpose: 'Browser automation — testing, scraping, interaction',
    category: 'development',
    gapFill: 'Essential for web-interaction agents. Consider headless mode config.',
  },
  'mediawiki': {
    purpose: 'Wikipedia / wiki knowledge access',
    category: 'data',
    gapFill: 'Knowledge retrieval for evidence-backed agent responses.',
  },
  'mempalace': {
    purpose: 'Persistent cross-session knowledge graph',
    category: 'data',
    gapFill: 'Long-term memory for agents. Critical for continuity across sessions.',
  },
  'cloudflare': {
    purpose: 'Cloudflare API — Workers, DNS, D1, R2, KV',
    category: 'infrastructure',
    gapFill: 'Required for any Cloudflare-deployed agents or services.',
  },
  'cloudflare-docs': {
    purpose: 'Cloudflare documentation search',
    category: 'data',
    upgradeNote: 'Consolidating with cloudflare-bindings may reduce remote MCP count.',
    gapFill: 'Useful but overlaps with cloudflare-bindings.',
  },
  'cloudflare-bindings': {
    purpose: 'Cloudflare binding config — D1, KV, R2, Durable Objects',
    category: 'infrastructure',
    upgradeNote: 'Consider if this + cloudflare-docs can be merged into one MCP.',
    gapFill: 'Duplicates some coverage with cloudflare-docs.',
  },
  'cloudflare-builds': {
    purpose: 'Cloudflare Workers build management',
    category: 'automation',
    gapFill: 'For CI/CD pipeline awareness.',
  },
  'cloudflare-observability': {
    purpose: 'Workers observability — logs, metrics, traces',
    category: 'data',
    gapFill: 'Debugging and monitoring running Workers.',
  },
  'sabnzbd': {
    purpose: 'Usenet download management',
    category: 'media',
    gapFill: 'Media stack component.',
  },
  'qbittorrent': {
    purpose: 'BitTorrent download management',
    category: 'media',
    gapFill: 'Media stack component. Pair with prowlarr for indexer management.',
  },
  'romm-mcp': {
    purpose: 'ROM game library management',
    category: 'media',
    gapFill: 'Gaming preservation stack.',
  },
  'sequential-thinking': {
    purpose: 'Structured multi-step reasoning for agents',
    category: 'ai',
    gapFill: 'Boosts agent reasoning quality for complex tasks.',
  },
  'mac-mcp-server': {
    purpose: 'macOS UI automation — windows, clicks, keystrokes',
    category: 'automation',
    gapFill: 'Desktop automation backend for agents.',
  },
  'homebrew': {
    purpose: 'Package management for macOS',
    category: 'infrastructure',
    gapFill: 'Software lifecycle management. Pair with macos-defaults.',
  },
  'proxyman': {
    purpose: 'HTTP debugging and traffic inspection',
    category: 'development',
    gapFill: 'Network debugging for agent-driven web development.',
  },
  'ntfy': {
    purpose: 'Push notification delivery',
    category: 'communication',
    gapFill: 'Alerting. Pair with dev-control for service health notifications.',
  },
  'macos-defaults': {
    purpose: 'macOS system preference management',
    category: 'automation',
    gapFill: 'System config via agent. Pair with homebrew for full lifecycle.',
  },
  'macos-apps': {
    purpose: 'macOS app automation — Calendar, Contacts, Notes, Reminders',
    category: 'automation',
    gapFill: 'Personal productivity automation.',
  },
  'serena': {
    purpose: 'IDE integration and context (disabled)',
    category: 'development',
    upgradeNote: 'Disabled. Consider if IDE integration is needed.',
    gapFill: 'Direct IDE context for coding agents.',
  },
  'git': {
    purpose: 'Built-in git operations (disabled)',
    category: 'development',
    upgradeNote: 'Built-in opencode git MCP — consider enabling over github MCP for local-only repos.',
    alternatives: ['github'],
    gapFill: 'Local git ops. Built-in, zero-install.',
  },
  'filesystem': {
    purpose: 'Built-in file operations',
    category: 'infrastructure',
    gapFill: 'Built-in, always available.',
  },
  'fetch': {
    purpose: 'Built-in HTTP requests',
    category: 'infrastructure',
    gapFill: 'Built-in, always available.',
  },
  'operator': {
    purpose: 'Built-in operator context',
    category: 'infrastructure',
    gapFill: 'Built-in, always available.',
  },
};

// ── Agent Role Knowledge ─────────────────────────────────────────

interface AgentKnowledge {
  purpose: string;
  idealModel: string;
  recommendsMcp: string[];
  relatedAgents: string[];
  isCore: boolean;
}

const agentKnowledge: Record<string, AgentKnowledge> = {
  'plan': { purpose: 'Read-only analysis and proposal', idealModel: 'local-code/qwen3.5:9b', recommendsMcp: ['fetch', 'mediawiki'], relatedAgents: ['local-toolchain-engineer'], isCore: true },
  'repository-steward': { purpose: 'Monorepo integrity and changelog management', idealModel: 'local-code/gemma4:e4b-32k', recommendsMcp: ['github', 'git'], relatedAgents: ['mcp-guardian', 'monolith-sentinel'], isCore: true },
  'measurement-pipeline-engineer': { purpose: 'Claim tracking, snapshots, transforms', idealModel: 'local-code/qwen3.5:9b', recommendsMcp: ['mempalace', 'mediawiki'], relatedAgents: ['evidence-provenance-steward', 'outcome-label-curator'], isCore: false },
  'evidence-provenance-steward': { purpose: 'Source lineage and observation audit', idealModel: 'local-code/qwen3.5:9b', recommendsMcp: ['mediawiki', 'mempalace'], relatedAgents: ['measurement-pipeline-engineer', 'outcome-label-curator'], isCore: false },
  'validation-backtest-analyst': { purpose: 'Study design, holdout policy, leakage audit', idealModel: 'local-quality/gemma4:26b-64k', recommendsMcp: ['github', 'mempalace'], relatedAgents: ['measurement-pipeline-engineer', 'kpi-steward'], isCore: false },
  'outcome-label-curator': { purpose: 'Outcome labels, taxonomy, timestamps', idealModel: 'local-code/gemma4:e4b-32k', recommendsMcp: ['mempalace'], relatedAgents: ['measurement-pipeline-engineer', 'evidence-provenance-steward'], isCore: false },
  'commercial-validation-steward': { purpose: 'Buyer and offer hypothesis testing', idealModel: 'local-code/qwen3.5:9b', recommendsMcp: ['github', 'fetch'], relatedAgents: ['website-positioning-steward'], isCore: false },
  'brief-decision-artifact-writer': { purpose: 'Decision window alerts and audit docs', idealModel: 'local-quality/gemma4:26b-64k', recommendsMcp: ['mempalace', 'github'], relatedAgents: ['kpi-steward', 'website-positioning-steward'], isCore: false },
  'website-positioning-steward': { purpose: 'Public site positioning and copy', idealModel: 'local-quality/gemma4:26b-64k', recommendsMcp: ['fetch', 'github'], relatedAgents: ['copy-gatekeeper', 'design-token-enforcer'], isCore: false },
  'cloud-infrastructure-steward': { purpose: 'Cloudflare edge, D1, AI orchestration', idealModel: 'local-code/qwen3.5:9b', recommendsMcp: ['cloudflare', 'cloudflare-bindings', 'cloudflare-observability'], relatedAgents: ['local-toolchain-engineer', 'offline-resilience-engineer'], isCore: true },
  'kpi-steward': { purpose: 'KPI measurement, auditing, reporting', idealModel: 'local-code/qwen3.5:9b', recommendsMcp: ['mempalace', 'github'], relatedAgents: ['measurement-pipeline-engineer', 'validation-backtest-analyst'], isCore: false },
  'atomic-data-guardian': { purpose: 'Atomic write enforcement with audit invariants', idealModel: 'local-code/gemma4:e4b-32k', recommendsMcp: ['git', 'mempalace'], relatedAgents: ['monolith-sentinel', 'copy-gatekeeper'], isCore: false },
  'copy-gatekeeper': { purpose: 'Public copy audit against authorization table', idealModel: 'local-code/gemma4:e4b-32k', recommendsMcp: ['github', 'fetch'], relatedAgents: ['website-positioning-steward', 'design-token-enforcer'], isCore: false },
  'design-token-enforcer': { purpose: 'CSS design token compliance', idealModel: 'local-code/gemma4:e4b-32k', recommendsMcp: ['git', 'filesystem'], relatedAgents: ['monolith-sentinel', 'copy-gatekeeper'], isCore: false },
  'atomic-rename-coordinator': { purpose: 'Safe multi-file terminology rename', idealModel: 'local-code/gemma4:e4b-32k', recommendsMcp: ['git', 'filesystem'], relatedAgents: ['repository-steward', 'copy-gatekeeper'], isCore: false },
  'monolith-sentinel': { purpose: 'File size and complexity CI enforcement', idealModel: 'local-code/gemma4:e4b-32k', recommendsMcp: ['git', 'github'], relatedAgents: ['repository-steward', 'design-token-enforcer'], isCore: false },
  'steward-loop-simulator': { purpose: 'Synthetic model output corpus for CI', idealModel: 'local-code/gemma4:e4b-32k', recommendsMcp: ['mempalace', 'github'], relatedAgents: ['validation-backtest-analyst', 'measurement-pipeline-engineer'], isCore: false },
  'mcp-guardian': { purpose: 'MCP tool namespace and naming policy', idealModel: 'local-code/gemma4:e4b-32k', recommendsMcp: ['git', 'filesystem'], relatedAgents: ['repository-steward', 'monolith-sentinel'], isCore: false },
  'offline-resilience-engineer': { purpose: 'Offline paths for critical workflows', idealModel: 'local-code/gemma4:e4b-32k', recommendsMcp: ['git', 'filesystem'], relatedAgents: ['cloud-infrastructure-steward', 'local-toolchain-engineer'], isCore: false },
  'semantic-search-curator': { purpose: 'Doc index and search surface freshness', idealModel: 'local-code/qwen3.5:9b', recommendsMcp: ['mempalace', 'fetch'], relatedAgents: ['evidence-provenance-steward', 'measurement-pipeline-engineer'], isCore: false },
  'local-toolchain-engineer': { purpose: 'Ollama, CLI, M-series optimization', idealModel: 'local-code/gemma4:e4b-32k', recommendsMcp: ['dev-control', 'homebrew'], relatedAgents: ['cloud-infrastructure-steward', 'offline-resilience-engineer'], isCore: true },
  'buyer-persona-emulator': { purpose: 'Institutional buyer simulation for outreach audit', idealModel: 'local-code/qwen3.5:9b', recommendsMcp: ['fetch', 'mediawiki'], relatedAgents: ['commercial-validation-steward', 'persona-pt-committee'], isCore: false },
  'persona-pt-committee': { purpose: 'Payer decision-maker simulation for evidence audit', idealModel: 'local-quality/gemma4:26b-64k', recommendsMcp: ['mempalace', 'mediawiki'], relatedAgents: ['buyer-persona-emulator', 'commercial-validation-steward'], isCore: false },
  'persona-adversarial-editor': { purpose: 'Wikipedia editor simulation for measurement robustness', idealModel: 'local-code/qwen3.5:9b', recommendsMcp: ['mediawiki', 'mempalace'], relatedAgents: ['buyer-persona-emulator', 'evidence-provenance-steward'], isCore: false },
};

// ── Domain Patterns ──────────────────────────────────────────────

interface DomainPattern {
  name: string;
  mcpServers: string[];
  agents: string[];
  description: string;
}

const domainPatterns: DomainPattern[] = [
  {
    name: 'Measurement & Evidence',
    mcpServers: ['mempalace', 'mediawiki', 'github'],
    agents: ['measurement-pipeline-engineer', 'evidence-provenance-steward', 'outcome-label-curator', 'validation-backtest-analyst'],
    description: 'Claim tracking with provenance, audit, and validation',
  },
  {
    name: 'Infrastructure & Cloud',
    mcpServers: ['cloudflare', 'cloudflare-bindings', 'cloudflare-observability', 'dev-control', 'tailscale'],
    agents: ['cloud-infrastructure-steward', 'local-toolchain-engineer', 'offline-resilience-engineer'],
    description: 'Edge deployment, local orchestration, offline resilience',
  },
  {
    name: 'Development Governance',
    mcpServers: ['github', 'git', 'filesystem'],
    agents: ['repository-steward', 'monolith-sentinel', 'mcp-guardian', 'atomic-data-guardian', 'atomic-rename-coordinator', 'design-token-enforcer', 'copy-gatekeeper'],
    description: 'Code quality, naming, size limits, atomic operations',
  },
  {
    name: 'Commercial & Market Access',
    mcpServers: ['fetch', 'mediawiki', 'github'],
    agents: ['commercial-validation-steward', 'buyer-persona-emulator', 'persona-pt-committee', 'website-positioning-steward'],
    description: 'Commercial validation, buyer simulation, positioning',
  },
  {
    name: 'Media & Home Automation',
    mcpServers: ['sabnzbd', 'qbittorrent', 'romm-mcp', 'ntfy', 'proxyman'],
    agents: [],
    description: 'Media download stack, notifications, debugging',
  },
];

// ── Possibility Pattern Knowledge ───────────────────────────────

interface PossibilityPattern {
  name: string;
  description: string;
  expectedItems: string[];
  severity: 'info' | 'warn';
}

const possibilityPatterns: PossibilityPattern[] = [
  {
    name: 'Pi/ESP32 companion system',
    description: 'Models the no-extra-hardware ESP32-S3 + RPi 4B loop: local-first status, display/pixel language, adaptive rules, self-healing manifests, and occasional cloud inference',
    expectedItems: [
      'possibility:pi-esp32-companion-loop',
      'possibility:esp32-household-surface',
      'possibility:self-healing-manifest',
      'possibility:adaptive-attention-loop',
      'possibility:non-deterministic-enrichment',
      'possibility:free-cloud-inference-gateway',
      'possibility:tv-mode-resource-governor',
      'possibility:generated-micro-cards',
    ],
    severity: 'info',
  },
];

// ── Command Knowledge ──────────────────────────────────────────

interface CommandKnowledge {
  purpose: string;
  category: 'steward' | 'session' | 'deployment' | 'utility';
}

const commandKnowledge: Record<string, CommandKnowledge> = {
  'steward': { purpose: 'Repo steward autopilot runner', category: 'steward' },
  'promote': { purpose: 'Canon promotion for repo steward', category: 'steward' },
  'session': { purpose: 'Cold re-entry session summary generator', category: 'session' },
  'tag': { purpose: 'Session type tagging (outreach/infrastructure/research/product)', category: 'session' },
  'tag-report': { purpose: 'Session allocation vs Kill Rule v2 report', category: 'session' },
};

// ── Skill Knowledge ─────────────────────────────────────────────

interface SkillKnowledge {
  purpose: string;
  domain: string;
}

const skillKnowledge: Record<string, SkillKnowledge> = {
  'skills': { purpose: 'Installed agent skill directory', domain: 'general' },
};

// ── Provider Pattern Knowledge ──────────────────────────────────

interface ProviderPattern {
  name: string;
  tier: 'fast' | 'quality' | 'cloud';
  typicalUse: string;
  models: { name: string; context: number; bestFor: string }[];
}

const providerPatterns: ProviderPattern[] = [
  { name: 'local-code', tier: 'fast', typicalUse: 'Default agent, fast iteration, code generation', models: [
    { name: 'gemma4:e4b-32k', context: 32768, bestFor: 'General coding, tools, vision' },
    { name: 'qwen3.5:9b', context: 65536, bestFor: 'Long context, research, analysis' },
  ]},
  { name: 'local-quality', tier: 'quality', typicalUse: 'Review tier, validation, quality-critical work', models: [
    { name: 'gemma4:26b-64k', context: 65536, bestFor: 'Deep review, complex reasoning' },
  ]},
  { name: 'cloudflare', tier: 'cloud', typicalUse: 'Cloud inference, fallback, large context', models: [
    { name: 'kimi-k2.6', context: 131072, bestFor: 'Very long context, ratification' },
    { name: 'gemma-4-26b-a4b', context: 131072, bestFor: 'Cloud reasoning, vision, function calling' },
  ]},
];

// ── Ecosystem-level patterns ────────────────────────────────────

interface EcosystemPattern {
  name: string;
  description: string;
  expectedItems: string[];
  severity: 'info' | 'warn';
}

const ecosystemPatterns: EcosystemPattern[] = [
  {
    name: 'Session tracking',
    description: 'Commands for session management improve cold re-entry and time tracking',
    expectedItems: ['cmd:tag', 'cmd:tag-report', 'cmd:session'],
    severity: 'info',
  },
  {
    name: 'Full-provider utilization',
    description: 'Having 3 provider tiers (fast/quality/cloud) enables cost-effective routing',
    expectedItems: ['provider:local-code', 'provider:local-quality', 'provider:cloudflare'],
    severity: 'info',
  },
  {
    name: 'Without watcher config',
    description: 'No file watcher ignore rules — build artifacts may trigger unnecessary rescans',
    expectedItems: ['cfg:watcher'],
    severity: 'warn',
  },
];

// ── Analysis Functions ──────────────────────────────────────────

export function enrichItemName(name: string): string {
  const kb = mcpKnowledge[name];
  if (kb) return `${name} — ${kb.purpose}`;
  return name;
}

export function getPlatformInfo(): string {
  return [
    'Runtime: Bun v1.3.14',
    'Arch: macOS arm64 (Apple Silicon)',
    'Config: ~/.config/opencode/opencode.json',
    'MCP protocol: Model Context Protocol stdio + SSE',
  ].join('\n');
}

export function detectLevelUpOpportunities(
  items: Item[],
  connections: Connection[]
): Array<{ category: string; message: string; severity: 'info' | 'warn' | 'error'; action?: { type: string; target: string } }> {
  const findings: Array<{ category: string; message: string; severity: 'info' | 'warn' | 'error'; action?: { type: string; target: string } }> = [];
  const itemNames = new Set(items.map(i => i.id.replace(/^(mcp|agent|provider|cmd):/, '')));
  const agentIds = new Set(items.filter(i => i.type === 'agent').map(i => i.id));
  const mcpIds = new Set(items.filter(i => i.type === 'mcp-server').map(i => i.id));

  // ── Gap detection: domain patterns missing key components ──
  for (const pattern of domainPatterns) {
    const presentMcps = pattern.mcpServers.filter(m => itemNames.has(m));
    const presentAgents = pattern.agents.filter(a => agentIds.has(`agent:${a}`));

    if (pattern.agents.length > 0 && presentAgents.length === 0 && presentMcps.length > 0) {
      findings.push({
        category: 'Gap',
        severity: 'info',
        message: `'${pattern.name}' domain has MCPs (${presentMcps.join(', ')}) but no dedicated agents`,
      });
    }

    if (pattern.agents.length > 0 && presentAgents.length > 0 && presentMcps.length < pattern.mcpServers.length * 0.5) {
      const missingMcps = pattern.mcpServers.filter(m => !itemNames.has(m));
      if (missingMcps.length > 0) {
        findings.push({
          category: 'Level-up',
          severity: 'info',
          message: `'${pattern.name}' agents (${presentAgents.length}) lack supporting MCPs: ${missingMcps.join(', ')}`,
        });
      }
    }
  }

  // ── Agent-MCP pairing analysis ──
  for (const [agentName, ak] of Object.entries(agentKnowledge)) {
    if (!agentIds.has(`agent:${agentName}`)) continue;
    const missing = ak.recommendsMcp.filter(m => !mcpIds.has(`mcp:${m}`));
    if (missing.length > 0) {
      findings.push({
        category: 'Level-up',
        severity: 'info',
        message: `Agent '${agentName}' would benefit from MCP: ${missing.join(', ')}`,
      });
    }
  }

  // ── Agent model tier assessment ──
  for (const [agentName, ak] of Object.entries(agentKnowledge)) {
    if (!agentIds.has(`agent:${agentName}`)) continue;
    const agent = items.find(i => i.id === `agent:${agentName}`);
    if (!agent) continue;
    const currentModel = agent.meta?.model as string;
    if (currentModel && ak.idealModel && currentModel !== ak.idealModel) {
      if (!currentModel.includes('26b') && ak.idealModel.includes('26b')) {
        const agentShort = agentName;
        findings.push({
          category: 'Modernization',
          severity: 'info',
          message: `Agent '${agentShort}' uses ${currentModel} — may benefit from upgrade to ${ak.idealModel} for quality work`,
        });
      }
    }
  }

  // ── MCP modernization ──
  for (const [mcpName, mk] of Object.entries(mcpKnowledge)) {
    if (!mcpIds.has(`mcp:${mcpName}`)) continue;
    if (mk.alternatives && mk.alternatives.length > 0) {
      const presentAlt = mk.alternatives.find(a => mcpIds.has(`mcp:${a}`));
      if (!presentAlt) {
        findings.push({
          category: 'Modernization',
          severity: 'info',
          message: `MCP '${mcpName}' has alternatives to consider: ${mk.alternatives.join(', ')}`,
        });
      }
    }
  }

  // ── Missing recommended pairs ──
  const recommendedPairs: [string, string, string][] = [
    ['homebrew', 'macos-defaults', 'Homebrew + macos-defaults form a complete macOS lifecycle management pair'],
    ['dev-control', 'ntfy', 'dev-control + ntfy enables alerting on service state changes'],
    ['mediawiki', 'mempalace', 'MediaWiki + MemPalace enable knowledge retrieval with persistent memory'],
    ['cloudflare', 'cloudflare-observability', 'Cloudflare API + Observability enables full edge lifecycle management'],
    ['qbittorrent', 'sabnzbd', 'qBittorrent + SABnzbd forms a complete media acquisition stack'],
  ];

  for (const [a, b, reason] of recommendedPairs) {
    const hasA = mcpIds.has(`mcp:${a}`);
    const hasB = mcpIds.has(`mcp:${b}`);
    if (hasA && !hasB) {
      findings.push({
        category: 'Gap',
        severity: 'info',
        message: `${reason}. Has '${a}' but missing '${b}'.`,
      });
    }
  }

  // ── Skills assessment ──
  const skillItems = items.filter(i => i.type === 'skill');
  if (skillItems.length === 0) {
    findings.push({
      category: 'Housekeeping',
      severity: 'info',
      message: 'No skill paths configured — agent skills may not be discoverable',
    });
  }

  // ── Command ecosystem assessment ──
  const cmdIds = new Set(items.filter(i => i.type === 'command').map(i => i.id));
  for (const [cmdName, ck] of Object.entries(commandKnowledge)) {
    if (!cmdIds.has(`cmd:${cmdName}`)) {
      findings.push({
        category: 'Gap',
        severity: 'info',
        message: `No '${cmdName}' command — ${ck.purpose}`,
      });
    }
  }

  // ── Provider utilization assessment ──
  const providerNames = new Set(items.filter(i => i.type === 'provider').map(i => i.id.replace('provider:', '')));
  const agentModels = new Set(items.filter(i => i.type === 'agent').map(i => i.meta?.model as string).filter(Boolean));
  const modelNames = new Set(items.filter(i => i.type === 'model').map(i => i.name));

  for (const pp of providerPatterns) {
    if (!providerNames.has(pp.name)) continue;
    const usedInProvider = [...agentModels].filter(m => m.startsWith(pp.name));
    if (usedInProvider.length === 0) {
      findings.push({
        category: 'Housekeeping',
        severity: 'info',
        message: `Provider '${pp.name}' (${pp.tier} tier) has no agents assigned — unused capacity`,
      });
    }
  }

  // Check for unused model entries
  for (const model of items.filter(i => i.type === 'model')) {
    if (![...agentModels].some(am => model.id.includes(am) || am.includes(model.name))) {
      findings.push({
        category: 'Housekeeping',
        severity: 'info',
        message: `Model '${model.name}' has no agent references — may be removable`,
      });
    }
  }

  // ── Config structure assessment ──
  const configIds = new Set(items.filter(i => i.type === 'config').map(i => i.id));
  const hasWatcher = configIds.has('cfg:watcher');
  const hasInstructions = configIds.has('cfg:instructions');
  const hasDisabledProviders = configIds.has('cfg:disabled-providers');

  if (!hasWatcher) {
    findings.push({
      category: 'Housekeeping',
      severity: 'info',
      message: 'No file watcher ignore rules — build artifacts may trigger rescans',
    });
  }

  if (!hasInstructions) {
    findings.push({
      category: 'Housekeeping',
      severity: 'info',
      message: 'No global instruction files — agents lack cross-repo operational context',
    });
  }

  // ── Ecosystem pattern assessment ──
  for (const ep of ecosystemPatterns) {
    const allPresent = ep.expectedItems.every(id => {
      const itemIds = new Set(items.map(i => i.id));
      return itemIds.has(id);
    });
    if (!allPresent) {
      const missing = ep.expectedItems.filter(id => !new Set(items.map(i => i.id)).has(id));
      findings.push({
        category: ep.severity === 'warn' ? 'Gap' : 'Level-up',
        severity: ep.severity,
        message: `${ep.description}. Missing: ${missing.join(', ')}`,
      });
    }
  }

  // ── Possibility pattern assessment ──
  for (const pp of possibilityPatterns) {
    const itemIds = new Set(items.map(i => i.id));
    const present = pp.expectedItems.filter(id => itemIds.has(id));
    const missing = pp.expectedItems.filter(id => !itemIds.has(id));

    if (present.length > 0 && missing.length > 0) {
      findings.push({
        category: 'Possibility',
        severity: pp.severity,
        message: `${pp.description}. Missing possibility nodes: ${missing.join(', ')}`,
      });
    }

    if (present.length === pp.expectedItems.length) {
      findings.push({
        category: 'Possibility',
        severity: 'info',
        message: `'${pp.name}' is represented as a complete possibility cluster (${present.length} nodes).`,
      });
    }
  }

  // ── Scale assessment ──
  const mcpCount = items.filter(i => i.type === 'mcp-server').length;
  const agentCount = items.filter(i => i.type === 'agent').length;

  if (agentCount > 20) {
    findings.push({
      category: 'Scale',
      severity: 'info',
      message: `${agentCount} subagents — significantly above typical deployment (5-10). Consider whether all are actively used.`,
    });
  }

  if (mcpCount > 15) {
    findings.push({
      category: 'Scale',
      severity: 'info',
      message: `${mcpCount} MCP servers — rich ecosystem. Watch for startup latency from sequential MCP initialization.`,
    });
  }

  const disabledMcpNames = items.filter(i => i.type === 'mcp-server' && i.status === 'specified').map(i => i.name);
  if (disabledMcpNames.length > 0) {
    findings.push({
      category: 'Housekeeping',
      severity: 'info',
      message: `${disabledMcpNames.length} MCP servers disabled: ${disabledMcpNames.join(', ')}. Review if still needed.`,
    });
  }

  return findings;
}

export interface TrendItem {
  id: string;
  source: string;
  title: string;
  url: string;
  description: string;
  score: number;
  category: string;
  created_at: string;
  discovered_at: string;
}

export function detectTrendAlignedOpportunities(
  items: Item[],
  trends: TrendItem[]
): Array<{ category: string; message: string; severity: 'info' | 'warn' | 'error'; action?: { type: string; target: string } }> {
  const findings: Array<{ category: string; message: string; severity: 'info' | 'warn' | 'error'; action?: { type: string; target: string } }> = [];
  const itemNames = new Set(items.map(i => i.id.replace(/^(mcp|agent|provider|cmd):/, '')));

  // Check trending MCPs against current toolchain
  const trendingMcps = trends.filter(t => t.category === 'mcp').slice(0, 8);
  for (const trend of trendingMcps) {
    // Extract the package/repo short name
    const shortName = trend.title.split('/').pop()?.replace(/^mcp-?/i, '').toLowerCase();
    if (!shortName) continue;

    // Check if any current toolchain item is related
    const relatedExisting = items.filter(i => {
      const iName = i.name.toLowerCase();
      return iName.includes(shortName) || shortName.includes(iName) || i.description.toLowerCase().includes(shortName);
    });

    if (relatedExisting.length === 0 && trend.score > 100) {
      // Completely new — a trending MCP not in your toolchain
      const name = trend.title.split('/').pop() || trend.title;
      findings.push({
        category: 'Ecosystem',
        severity: 'info',
        message: `Trending: '${name}' (${trend.score}★) — not in your toolchain. ${trend.description?.slice(0, 80) || ''}`,
      });
    } else if (relatedExisting.length > 0 && trend.score > 500) {
      // You use something related, but this is popular
      const name = trend.title.split('/').pop() || trend.title;
      findings.push({
        category: 'Ecosystem',
        severity: 'info',
        message: `Hot MCP '${name}' (${trend.score}★) — related to your existing ${relatedExisting.map(i => i.name).join(', ')}`,
      });
    }
  }

  // Check trending agents
  const trendingAgents = trends.filter(t => t.category === 'agent').slice(0, 4);
  for (const trend of trendingAgents) {
    const name = trend.title.split('/').pop() || trend.title;
    if (!itemNames.has(name)) {
      findings.push({
        category: 'Ecosystem',
        severity: 'info',
        message: `New agent tool '${name}' trending on GitHub (${trend.score}★). Consider evaluating.`,
      });
    }
  }

  // Freshness pulse — how many trends were found
  if (trends.length > 0) {
    const recentCount = trends.filter(t => t.score > 200).length;
    if (recentCount > 3) {
      findings.push({
        category: 'Ecosystem',
        severity: 'info',
        message: `Ecosystem pulse: ${recentCount} highly-rated new tools detected this scan. ${trends.length} total signals.`,
      });
    }
  }

  return findings;
}

export function getMcpKnowledge(name: string): McpKnowledge | undefined {
  return mcpKnowledge[name];
}

export function getAgentKnowledge(name: string): AgentKnowledge | undefined {
  return agentKnowledge[name];
}

export function getAllDomainPatterns(): DomainPattern[] {
  return domainPatterns;
}
