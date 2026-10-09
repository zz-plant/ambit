import { useState } from 'react';
import { useAmbitStore } from '../store/ambitStore';

/** What a dropped file may be, and how big one of those ever is. */
const MAX_CONFIG_BYTES = 2_000_000;

/**
 * Where each runtime keeps the file a visitor would hand over. A person asked
 * to "drop your config" has to know which file that is, and most do not.
 *
 * Only runtimes whose file this tab can read are listed: the importer takes an
 * OpenCode config or an `mcpServers` block. Codex keeps TOML, Zed keeps
 * `context_servers` and Continue may nest its servers under `experimental`,
 * which only the engine's readers understand.
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
 * parsed in the tab and never sent anywhere. The welcome screen and the tour's
 * last step both take a config, and this is the one path they share.
 */
export function useConfigImport(onMapped?: () => void) {
  const loadFromJSON = useAmbitStore(s => s.loadFromJSON);
  const [error, setError] = useState<string | null>(null);

  const readText = (text: string) => {
    setError(null);
    if (!text.trim()) return;
    if (text.length > MAX_CONFIG_BYTES) {
      setError('That is far larger than an agent config. Nothing was read.');
      return;
    }
    if (loadFromJSON(text)) onMapped?.();
    else
      setError(
        'That is not an agent config or an `ambit graph` export — nothing in it to map. ' +
          'Is it JSON with an `mcpServers` or `mcp` block?'
      );
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_CONFIG_BYTES) {
      setError('That file is far larger than an agent config. Nothing was read.');
      return;
    }
    readText(await file.text());
  };

  /** The servers ticked, placed as a config holding just those. */
  const readPicked = (servers: string[]) => {
    setError(null);
    if (!servers.length) return;
    const config = { mcpServers: Object.fromEntries(servers.map(name => [name, {}])) };
    if (loadFromJSON(JSON.stringify(config), true)) onMapped?.();
  };

  return { readText, readFile, readPicked, error };
}
