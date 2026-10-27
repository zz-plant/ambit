import { useState } from 'react';
import { useAmbitStore } from '../store/ambitStore';
import type { TabRuntime } from '../utils/placeInTab';

/** What a dropped file may be, and how big one of those ever is. */
const MAX_CONFIG_BYTES = 2_000_000;

/**
 * Where each runtime keeps the file a visitor would hand over. A person asked
 * to "drop your config" has to know which file that is, and most do not.
 *
 * Only runtimes whose file this tab can read are listed: the importer takes an
 * OpenCode config or an `mcpServers` block. Codex keeps TOML, Goose keeps
 * YAML, Zed keeps `context_servers`, Amp keeps `amp.mcpServers` and Continue
 * may nest its servers under `experimental`, which only the engine's readers
 * understand.
 */
export const CONFIG_PATHS: { runtime: string; path: string }[] = [
  { runtime: 'Claude Code', path: '~/.claude.json' },
  {
    runtime: 'Claude Desktop',
    path: '~/Library/Application Support/Claude/claude_desktop_config.json',
  },
  { runtime: 'Cursor', path: '~/.cursor/mcp.json' },
  { runtime: 'OpenCode', path: '~/.config/opencode/opencode.json' },
  { runtime: 'Windsurf', path: '~/.codeium/windsurf/mcp_config.json' },
  { runtime: 'Gemini CLI', path: '~/.gemini/settings.json' },
  {
    runtime: 'Cline',
    path: '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
  },
  {
    runtime: 'Roo Code',
    path: '~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json',
  },
  { runtime: 'Copilot CLI', path: '~/.copilot/mcp-config.json' },
  { runtime: 'Kiro', path: '~/.kiro/settings/mcp.json' },
];

/**
 * The agents the intake asks about before anything else. Which one a visitor
 * uses decides what their setup is placed with: the model it runs on, the
 * file to paste, and whether the tab can read that file at all. The question
 * used to come last or never, so three ticked servers were placed for "your
 * agent" with no model, and the count disagreed with what `npx ambit-cli`
 * then read on the same machine.
 *
 * `path` is where the file is that this tab can read. Codex keeps TOML, which
 * only the engine's readers parse, so for Codex the intake offers the servers
 * to tick and the CLI. The last is the visitor whose agent is not listed.
 */
export const AGENTS: { runtime: TabRuntime; path?: string }[] = [
  { runtime: { id: 'claude-code', name: 'Claude Code' }, path: '~/.claude.json' },
  { runtime: { id: 'cursor', name: 'Cursor' }, path: '~/.cursor/mcp.json' },
  { runtime: { id: 'opencode', name: 'OpenCode' }, path: '~/.config/opencode/opencode.json' },
  { runtime: { id: 'codex', name: 'Codex CLI' } },
  { runtime: { id: 'windsurf', name: 'Windsurf' }, path: '~/.codeium/windsurf/mcp_config.json' },
  { runtime: { id: 'gemini-cli', name: 'Gemini CLI' }, path: '~/.gemini/settings.json' },
  {
    runtime: { id: 'claude-desktop', name: 'Claude Desktop' },
    path: '~/Library/Application Support/Claude/claude_desktop_config.json',
  },
  { runtime: { id: null, name: 'Another' } },
];

/**
 * What a visitor can pick when no config file is at hand: the servers people
 * most often run, each named so the tree's `detect` patterns match it the way
 * they match the same server in a real config. Finding a file in a hidden
 * directory is where a visitor gives up, and ticking four of these is not.
 * `picks.test.ts` holds that each one places something on the map.
 */
export const PICKS: { label: string; server: string }[] = [
  { label: 'GitHub', server: 'github' },
  { label: 'Playwright', server: 'playwright' },
  { label: 'Postgres', server: 'postgres' },
  { label: 'Supabase', server: 'supabase' },
  { label: 'Linear', server: 'linear' },
  { label: 'Jira', server: 'jira' },
  { label: 'Slack', server: 'slack' },
  { label: 'Sentry', server: 'sentry' },
  { label: 'Web search', server: 'brave-search' },
  { label: 'Memory', server: 'memory' },
  { label: '1Password', server: '1password' },
  { label: 'Stripe', server: 'stripe' },
  { label: 'Vercel', server: 'vercel' },
  { label: 'Cloudflare', server: 'cloudflare' },
  { label: 'Docker', server: 'docker' },
  { label: 'Ollama', server: 'ollama' },
];

/**
 * Map a config the visitor hands over, in their own browser: a file dropped or
 * picked, or text pasted. Reading it needs no engine and no upload; it is
 * parsed in the tab and never sent anywhere. The welcome screen, the tour's
 * first card and the Map yours dialog all take a config, and this is the one
 * path they share. `agent` is the one the visitor said they use, if they did.
 */
export function useConfigImport(onMapped?: () => void, agent?: TabRuntime | null) {
  const loadFromJSON = useAmbitStore(s => s.loadFromJSON);
  const [error, setError] = useState<string | null>(null);
  // "Another" names no runtime, which is what the file's own shape is for.
  const hint = agent?.id ? agent : undefined;

  const readText = (text: string) => {
    setError(null);
    if (!text.trim()) return;
    if (text.length > MAX_CONFIG_BYTES) {
      setError(
        'Nothing was read: that is over 2 MB, far larger than any agent config. Paste the config file itself.'
      );
      return;
    }
    if (loadFromJSON(text, false, hint)) onMapped?.();
    else
      setError(
        'Nothing to map: this is neither an agent config nor the output of ambit graph. ' +
          'Paste JSON with an mcpServers or mcp block.'
      );
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_CONFIG_BYTES) {
      setError(
        'Nothing was read: that file is over 2 MB, far larger than any agent config. Choose the config file itself.'
      );
      return;
    }
    readText(await file.text());
  };

  /** The servers ticked, placed as a config holding just those. */
  const readPicked = (servers: string[]) => {
    setError(null);
    if (!servers.length) return;
    const config = { mcpServers: Object.fromEntries(servers.map(name => [name, {}])) };
    if (loadFromJSON(JSON.stringify(config), true, hint)) onMapped?.();
  };

  return { readText, readFile, readPicked, error };
}
