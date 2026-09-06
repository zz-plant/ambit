/**
 * The five nouns the commands group under, and the verbs each one owns.
 */

/**
 * The five nouns the commands group under, and the verbs each one owns.
 *
 * There are thirty-five commands. They used to sit in one flat list, which
 * meant `help --all` was the only way to find anything and the list itself
 * taught nothing about how the parts relate. Grouping is presentation, not a
 * rename: every flat name still dispatches, so nothing anyone has typed or
 * scripted stops working — `ambit impact x` and `ambit graph impact x` are the
 * same command.
 */
const GROUPS: Record<string, string[]> = {
  graph: ['impact', 'where', 'share', 'catalog', 'skills', 'sync', 'objects'],
  plan: [
    'goal',
    'next',
    'opportunities',
    'opportunity',
    'roi',
    'propose',
    'portfolio',
    'reversible',
  ],
  check: ['verify', 'authority', 'can', 'credentials', 'incidents', 'incident', 'budget'],
  govern: [
    'proposals',
    'proposal',
    'approve',
    'reject',
    'apply',
    'rollback',
    'history',
    'audit',
    'delegation',
  ],
  report: [
    'work',
    'usage',
    'economics',
    'attention',
    'digest',
    'notify',
    'notify-approvals',
    'federation',
    'record',
    'signals',
    'preferences',
  ],
};

/**
 * Resolves `<group> <verb>` to the verb the switch below dispatches on.
 *
 * `graph` is also a command in its own right (`graph surface`, `graph combos`),
 * so it only rewrites when the word after it is one this group actually owns.
 */
function resolveCommand(cmd: string | undefined, argv: string[]): { cmd?: string; argv: string[] } {
  if (!cmd || !(cmd in GROUPS)) return { cmd, argv };
  const sub = argv.find(a => !a.startsWith('--'));
  if (!sub || !GROUPS[cmd].includes(sub)) return { cmd, argv };
  const i = argv.indexOf(sub);
  return { cmd: sub, argv: [...argv.slice(0, i), ...argv.slice(i + 1)] };
}

export { GROUPS, resolveCommand };
