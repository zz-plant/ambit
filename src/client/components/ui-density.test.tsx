import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Item } from '../utils/configImporter';
import { useAmbitStore } from '../store/ambitStore';
import { metaKeyLabel } from '../utils/labels';
import App from '../App';
import NodeDetailPanel from './NodeDetailPanel';
import SetupView from './SetupView';

const capability: Item = {
  id: 'core',
  name: 'Core',
  type: 'framework',
  status: 'built',
  description: 'Core runtime',
  position: { x: 0, y: 0, z: 0 },
  meta: { domain: 'meta' },
};

const dependency: Item = {
  id: 'tool',
  name: 'Tool',
  type: 'mcp-server',
  status: 'built',
  description: 'Connected tool',
  position: { x: 0, y: 0, z: 0 },
  meta: { domain: 'backend' },
};

const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;

beforeAll(() => {
  const mediaQuery = {
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  };
  Object.assign(globalThis, {
    localStorage: {
      getItem: () => '1',
      setItem() {},
    },
    window: {
      location: { search: '?guide=off' },
      matchMedia: () => mediaQuery,
      addEventListener() {},
      removeEventListener() {},
      innerWidth: 1440,
    },
  });
});

beforeEach(() => {
  const serverState = useAmbitStore.getInitialState();
  serverState.items.splice(0, serverState.items.length, capability, dependency);
  serverState.connections.splice(0, serverState.connections.length, {
    from: capability.id,
    to: dependency.id,
    type: 'hard-dep',
  });
  serverState.selectedItem = capability.id;
  serverState.showDetailPanel = true;
  serverState.searchQuery = '';

  useAmbitStore.setState({
    items: [capability, dependency],
    connections: [{ from: capability.id, to: dependency.id, type: 'hard-dep' }],
    selectedItem: capability.id,
    showDetailPanel: true,
    searchQuery: '',
  });
});

afterAll(() => {
  const serverState = useAmbitStore.getInitialState();
  serverState.items.splice(0);
  serverState.connections.splice(0);
  serverState.selectedItem = null;
  serverState.showDetailPanel = false;
  serverState.searchQuery = '';
  useAmbitStore.setState({
    items: [],
    connections: [],
    selectedItem: null,
    showDetailPanel: false,
    searchQuery: '',
  });
  Object.assign(globalThis, {
    window: originalWindow,
    localStorage: originalLocalStorage,
  });
});

test('my setup lists each entry once and omits status chrome when nothing is filtered', () => {
  const html = renderToStaticMarkup(<SetupView onShow={() => {}} />);

  expect(html).toContain('Core');
  expect(html).toContain('Tool');
  expect(html).not.toContain('NAV:');
  expect(html).not.toContain('Showing 2 of 2');
  expect(html).not.toContain('Integrity:');
});

test('detail panel presents each relationship once, in its direction', () => {
  const html = renderToStaticMarkup(<NodeDetailPanel />);

  expect(html).toContain('Enables (1)');
  expect(html).not.toContain('Needs (');
  expect(html).not.toContain('DEPENDENCY FLOW');
  expect(html).not.toContain('most connected');
  expect(html).not.toContain('>1<');
});

test('detail panel states the impact instead of offering a command to copy', () => {
  const html = renderToStaticMarkup(<NodeDetailPanel />);

  expect(html).toContain('1 other capability would stop working');
  expect(html).not.toContain('ambit impact');
  // A check executes, so that one stays a command.
  expect(html).toContain('ambit verify core');
});

test('detail panel lists only the meta facts that exist', () => {
  // A local MCP server: no url, no tags, no region.
  const localServer: Item = {
    ...capability,
    meta: {
      transport: 'stdio',
      url: undefined,
      tags: [],
      region: '',
      owner: null,
      remote: false,
      restarts: 0,
    },
  };
  const serverState = useAmbitStore.getInitialState();
  serverState.items.splice(0, serverState.items.length, localServer, dependency);
  useAmbitStore.setState({ items: [localServer, dependency] });

  const html = renderToStaticMarkup(<NodeDetailPanel />);

  expect(html).not.toContain('undefined');
  expect(html).not.toContain(metaKeyLabel('url'));
  expect(html).not.toContain(metaKeyLabel('tags'));
  expect(html).not.toContain(metaKeyLabel('region'));
  expect(html).not.toContain(metaKeyLabel('owner'));

  // false and 0 are answers, not blanks.
  expect(html).toContain('title="stdio">stdio<');
  expect(html).toContain('title="false">false<');
  expect(html).toContain('title="0">0<');
});

test('application omits the footer that duplicates header status and documented shortcuts', () => {
  const html = renderToStaticMarkup(<App />);

  expect(html).not.toContain('app-footer');
  expect(html).not.toContain('KEYS:');
});

test('the application has no docked list; search is a control and My Setup is a view', () => {
  const html = renderToStaticMarkup(<App />);

  expect(html).not.toContain('toolchain-panel');
  expect(html).toContain('Search');
  expect(html).toContain('My Setup');
});
