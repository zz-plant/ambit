import { useState } from 'react';
import { useAmbitStore } from '../store/ambitStore';

/** What a dropped file may be, and how big one of those ever is. */
const MAX_CONFIG_BYTES = 2_000_000;

/**
 * Where each runtime keeps the file a visitor would hand over. A person asked
 * to "drop your config" has to know which file that is, and most do not.
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

  return { readText, readFile, error };
}
