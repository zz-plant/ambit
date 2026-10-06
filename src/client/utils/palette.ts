/**
 * The finder's actions: what can be done to a node, and what can be opened,
 * as a list the finder searches beside the nodes themselves.
 *
 * The finder only navigated: choosing a result showed it. Someone who had
 * found a node and wanted its outage played, its check copied or the proposals
 * open went back to the mouse. Each of those already had a store action or a
 * panel, so this is a registry over them and adds no behaviour of its own.
 *
 * Nothing here decides or runs anything. A decision is made in the proposals
 * panel, by the buttons that call the routes that already exist, and the
 * palette only opens it, so no keystroke signs an approval. A check runs where
 * a person types it: the page copies the command and stops, because a route
 * that ran one would run whatever command an agent registered, from a server
 * that is meant to be a reader.
 *
 * Pure, with the page's own behaviour passed in, so what Enter does can be
 * tested without a browser.
 */
import type { ProposalRow } from '../../shared/api';
import { authorityMark, isEntry } from '../components/civ/layout';
import { LENSES as LENS_NAMES } from '../components/civ/ZoomHud';
import type { ActiveLens } from '../linkState';
import { verifyCommand } from './checkHistory';
import type { Item } from './configImporter';

/** What an action can do to the page, supplied by the shell that owns the view. */
export interface PaletteHandlers {
  /** Show the map, select the node on it and play the simulation there. */
  simulate: (id: string, mode: 'outage' | 'acquisition') => void;
  /** Show the map in another lens. */
  lens: (lens: ActiveLens) => void;
  /** Open the proposals panel, where a decision is made. */
  proposals: () => void;
  /** Put text on the clipboard and say so. */
  copy: (text: string, notice: string) => void;
}

/** The kinds of thing an action does. The order here is the order they are listed in. */
export const GROUPS = ['Simulate', 'Check', 'Proposals', 'Map'] as const;
export type ActionGroup = (typeof GROUPS)[number];

export interface PaletteAction {
  id: string;
  label: string;
  group: ActionGroup;
  /** Shown beside the label in place of the group, when it says more. */
  hint?: string;
  /** Words that find it without being in its label. */
  keywords?: string;
  /** Whether it is listed before anything has been typed. */
  browse?: boolean;
  run: () => void;
}

/**
 * Whether the attention lens has anything to colour: the ledger has recorded
 * an intervention. CivTree decides the same thing from the same store field,
 * and offers the lens disabled when it is false.
 */
const attentionAvailable = (attention: Record<string, number>): boolean =>
  Math.max(0, ...Object.values(attention).map(Number)) > 0;

export interface PaletteContext {
  items: Item[];
  proposals: ProposalRow[];
  activeLens: ActiveLens;
  /** Interventions recorded per capability. */
  attention: Record<string, number>;
  handlers: PaletteHandlers;
}

/**
 * Every action the page can offer right now.
 *
 * A verb about a node is offered only where the panel offers it: an outage for
 * a node that is reached, an unlock for one that is not, and a check for any
 * node on the map. Entries of the machine's setup are not on the map, so a
 * simulation of one would play out where nobody could see it, and the model
 * has no check for them. A lens is offered when it has something to paint and
 * is not already showing.
 */
