import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Item } from '../utils/configImporter';
import { useToolchainStore } from '../store/toolchainStore';
import App from '../App';
import CapabilityListPanel from './CapabilityListPanel';
import NodeDetailPanel from './NodeDetailPanel';

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
  const serverState = useToolchainStore.getInitialState();
  serverState.items.splice(0, serverState.items.length, capability, dependency);
  serverState.connections.splice(0, serverState.connections.length, {
    from: capability.id,
    to: dependency.id,
    type: 'hard-dep',
  });
  serverState.selectedItem = capability.id;
  serverState.showDetailPanel = true;
  serverState.searchQuery = '';

  useToolchainStore.setState({
    items: [capability, dependency],
    connections: [{ from: capability.id, to: dependency.id, type: 'hard-dep' }],
    selectedItem: capability.id,
    showDetailPanel: true,
    searchQuery: '',
  });
});

afterAll(() => {
  const serverState = useToolchainStore.getInitialState();
  serverState.items.splice(0);
  serverState.connections.splice(0);
  serverState.selectedItem = null;
  serverState.showDetailPanel = false;
  serverState.searchQuery = '';
  useToolchainStore.setState({
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

test('capability list omits redundant status chrome when no filter is active', () => {
  const html = renderToStaticMarkup(<CapabilityListPanel />);

  expect(html).not.toContain('NAV:');
  expect(html).not.toContain('Showing 2 of 2');
  expect(html).not.toContain('Integrity:');
});

test('detail panel presents each relationship once', () => {
  const html = renderToStaticMarkup(<NodeDetailPanel />);

  expect(html).toContain('Connected to (1)');
  expect(html).not.toContain('DEPENDENCY FLOW');
  expect(html).not.toContain('most connected');
  expect(html).not.toContain('>1<');
});

test('application omits the footer that duplicates header status and documented shortcuts', () => {
  const html = renderToStaticMarkup(<App />);

  expect(html).not.toContain('app-footer');
  expect(html).not.toContain('KEYS:');
});
