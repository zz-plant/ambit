/**
 * Scaffold a declared check that is provably read-only.
 *
 * `ambit check init <capability>` prints a `verify` block for the person to
 * paste into the tree (or a config overlay). A check is a command that runs on
 * whoever opens the graph, so the scaffold does two things: it refuses commands
 * that look like they write, and it never registers anything — the block is
 * printed, the person pastes it, and the engine never runs it until `ambit
 * verify` is typed.
 *
 * The read-only guard is a heuristic, not a sandbox. A command is words in a
 * config file; the engine runs it as-is. The guard refuses the obvious write
 * shapes and says so; it is a tripwire for a paste, not a confinement boundary.
 */
const DEFAULT_TIMEOUT_SECONDS = 10;

/** A shell token that writes, however it is spelled. */
const WRITE_TOKENS: { re: RegExp; why: string }[] = [
  { re: />\s*\S/, why: 'redirect a file (>)' },
  { re: />>/, why: 'append to a file (>>)' },
  { re: /\b(rm|mv|cp|dd|truncate|touch|mkdir|chmod|chown|ln)\b/, why: 'mutate the filesystem' },
  { re: /\btee\b/, why: 'write a stream to a file' },
  { re: /curl[^\n]*\s-(o|O)\b/, why: 'write a file with curl (-o/-O)' },
  { re: /wget[^\n]*\s-(O|o)\b/, why: 'write a file with wget (-O/-o)' },
  {
    re: /\b(git|svn|hg)\s+(push|commit|add|rebase|reset|tag|branch|merge)\b/,
    why: 'mutate a repository',
  },
  {
    re: /\b(npm|pnpm|yarn|bun|pip|pipx|gem|cargo)\s+(publish|install|add|remove|uninstall)\b/,
    why: 'install or publish packages',
  },
  { re: /\b(openssl|ssh-keygen)\s+(genrsa|genpkey|req)\b/, why: 'write keys' },
];

/** Why a command would write, or undefined when none of the obvious shapes match. */
function readOnlyViolation(command: string): string | undefined {
  const seen = WRITE_TOKENS.find(w => w.re.test(command));
  return seen ? seen.why : undefined;
}

/** The scaffolded block, from a command a person typed or a placeholder. */
function checkInit(
  db: any,
  capabilityId: string,
  opts: { command?: string } = {}
): {
  capability: string;
  id: string;
  verify?: { command: string[]; timeout_seconds: number };
  command?: string;
  note?: string;
  error?: string;
} {
  const id = capabilityId.startsWith('combo:') ? capabilityId : `combo:${capabilityId}`;
  const node = db
    .prepare('SELECT id, name, description FROM capabilities WHERE id = ? AND kind = ?')
    .get(id, 'capability');
  if (!node)
    return {
      capability: capabilityId,
      id,
      error: `No capability ${id} in the graph. Run ambit seed, or use an id from ambit graph combos.`,
    };

  if (opts.command) {
    const violation = readOnlyViolation(opts.command);
    if (violation)
      return {
        capability: node.name,
        id,
        error: `Refused: this check would ${violation}. A check is a command that runs on whoever opens the graph; declare a read-only probe.`,
      };
    return {
      capability: node.name,
      id,
      command: opts.command,
      verify: { command: ['sh', '-c', opts.command], timeout_seconds: DEFAULT_TIMEOUT_SECONDS },
      note: "Paste this into the node's verify block. It is printed, not registered: nothing runs until you type ambit verify.",
    };
  }

  // No command given: a placeholder that names what a check for this capability
  // should prove, and how it is made read-only.
  return {
    capability: node.name,
    id,
    verify: {
      command: ['sh', '-c', '<a read-only command that proves this capability works>'],
      timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
    },
    note: `A check is a command that runs on whoever opens the graph, so make it read-only: probe, never mutate. Common shapes: \`command -v <binary>\`, \`test -f <path>\`, a \`curl -sf\` HEAD. Re-run with --command="<your probe>" to scaffold and validate it.`,
  };
}

export { checkInit, readOnlyViolation, WRITE_TOKENS };
