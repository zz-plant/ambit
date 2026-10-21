/**
 * Every state the map draws a node in, each as a graph of one: the node, the
 * nodes it is counted against and never drawn, and the simulation running
 * over it. The specimen page draws these through MapScene, so a change to a
 * mark or a filter shows here as it will on the map.
 *
 * Pure, so a test holds that each specimen is the state its title names.
 */
import type { OutageRole } from '../components/civ/layout';
import type { mapKeys } from '../components/civ/marks';
import type { Connection, Item } from '../utils/configImporter';
import type { Showing } from '../utils/shareCard';

export type KeyName = keyof ReturnType<typeof mapKeys>;

export interface Specimen {
  title: string;
  /** The key entry that draws this state, shown beside it. */
  key?: KeyName;
  /** The node drawn. */
  item: Item;
  /** Counted and never drawn: what an outage stops, what a keystone enables. */
  unseen?: Item[];
  connections?: Connection[];
  simulation?: Showing;
  /** Drawn as the page draws a selection, or with the Keystone key pressed. */
  selected?: boolean;
  spotlight?: string;
  /** What `outageRole` should call the node, for an outage specimen. */
  role?: OutageRole;
}

const AT_REST: Showing = { mode: 'none', rootId: null, cascade: new Set() };

function node(
  id: string,
  name: string,
  meta: Record<string, unknown> = {},
  status: Item['status'] = 'built'
): Item {
  return {
    id: `combo:${id}`,
    name,
    type: 'possibility',
    status,
    description: '',
    position: { x: 0, y: 0, z: 0 },
    meta: { era: 1, lifecycle: status === 'built' ? 'configured' : 'unknown', ...meta },
  };
}

/** Five runs, oldest first, the last passing and `failed` of the four before it failing. */
const runs = (failed: number) =>
  [...Array(5)].map((_, id) => ({ id, passed: id === 4 || id < 4 - failed }));

/** Three reached nodes nobody sees, for a count to be made of. */
const others = [1, 2, 3].map(n => node(`unseen-${n}`, `Unseen ${n}`));
const outage = (rootId: string, hit: Partial<Pick<Showing, 'cascade' | 'weakened'>>): Showing => ({
  mode: 'outage',
  rootId,
  cascade: hit.cascade ?? new Set(),
  weakened: hit.weakened,
});

export const SPECIMENS: Specimen[] = [
  { title: 'Reached, never checked', key: 'reached', item: node('reached', 'File Editing') },
  {
    title: 'Proven: its check passed',
    key: 'passing',
    item: node('proven', 'Version Control', { lifecycle: 'verified' }),
  },
  {
    title: 'Next step, with its setup time',
    key: 'next',
    item: node('next', 'Vector Store', { next: true, setupSeconds: 1800 }, 'specified'),
  },
  ...[1, 2, 3].map(
    (blocks): Specimen => ({
      title: `Next step, asked for ${blocks} of 3`,
      key: 'askedFor',
      item: node(
        `asked-${blocks}`,
        'Vector Store',
        { next: true, setupSeconds: 1800, blocks },
        'specified'
      ),
    })
  ),
  {
    title: 'Blocked',
    key: 'blocked',
    item: node('blocked', 'Self-Hosted Stack', {}, 'specified'),
  },
  {
    title: 'Failing: its last check failed',
    key: 'failing',
    item: node('failing', 'Browser Automation', { lifecycle: 'broken' }),
  },
  ...[1, 2, 3, 4].map(
    (failed): Specimen => ({
      title: `Recovering, ${failed} of the last 5 failed`,
      key: 'recovering',
      item: node(`recovering-${failed}`, 'Observability', {
        lifecycle: 'degraded',
        history: runs(failed),
      }),
    })
  ),
  {
    title: 'Keystone, at rest',
    key: 'keystone',
    item: node('keystone', 'Tool Protocol'),
    connections: others.map(o => ({ from: 'combo:keystone', to: o.id, type: 'hard-dep' })),
  },
  {
    title: 'Keystone, its key pressed',
    key: 'keystone',
    item: node('keystone-lit', 'Tool Protocol'),
    connections: others.map(o => ({ from: 'combo:keystone-lit', to: o.id, type: 'hard-dep' })),
    spotlight: 'Keystone',
  },
  {
    title: 'Selected',
    item: node('selected', 'Web Research', { lifecycle: 'verified' }),
    selected: true,
  },
  {
    title: 'Needs a person',
    key: 'person',
    item: node('person', 'Continuous Delivery', { structure: ['institutional'] }),
  },
  {
    title: 'Runs on a device',
    key: 'device',
    item: node('device', 'Local Runtime', { structure: ['physical'] }),
  },
  {
    title: 'Outage: down, and what it stops',
    key: 'down',
    role: 'down',
    item: node('down', 'Shell Execution'),
    unseen: others,
    simulation: outage('combo:down', { cascade: new Set(others.map(o => o.id)) }),
  },
  {
    title: 'Outage: stops working',
    key: 'stops',
    role: 'stops',
    item: node('stops', 'Automated Tests'),
    simulation: outage('combo:elsewhere', { cascade: new Set(['combo:stops']) }),
  },
  {
    title: 'Outage: loses a provider',
    key: 'losesProvider',
    role: 'loses a provider',
    item: node('thinned', 'Data Access'),
    simulation: outage('combo:elsewhere', { weakened: new Set(['combo:thinned']) }),
  },
  {
    title: 'Outage: cut off',
    key: 'cutOff',
    role: 'cut off',
    item: node('cut', 'Agent Swarm', {}, 'specified'),
    simulation: outage('combo:elsewhere', { cascade: new Set(['combo:cut']) }),
  },
  {
    title: 'Outage: already failing, keeps its stripes',
    key: 'failing',
    item: node('failing-hit', 'Browser Automation', { lifecycle: 'broken' }),
    simulation: outage('combo:elsewhere', { cascade: new Set(['combo:failing-hit']) }),
  },
];

export const simulationOf = (s: Specimen): Showing => s.simulation ?? AT_REST;
