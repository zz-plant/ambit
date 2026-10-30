/**
 * One name per concept, across every surface a person reads.
 *
 * An audit of the interface found five concepts with four names each. A node
 * whose prerequisites are met was "Next step" in the legend, "one step away"
 * in the header, "next" in the glossary and "the frontier" in the README. The
 * ● circle was a Combo in the legend, a Possibility in the detail panel and a
 * Tech tree node in the docs. None of it was wrong; all of it defeated the
 * learning a reader had already done.
 *
 * Prose is not typechecked, so the rule is held here: the words below are the
 * ones the glossary defines, and a synonym reaching a user-facing file fails
 * this test with the word to use instead.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import concepts from '../shared/concepts.json';
import { statusLabel, typeLabel } from './utils/labels';

const CLIENT_DIR = import.meta.dirname;

/** Every .ts/.tsx file under src/client, except the tests and this rule itself. */
function clientSources(dir = CLIENT_DIR): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...clientSources(path));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) out.push(path);
  }
  return out;
}

/**
 * Synonyms that have been in the interface, and the word that replaced each.
 *
 * A banned word is banned in *user-facing strings*; the reason a file may
 * still contain it — a comment explaining the history, an internal field name
 * — is why the check looks only at what could be rendered.
 */
const RETIRED: Record<string, string> = {
  Possibility: 'Combo',
  'Tech tree node': 'Combo',
  'one step away': 'next step',
  'Hard prerequisite': 'Required',
  'Soft prerequisite': 'Optional',
  Bottleneck: 'Keystone',
  // One state, one phrase. The plain words replaced `autonomous` in every
  // sentence a person reads; the mode keeps its own name in the data model.
  'Acts without asking': 'Runs without asking',
  'may act without asking': 'Runs without asking',
  'run unattended': 'Runs without asking',
};

/** Quoted strings and JSX text — what a reader could actually end up seeing. */
function readableText(source: string): string {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const quoted = withoutComments.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? [];
  // Newlines allowed: JSX prose is wrapped by the formatter, so a legend
  // label or a sentence often sits on its own line between the tags.
  const jsxText = withoutComments.match(/>[^<>{}]{3,}</g) ?? [];
  return [...quoted, ...jsxText].join('\n');
}

test('no surface uses a name the glossary retired', () => {
  const offences: string[] = [];
  for (const file of clientSources()) {
    const text = readableText(readFileSync(file, 'utf8'));
    for (const [retired, replacement] of Object.entries(RETIRED)) {
      if (text.includes(retired)) {
        offences.push(`${file.replace(CLIENT_DIR, 'src/client')}: "${retired}" → "${replacement}"`);
      }
    }
  }
  expect(offences).toEqual([]);
});

/**
 * The same rule for the two surfaces the client check never read: the words
 * `ambit` prints, and the words an agent is given over MCP.
 *
 * The glossary claims every term is "the exact word the interface uses", and
 * the interface is more than the page. `ambit status` said "proven" for the
 * term the glossary calls Verified, `ambit help` called an opportunity an
 * investment, and a capability that runs without asking was "needs approval"
 * on one surface and "ask first" on another. Each phrase below reached a
 * person and was replaced; a new one reaching a person again fails here.
 */
const RETIRED_PLATFORM: Record<string, string> = {
  'needs approval': 'asks first',
  'ranked investments': 'ranked opportunities',
  'proposed acquisitions': 'opportunities',
  'find friction': 'what interrupts you',
  'the system can do': 'the setup can do',
};

/** The terminal's own files, and the one that describes every MCP tool. */
function platformSources(): string[] {
  const root = join(CLIENT_DIR, '..', '..');
  const cli = join(root, 'src', 'engine', 'cli');
  const files = readdirSync(cli)
    .filter(name => name.endsWith('.ts') && !name.includes('.test.'))
    .map(name => join(cli, name));
  return [...files, join(root, 'src', 'engine', 'cli.ts'), join(root, 'src', 'mcp', 'tools.ts')];
}

test('the terminal and the MCP roster use the same words as the glossary', () => {
  const offences: string[] = [];
  for (const file of platformSources()) {
    const text = readableText(readFileSync(file, 'utf8'));
    for (const [retired, replacement] of Object.entries(RETIRED_PLATFORM)) {
      if (text.includes(retired)) {
        offences.push(`${file.split('/ambit/')[1]}: "${retired}" → "${replacement}"`);
      }
    }
  }
  expect(offences).toEqual([]);
});

test('the labels that name a concept use the glossary term exactly', () => {
  const terms = new Map(concepts.concepts.map(c => [c.key, c.term]));
  expect(typeLabel('possibility')).toBe(terms.get('combo'));
  expect(typeLabel('mcp-server')).toBe(terms.get('tool-server'));
  // The three states are one entry, since they are read as a set.
  expect(terms.get('state')).toContain('Reached');
  expect(terms.get('state')).toContain('next step');
  expect(terms.get('state')).toContain('blocked');
});

test('a status is worded for the graph it came from', () => {
  const treeNode = { meta: { era: 3, state: 'locked', next: true } } as never;
  const blockedNode = { meta: { era: 3, state: 'locked', next: false } } as never;
  const configEntry = { meta: { domain: 'devops' } } as never;

  // A config entry is enabled or disabled; nothing about it was ever reached.
  expect(statusLabel('built', configEntry)).toBe('Enabled');
  expect(statusLabel('specified', configEntry)).toBe('Disabled');

  expect(statusLabel('built', treeNode)).toBe('Reached');
  expect(statusLabel('specified', treeNode)).toBe('Next step');
  expect(statusLabel('specified', blockedNode)).toBe('Blocked');
});

test('every term the glossary defines is a term some surface uses', () => {
  // The other direction of the same rule: a definition nobody meets is either
  // a term to put on screen or one to delete. CLI-only terms name their
  // command in `seen`, which is how they declare themselves.
  const sources = clientSources()
    .map(f => readFileSync(f, 'utf8'))
    .join('\n');
  const unused = concepts.concepts
    .filter(c => !/ambit /.test(c.seen))
    .filter(c => !sources.includes(`'${c.key}'`) && !sources.includes(`"${c.key}"`))
    .map(c => c.term);
  expect(unused).toEqual([]);
});
