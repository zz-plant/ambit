import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { shellQuote } from './shell';

// What a person's shell would do with a pasted command, asked of a real shell.
// A test that only compared strings would pass for a quoting that a shell
// reads differently, so each word is round-tripped through `sh` and must come
// back as exactly what went in.
const asShellSees = (word: string): string =>
  execFileSync('sh', ['-c', `printf %s ${shellQuote(word)}`], { encoding: 'utf8' });

const NASTY = [
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell expansion, on purpose
  'skill:pdf-tools$(touch${IFS}/dev/null)',
  'skill:x`id`',
  'skill:a;b',
  'skill:a && b',
  'skill:a | b',
  'skill:a > b',
  'skill:a\nb',
  'skill:a b',
  "skill:it's",
  "'",
  "''",
  '"',
  '\\',
  '$HOME',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell expansion, on purpose
  '${HOME}',
  '~',
  '*',
  '#comment',
  '!',
  '',
  'skill:é ü 日本語',
  'skill:tab\there',
];

test('a plain id is left exactly as it is', () => {
  for (const id of [
    'combo:shell-execution',
    'act:shell-execution/run_command',
    'prop-20260926-1',
    'skill:pdf-tools',
    'human:web',
    'device:nuc',
    'repo:acme/playground',
    'a@b+c=d,e%f',
  ]) {
    expect(shellQuote(id)).toBe(id);
  }
});

test('anything a shell would read as more than one plain word is quoted', () => {
  expect(shellQuote('skill:a b')).toBe("'skill:a b'");
  expect(shellQuote('skill:x$(rm -rf ~)')).toBe("'skill:x$(rm -rf ~)'");
  expect(shellQuote("skill:it's")).toBe("'skill:it'\\''s'");
  expect(shellQuote('')).toBe("''");
});

test('a shell gives back exactly the word that was quoted, whatever it holds', () => {
  for (const word of NASTY) expect(asShellSees(word)).toBe(word);
});

test('a quoted id cannot end the command it sits in', () => {
  // The marker file is what an injection would leave behind. Run the whole
  // command line, not just the word, and look for it.
  const dir = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim();
  const id = `skill:x$(touch ${dir}/PWNED)`;
  execFileSync('sh', ['-c', `cd ${dir} && printf %s ambit verify ${shellQuote(id)} >/dev/null`]);
  const listing = execFileSync('ls', ['-A', dir], { encoding: 'utf8' });
  expect(listing).not.toContain('PWNED');
});
