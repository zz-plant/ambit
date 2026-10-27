/**
 * One name for each command, one meaning for each flag, one default window.
 *
 * Seven commands had two names, `--by` named a person in five commands and a
 * ranking in one, `approve` and `reject` took the person as a trailing word
 * where every other decision took `--by`, and `attention` looked back 7 days
 * while the page showing the same ledger looked back 30. Every old spelling
 * still runs; these hold that it does, and that the new one is the one taught.
 */
import { expect, test } from 'vitest';
import { ALIASES, GROUPS, commandWords, resolveCommand } from './groups.ts';
import { HELP, groupHelp } from './help.ts';
import { DEFAULT_WINDOW_DAYS } from '../vocabulary.ts';
import { WITH_PEOPLE, cli, seed } from '../testing/cli.ts';

test('every old name runs as the command it now is, and help teaches only the new one', () => {
  expect(resolveCommand('brief', [])).toEqual({ cmd: 'briefing', argv: [] });
  expect(resolveCommand('proposal', ['prop-1'])).toEqual({ cmd: 'proposals', argv: ['prop-1'] });
  expect(resolveCommand('notify-approvals', ['t'])).toEqual({
    cmd: 'notify',
    argv: ['t', '--approvals'],
  });
  // Under its group as well.
  expect(resolveCommand('plan', ['opportunity', 'opp-1'])).toEqual({
    cmd: 'opportunities',
    argv: ['opp-1'],
  });
  for (const alias of Object.keys(ALIASES)) {
    expect([alias, commandWords().includes(alias)]).toEqual([alias, false]);
    expect([alias, new RegExp(`\\b${alias} [<\\[]`).test(HELP)]).toEqual([alias, false]);
  }
});

// `judge` dispatched for ten days with ten subcommands, and neither `help --all`
// nor `ambit plan` named it, while a typo near it was offered the word.
test('every verb a group owns is taught under that group', () => {
  for (const [group, verbs] of Object.entries(GROUPS))
    for (const verb of verbs)
      expect([verb, groupHelp(group).includes(`${group} ${verb}`)]).toEqual([verb, true]);
});

test('a decision is taken by --by, or by the one person declared, and a mistyped name is refused', () => {
  seed(WITH_PEOPLE).close();
  const first = cli('propose', 'web-research');
  // No name given: the one person the graph knows.
  expect(cli('approve', first.proposal).approved_by).toBe('Kanav');

  const second = cli('propose', 'web-research');
  // The old trailing form still works, and a name nobody declared is refused,
  // not read as a second proposal and approved under the default person.
  expect(cli('approve', second.proposal, 'nobody').error).toContain('not a person in the graph');
  expect(cli('proposals', second.proposal).status).toBe('draft');

  // A reason has spaces; it is filed as the reason, under the one person.
  const rejected = cli('reject', second.proposal, 'too much for now');
  expect(rejected.error).toBeUndefined();
  expect(cli('reject', second.proposal, 'nbody').error).toBeDefined();
});

test('the ranking of opportunities is --rank, and --by still means it there', () => {
  seed(WITH_PEOPLE).close();
  expect(cli('opportunities', '--rank=cash').error).toBeUndefined();
  expect(cli('opportunities', '--by=cash').error).toBeUndefined();
});

test('a report over the ledger looks back the one default window, and --days moves it', () => {
  seed(WITH_PEOPLE).close();
  expect(DEFAULT_WINDOW_DAYS).toBe(30);
  expect(cli('attention').window_days).toBe(DEFAULT_WINDOW_DAYS);
  expect(cli('attention', '--days=7').window_days).toBe(7);
  expect(cli('attention', '7').window_days).toBe(7);
});
