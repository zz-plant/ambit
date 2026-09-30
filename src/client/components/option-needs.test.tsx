/**
 * What each way of acquiring a capability needs, and whether it is here.
 *
 * "What would pay back" compared options on cost and privacy, and left the
 * question a person asks first unanswered: what does this need that I already
 * have? The graph can say which required prerequisites are reached and passing,
 * so the line says it, in words, with missing ones first. It cannot say whether
 * a binary is installed or a network reachable, and it does not draw a mark for
 * either. Where the curated tree gives an alternative a config patch, the entry
 * is shown as text to read and paste, and nothing on the page runs it.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test } from 'vitest';
import type { LoopOpportunity } from '../../shared/api';
import { mergeGraphs, useAmbitStore } from '../store/ambitStore';
import { demoConfigGraph, demoTreeGraph } from '../store/demo';
import type { Connection, Item } from '../utils/configImporter';
import { demoSnapshot } from '../utils/demoSnapshot';
import LoopDashboard from './LoopDashboard';

/** `renderToStaticMarkup` reads zustand's initial state, so both halves are set. */
function seed(state: Partial<ReturnType<typeof useAmbitStore.getState>>) {
  Object.assign(useAmbitStore.getInitialState(), state);
  useAmbitStore.setState(state);
}

afterEach(() => {
  seed({
    items: [],
    connections: [],
    loop: null,
    loopSource: null,
    loopEmpty: false,
  });
});

const node = (id: string, over: Partial<Item> = {}, meta: Record<string, unknown> = {}): Item => ({
  id,
  name: id.replace(/^[a-z]+:/, ''),
  type: 'possibility',
  status: 'specified',
  description: '',
  position: { x: 0, y: 0, z: 0 },
  meta: { era: 1, ...meta },
  ...over,
});
const reached = (id: string, meta: Record<string, unknown> = {}) =>
  node(id, { status: 'built' }, { lifecycle: 'verified', ...meta });
const requires = (from: string, to: string): Connection => ({
  from,
  to,
  type: 'hard-dep',
  kind: 'requires',
});

const OPTIONS: NonNullable<LoopOpportunity['acquisition_options']> = [
  { provider: 'a hosted way', kind: 'buy', privacy: 'hosted' },
  { provider: 'a local way', kind: 'build', privacy: 'local' },
];

/** The page with one opportunity, on a graph of the given nodes. */
function page(
  graph: { items: Item[]; connections: Connection[] },
  options: LoopOpportunity['acquisition_options'] = OPTIONS
) {
  const snapshot = demoSnapshot();
  const opportunity: LoopOpportunity = {
    ...snapshot.opportunities[0],
    capability_id: 'combo:goal',
    capability: 'Goal',
    acquisition_options: options,
  };
  seed({
    ...graph,
    loop: { ...snapshot, opportunities: [opportunity] },
    loopSource: 'ledger',
    loopEmpty: false,
  });
  return renderToStaticMarkup(<LoopDashboard />);
}

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

/** A goal that needs one thing that is here and one that is not. */
const oneOfTwo = {
  items: [node('combo:goal'), reached('combo:have'), node('combo:lack')],
  connections: [requires('combo:have', 'combo:goal'), requires('combo:lack', 'combo:goal')],
};

test('an option with two required prerequisites, one reached, reads 1 of 2 met here and names the missing one', () => {
  const said = text(page(oneOfTwo));
  expect(said).toContain('Needs · required prerequisites: 1 of 2 met here');
  expect(said).toMatch(/lack\s*missing/i);
  expect(said).toMatch(/have\s*met/i);
});

test('the missing one is named before the one that is met', () => {
  const html = page(oneOfTwo);
  expect(html.indexOf('>lack<')).toBeGreaterThan(-1);
  expect(html.indexOf('>lack<')).toBeLessThan(html.indexOf('>have<'));
});

test('every option of one capability needs the same things, so the line is drawn once, above them', () => {
  const html = page(oneOfTwo);
  expect(html.match(/fig-needs-head/g)).toHaveLength(1);
  expect(html.indexOf('fig-needs-head')).toBeLessThan(html.indexOf('fig-options'));
  // And both options are still drawn.
  expect(text(html)).toContain('a hosted way');
  expect(text(html)).toContain('a local way');
});

test('required is the glossary word, and the line carries its definition', () => {
  const html = page(oneOfTwo);
  expect(html).toContain('class="term"');
  expect(html).not.toContain('Hard prerequisite');
});

test('a prerequisite that is reached and failing is missing, and says its check is failing', () => {
  const said = text(
    page({
      items: [node('combo:goal'), reached('combo:flaky', { lifecycle: 'degraded' })],
      connections: [requires('combo:flaky', 'combo:goal')],
    })
  );
  expect(said).toContain('0 of 1 met here');
  expect(said).toMatch(/flaky\s*missing\s*its check is failing/i);
});