export function buildActions(ctx: PaletteContext): PaletteAction[] {
  const { items, proposals, activeLens, attention, handlers } = ctx;
  const actions: PaletteAction[] = [];

  for (const item of items) {
    if (isEntry(item)) continue;
    if (item.status === 'built') {
      actions.push({
        id: `outage:${item.id}`,
        label: `Simulate an outage of ${item.name}`,
        group: 'Simulate',
        keywords: 'stop down fail',
        run: () => handlers.simulate(item.id, 'outage'),
      });
    } else {
      actions.push({
        id: `unlock:${item.id}`,
        label: `Simulate unlocking ${item.name}`,
        group: 'Simulate',
        keywords: 'reach acquire',
        run: () => handlers.simulate(item.id, 'acquisition'),
      });
    }
    const command = verifyCommand(item);
    actions.push({
      id: `verify:${item.id}`,
      label: `Copy the verify command for ${item.name}`,
      group: 'Check',
      keywords: 'check evidence',
      run: () =>
        handlers.copy(
          command,
          `Copied ${command}. A check runs only where you type it, so paste it into a terminal.`
        ),
    });
  }

  const available: Record<ActiveLens, boolean> = {
    default: true,
    attention: attentionAvailable(attention),
    authority: items.some(i => authorityMark(i) !== undefined),
  };
  for (const [lens, name, key] of LENS_NAMES) {
    if (lens === activeLens || !available[lens]) continue;
    actions.push({
      id: `lens:${lens}`,
      label: `Switch to the ${name} lens`,
      group: 'Map',
      hint: `Key ${key}`,
      keywords: 'color colour view',
      browse: true,
      run: () => handlers.lens(lens),
    });
  }

  const waiting = proposals.filter(p => p.status === 'draft');
  actions.push({
    id: 'proposals',
    label: 'Open Proposals',
    group: 'Proposals',
    hint: waiting.length ? `${waiting.length} waiting` : undefined,
    keywords: 'decide approve reject',
    browse: true,
    run: handlers.proposals,
  });
  // Both open the panel and nothing else. Approving signs a receipt and
  // rejecting records a no, and each is a button there, one click from the
  // card, because a keystroke in a search box is too easy to land on the
  // wrong row.
  for (const p of waiting) {
    actions.push({
      id: `approve:${p.id}`,
      label: `Approve “${p.goal}”`,
      group: 'Proposals',
      hint: 'Opens Proposals',
      keywords: 'sign decide',
      run: handlers.proposals,
    });
    actions.push({
      id: `reject:${p.id}`,
      label: `Turn down “${p.goal}”`,
      group: 'Proposals',
      hint: 'Opens Proposals',
      keywords: 'reject decline decide',
      run: handlers.proposals,
    });
  }
  return actions;
}

/** A line of the finder: a node to go to, or an action to run. */
export type Row = { kind: 'node'; item: Item } | { kind: 'action'; action: PaletteAction };

/** How many of each kind of match the finder lists. */
const LIMIT = 12;

const inGroupOrder = (a: PaletteAction, b: PaletteAction) =>
  GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group);

/** The actions a query finds: every word of it somewhere in the label or its keywords. */
function matchActions(actions: PaletteAction[], q: string): PaletteAction[] {
  const words = q.split(/\s+/);
  return actions
    .map(action => {
      const text = `${action.label} ${action.keywords ?? ''}`.toLowerCase();
      const score = words.every(w => text.includes(w)) ? (text.includes(q) ? 2 : 1) : 0;
      return { action, score };
    })
    .filter(r => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        inGroupOrder(a.action, b.action) ||
        a.action.label.localeCompare(b.action.label)
    )
    .slice(0, LIMIT)
    .map(r => r.action);
}

/**
 * What the finder lists for a query.
 *
 * Nodes first, split by where a match lives, then the actions the query
 * finds. Before anything is typed the order turns over: the few actions that
 * make sense with no subject come first, so the list says at a glance that it
 * does more than find.
 */
export function paletteRows(items: Item[], actions: PaletteAction[], query: string): Row[] {
  const q = query.trim().toLowerCase();
  const scored = items
    .map(item => {
      const name = item.name.toLowerCase();
      const score = !q
        ? 1
        : name.startsWith(q)
          ? 3
          : name.includes(q)
            ? 2
            : item.id.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q)
              ? 1
              : 0;
      return { item, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  const nodes = scored.filter(r => !isEntry(r.item)).map(r => r.item);
  const entries = scored.filter(r => isEntry(r.item)).map(r => r.item);
  const found: Row[] = [...nodes.slice(0, LIMIT), ...entries.slice(0, LIMIT)].map(item => ({
    kind: 'node',
    item,
  }));
  const verbs: Row[] = (
    q ? matchActions(actions, q) : actions.filter(a => a.browse).sort(inGroupOrder)
  ).map(action => ({ kind: 'action', action }));
  return q ? [...found, ...verbs] : [...verbs, ...found];
}

/** What a key does inside the finder. */
export type Step = { kind: 'move'; active: number } | { kind: 'choose' } | { kind: 'close' };

export function keyStep(key: string, active: number, count: number): Step | undefined {
  if (key === 'ArrowDown')
    return { kind: 'move', active: Math.max(0, Math.min(active + 1, count - 1)) };
  if (key === 'ArrowUp') return { kind: 'move', active: Math.max(active - 1, 0) };
  if (key === 'Enter') return { kind: 'choose' };
  if (key === 'Escape') return { kind: 'close' };
  return undefined;
}

/** What choosing a row does: go to a node, or run an action. */
export function activate(row: Row, show: (id: string) => void): void {
  if (row.kind === 'node') show(row.item.id);
  else row.action.run();
}
