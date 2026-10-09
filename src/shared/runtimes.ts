/**
 * The hosted model a runtime runs on when its config names none.
 *
 * Claude Code runs on Anthropic's models whether or not `settings.json` pins
 * one, and its config usually does not. Read as written, that config declared
 * no provider, so the first thing `ambit` told a Claude Code user was to set
 * up Hosted Inference, the one thing their agent was already doing. The same
 * held for every client whose model comes with it.
 *
 * Only a runtime whose model is not the person's choice to make elsewhere is
 * listed. Cline, Roo Code, Continue, Zed and VS Code each take a provider the
 * person picks, which can be a local one, so for them the config is the only
 * honest answer. The engine's readers and the page's importer both read this
 * table, so the two place a setup on the same tree.
 */
export const RUNTIME_MODEL: Readonly<Record<string, { id: string; name: string }>> = {
  'claude-code': { id: 'anthropic', name: 'Anthropic' },
  'claude-desktop': { id: 'anthropic', name: 'Anthropic' },
  codex: { id: 'openai', name: 'OpenAI' },
  'gemini-cli': { id: 'google', name: 'Google' },
  cursor: { id: 'cursor', name: 'Cursor' },
  windsurf: { id: 'windsurf', name: 'Windsurf' },
};

/**
 * What every runtime brings before its config adds anything: the model's own
 * reasoning, a shell, file editing and language-server diagnostics. The
 * engine seeds these on every machine, and the page adds them to a pasted
 * config, so a file that lists only MCP servers is not placed as an agent that
 * cannot run a command.
 */
export const BUILT_INS: ReadonlyArray<{
  id: string;
  name: string;
  domain: string;
  description: string;
  kind: 'meta' | 'tool';
  maturity: number;
}> = [
  {
    id: 'core:reasoning',
    name: 'Core Reasoning',
    domain: 'meta',
    description: 'Base LLM reasoning',
    kind: 'meta',
    maturity: 1,
  },
  {
    id: 'tool:bash',
    name: 'Shell Execution',
    domain: 'infra',
    description: 'Run commands',
    kind: 'tool',
    maturity: 1,
  },
  {
    id: 'tool:edit',
    name: 'File Editor',
    domain: 'meta',
    description: 'Edit files',
    kind: 'tool',
    maturity: 1,
  },
  {
    id: 'tool:lsp',
    name: 'LSP Diagnostics',
    domain: 'quality',
    description: 'Language server',
    kind: 'tool',
    maturity: 0.95,
  },
];
