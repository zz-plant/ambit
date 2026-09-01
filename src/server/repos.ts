/**
 * How far each repository's agent config has drifted from the global one.
 *
 * Read-only: it opens every `opencode.json` under REPO_PATH and reports the
 * difference. Nothing here writes.
 */
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { readConfig, REPO_PATH } from './config.ts';

export async function scanRepos(): Promise<Record<string, any>> {
  const global = await readConfig();
  if (!global) return { error: 'Global config required' };

  // Extract reference sets from global
  const globalMcps = new Set(Object.keys((global.mcp as Record<string, any>) || {}));
  const globalAgents = new Set(Object.keys((global.agent as Record<string, any>) || {}));
  const globalCommands = new Set(Object.keys((global.command as Record<string, any>) || {}));
  const globalProviders = new Set(Object.keys((global.provider as Record<string, any>) || {}));

  const repos: any[] = [];
  if (!existsSync(REPO_PATH)) return { repos };

  const entries = readdirSync(REPO_PATH, { encoding: 'utf8' });
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const configFile = `${REPO_PATH}/${entry}/opencode.json`;
    if (!existsSync(configFile)) continue;

    let repoConfig: any;
    try {
      repoConfig = JSON.parse(await readFile(configFile, 'utf8'));
    } catch {
      continue;
    }

    const repoMcps = new Set(Object.keys((repoConfig.mcp as Record<string, any>) || {}));
    const repoAgents = new Set(Object.keys((repoConfig.agent as Record<string, any>) || {}));
    const repoCommands = new Set(Object.keys((repoConfig.command as Record<string, any>) || {}));
    const _repoProviders = new Set(Object.keys((repoConfig.provider as Record<string, any>) || {}));

    const uniqueMcps = [...repoMcps].filter(k => !globalMcps.has(k));
    const missingMcps = [...globalMcps].filter(k => k !== 'opencode-core' && !repoMcps.has(k));
    const uniqueAgents = [...repoAgents].filter(k => !globalAgents.has(k));
    const uniqueCommands = [...repoCommands].filter(k => !globalCommands.has(k));

    const driftItems =
      uniqueMcps.length + missingMcps.length + uniqueAgents.length + uniqueCommands.length;
    const totalGlobal =
      globalMcps.size + globalAgents.size + globalCommands.size + globalProviders.size;
    const driftPct = totalGlobal > 0 ? Math.round((driftItems / totalGlobal) * 100) : 0;

    repos.push({
      name: entry,
      drift: Math.min(100, driftPct),
      driftItems,
      uniqueMcps,
      missingMcps,
      uniqueAgents,
      uniqueCommands,
      defaultAgent: repoConfig.default_agent || null,
    });
  }

  repos.sort((a, b) => b.drift - a.drift);
  return {
    globalStats: {
      mcps: globalMcps.size,
      agents: globalAgents.size,
      commands: globalCommands.size,
      providers: globalProviders.size,
      totalRepos: repos.length,
    },
    repos,
  };
}