test('past five, the rest are counted and not listed', () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(k => reached(`combo:${k}`));
  const said = text(
    page({
      items: [node('combo:goal'), ...many],
      connections: many.map(m => requires(m.id, 'combo:goal')),
    })
  );
  expect(said).toContain('7 of 7 met here');
  expect(said).toContain('and 2 more');
});

test('a declared credential is named, and never marked met or missing', () => {
  const html = page({
    items: [
      node('combo:goal'),
      reached('combo:vc', { providers: ['mcp:github'] }),
      reached('mcp:github', { credentials: ['cred:gh'] }),
      node('cred:gh', { name: 'GitHub user token', status: 'built', type: 'config' }, {}),
    ],
    connections: [requires('combo:vc', 'combo:goal')],
  });
  const said = text(html);
  expect(said).toContain('Rests on declared credentials: GitHub user token.');
  expect(said).toContain('cannot say it works');
  // One prerequisite, so one mark: the credential added none.
  expect(said).toContain('1 of 1 met here');
});

test('a capability that needs nothing draws no line, and none is drawn off the graph', () => {
  expect(page({ items: [node('combo:goal')], connections: [] })).not.toContain('fig-needs');
  // The opportunity names a node this graph does not hold.
  expect(page({ items: [], connections: [] })).not.toContain('fig-needs');
});

test('only a patch gets an install entry, shown as text with a way to copy it', () => {
  const patch = JSON.stringify(
    { mcp: { fetch: { command: ['uvx', 'mcp-server-fetch'] } } },
    null,
    2
  );
  const html = page(oneOfTwo, [
    { provider: 'a hosted way', kind: 'buy', privacy: 'hosted' },
    { provider: 'a local way', kind: 'build', privacy: 'local', install: patch },
  ]);

  // One option has a patch, so one entry.
  expect(html.match(/<details class="fig-install"/g)).toHaveLength(1);
  expect(html).toContain('mcp-server-fetch');
  expect(text(html)).toContain('Install: add this entry to your agent config');
  expect(text(html)).toContain('Copy the entry');
});

test('the install entry is text: nothing on it runs, opens or submits', () => {
  const html = page(oneOfTwo, [
    {
      provider: 'a local way',
      kind: 'build',
      privacy: 'local',
      install: '{ "mcp": { "x": { "command": ["rm", "-rf", "/"] } } }',
    },
  ]);
  const from = html.indexOf('<details class="fig-install"');
  const entry = html.slice(from, html.indexOf('</details>', from));
  expect(entry).toContain('<pre>');
  // A summary, the text and one button that copies: no link, form or frame.
  expect(entry).not.toMatch(/<(a|form|iframe|script|input)\b/);
  expect(entry.match(/<button/g)).toHaveLength(1);
  expect(entry).toContain('fig-install-copy');
});

test('an option with no patch shows no install line', () => {
  expect(page(oneOfTwo)).not.toContain('fig-install');
});

test('nothing the graph did not state reaches the line as a value', () => {
  // A prerequisite with no metadata at all, a credential with no node, and an
  // option that is priced nowhere: each is absence, and absence is left out.
  const bare = {
    items: [node('combo:goal'), { ...node('combo:needed'), meta: {} }],
    connections: [requires('combo:needed', 'combo:goal')],
  };
  const withOrphanCredential = {
    items: [
      node('combo:goal'),
      reached('combo:vc', { providers: ['mcp:x'] }),
      reached('mcp:x', { credentials: ['cred:unlisted'] }),
    ],
    connections: [requires('combo:vc', 'combo:goal')],
  };
  for (const graph of [bare, withOrphanCredential, oneOfTwo]) {
    const html = page(graph);
    for (const marker of ['undefined', 'NaN', 'Invalid Date', '[object Object]', 'null']) {
      expect(html.includes(marker), `rendered "${marker}"`).toBe(false);
    }
  }
});

test('the demo states what its opportunities need, and shows one entry to paste', () => {
  const { items, connections } = mergeGraphs(demoTreeGraph(), demoConfigGraph());
  seed({ items, connections, loop: demoSnapshot(), loopSource: 'sample', loopEmpty: false });
  const html = renderToStaticMarkup(<LoopDashboard />);
  const said = text(html);

  // The invoice opportunity waits on capabilities that are not reached.
  expect(said).toMatch(/Needs · required prerequisites: \d+ of \d+ met here/);
  expect(said).toMatch(/Subagents\s*missing/);
  // Embeddings is a next step whose one requirement is in place.
  expect(said).toContain('1 of 1 met here');
  // And one option carries an entry to paste.
  expect(html.match(/<details class="fig-install"/g)).toHaveLength(1);
  expect(html).toContain('nomic-embed-text');
});
