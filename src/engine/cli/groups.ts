/**
 * The five nouns the commands group under, and the verbs each one owns.
 *
 * The verbs below used to sit in one flat list, which meant `help --all` was
 * the only way to find anything and the list itself taught nothing about how
 * the parts relate. Grouping is presentation, not a rename: every flat name
 * still dispatches, so nothing anyone has typed or scripted stops working, and
 * `ambit impact x` and `ambit graph impact x` are the same command.
 */
const GROUPS: Record<string, string[]> = {
  graph: ['impact', 'where', 'share', 'catalog', 'skills', 'sync', 'objects'],
  plan: [
    'goal',
    'next',
    'council',
    'opportunities',
    'roi',
    'propose',
    'portfolio',
    'reversible',
    'judge',
  ],
  check: [
    'verify',
    'authority',
    'can',
    'gate',
    'credentials',
    'weigh',
    'incidents',
    'budget',
    'doctor',
    'connect',
    'init-rules',
    'receipt',
    'ci',
  ],
  govern: [
    'people',
    'proposals',
    'approve',
    'reject',
    'apply',
    'rollback',
    'dispatch',
    'history',
    'audit',
    'delegation',
  ],
  report: [
    'work',
    'usage',
    'economics',
    'attention',
    'notify',
    'federation',
    'record',
    'signals',
    'preferences',
    'statusline',
  ],
};

/**
 * Resolves `<group> <verb>` to the verb the switch below dispatches on.
 *
 * `graph` is also a command in its own right (`graph surface`, `graph combos`),
 * so it only rewrites when the word after it is one this group actually owns.
 */
function resolveCommand(cmd: string | undefined, argv: string[]): { cmd?: string; argv: string[] } {
  if (cmd && cmd in ALIASES) return canonical(cmd, argv);
  if (!cmd || !(cmd in GROUPS)) return { cmd, argv };
  const sub = argv.find(a => !a.startsWith('--'));
  if (!sub) return { cmd, argv };
  const i = argv.indexOf(sub);
  const rest = [...argv.slice(0, i), ...argv.slice(i + 1)];
  if (GROUPS[cmd].includes(sub)) return { cmd: sub, argv: rest };
  // `ambit plan opportunity <id>`, an old name under its group.
  if (sub in ALIASES && GROUPS[cmd].includes(ALIASES[sub].to)) return canonical(sub, rest);
  return { cmd, argv };
}

/**
 * The names a command was also known by, and the one it is now.
 *
 * Seven commands had two names: a short form (`brief`, `digest`, `rules`), a
 * singular for one item beside the plural for the list (`proposal <id>` and
 * `proposals`, `opportunity <id>`, `incident resolve`), and `notify-approvals`
 * beside `notify`. Each pair was listed as two commands, and a reader had to
 * learn which to use where. Every old name still runs, here and only here: the
 * switch knows the canonical name alone, help lists only it, and a typo is
 * offered it.
 */
const ALIASES: Record<string, { to: string; flag?: string }> = {
  brief: { to: 'briefing' },
  digest: { to: 'attention' },
  rules: { to: 'init-rules' },
  proposal: { to: 'proposals' },
  opportunity: { to: 'opportunities' },
  incident: { to: 'incidents' },
  'notify-approvals': { to: 'notify', flag: '--approvals' },
};

function canonical(alias: string, argv: string[]): { cmd: string; argv: string[] } {
  const { to, flag } = ALIASES[alias];
  return { cmd: to, argv: flag ? [...argv, flag] : argv };
}

/**
 * The verbs that belong to no group: the first command, the session's opening
 * read, the help, and the two `cli.js` runs itself. With the groups and their
 * verbs, the whole of what a person can type first.
 */
const STANDALONE = ['seed', 'status', 'briefing', 'help', 'web', 'mcp'];

/** Every word that can start a command, for suggesting one a typo was meant to be. */
function commandWords(): string[] {
  return [...STANDALONE, ...Object.keys(GROUPS), ...Object.values(GROUPS).flat()];
}

export { ALIASES, GROUPS, STANDALONE, commandWords, resolveCommand };
