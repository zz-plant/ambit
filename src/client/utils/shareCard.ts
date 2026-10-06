/**
 * The map's finding as an image made to be posted.
 *
 * A screenshot of the map on a phone is seven columns of four-pixel names,
 * cropped wherever the thumb stopped. This is the frame people were trying to
 * take: one sentence with its number, the part of the map that sentence is
 * about, drawn at a size a feed can carry, and the address it came from. It
 * says what the simulation banner says, from the same function, so the image
 * and the page never disagree about a count.
 *
 * Pure: `buildCard` reads the graph and `cardSvg` writes a string. Turning the
 * string into a PNG needs a canvas, and lives with the caller.
 */
import {
  cascadeDepths,
  isFailing,
  edgePath,
  mapFindings,
  outageImpact,
  outageSentence,
  outageSplit,
  simulationSentence,
  unlockCascade,
  wrapLabel,
} from '../components/civ/layout';
import type { Connection, Item } from './configImporter';
import { SITE_HOST } from './copy';

/** Portrait 4:5, the tallest shape the main feeds show without cropping. */
export const CARD_W = 1080;
export const CARD_H = 1350;

/** The app's dark palette, written out: an SVG drawn to a canvas cannot read CSS variables. */
const INK = {
  canvas: '#0f1013',
  surface: '#16171b',
  line: 'rgba(255,255,255,0.08)',
  text: '#e8e8ea',
  secondary: '#a4a7ae',
  muted: '#8a8e96',
  accent: '#7aa2f7',
  ok: '#56c28a',
  warn: '#e0a94a',
  error: '#ef6461',
  errorDeep: '#d8504d',
};

/** The page's text and readout faces (src/client/fonts.ts), which `cardSvg` can embed. */
const FONT =
  "'Mona Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const DISPLAY = `'Hubot Sans', ${FONT}`;

/** The readout face's two settings, as the page's TYPE ROLES set them. */
const WIDE = 'font-stretch:112.5%';
const NARROW = 'font-stretch:87.5%';

export type CardMode = 'outage' | 'acquisition' | 'gap';

/** At most this many nodes a column; the rest are counted, not drawn. */
const ROWS = 5;

export interface CardNode {
  id: string;
  name: string;
  /** Hops from the origin, as a column; the origin is 0. */
  column: number;
  row: number;
  /** `failing` was configured and already failing its check before anything went down. */
  tone: 'root' | 'hit' | 'weak' | 'failing';
}

export interface Card {
  mode: CardMode;
  /** The line above the number: what is being supposed. */
  kicker: string;
  /** The number the sentence is about, when it has one. */
  count?: number;
  /** The rest of the sentence, read after the number. */
  sentence: string;
  nodes: CardNode[];
  edges: { from: string; to: string }[];
  /** Per column, how many more there were than it draws. */
  more: number[];
}

/** What the map is showing, as far as the card needs to know. */
export interface Showing {
  mode: string;
  rootId: string | null;
  cascade: Set<string>;
  weakened?: Set<string>;
}

/**
 * The card for what the map shows: the running simulation, else the map's own
 * finding played out (the next step that reaches the most, else the loss that
 * stops the most). The next step leads because widening what a setup can do
 * is what the product is for; the loss is the guardrail. Null when the graph
 * has nothing to say.
 */
export function buildCard(
  items: Item[],
  connections: Connection[],
  showing: Showing,
  ranked: string[] = []
): Card | null {
  let { mode, rootId, cascade, weakened } = showing;
  if (mode === 'none' || !rootId) {
    const { weakest, best } = mapFindings(items, connections, ranked);
    if (best?.reaches) {
      mode = 'acquisition';
      rootId = best.item.id;
      cascade = unlockCascade(items, connections, best.item.id);
    } else if (weakest) {
      const split = outageSplit(items, connections, weakest.item.id);
      mode = 'outage';
      rootId = weakest.item.id;
      cascade = split.stops;
      weakened = split.weakened;
    } else {
      return null;
    }
  }
  const root = items.find(i => i.id === rootId);
  if (!root) return null;
  const name = root.name;
  const plural = (n: number) => (n === 1 ? 'capability' : 'capabilities');

  let kicker: string;
  let count: number | undefined;
  let sentence: string;
  if (mode === 'outage') {
    const said = outageSentence(name, outageImpact(items, { stops: cascade, weakened }));
    kicker = `If ${name} went down`;
    const n = Number.parseInt(said.count, 10);
    if (n > 0) {
      count = n;
      sentence = said.count.replace(/^\d+\s*/, '') + said.after;
    } else {
      sentence = said.after[0].toUpperCase() + said.after.slice(1);
    }
  } else if (mode === 'acquisition') {
    kicker = `Adding ${name}`;
    count = cascade.size;
    sentence = `more ${plural(cascade.size)} would become reachable.`;
  } else {
    kicker = `Reaching ${name}`;
    sentence = simulationSentence(mode, name, cascade, weakened, items);
  }

  // The map's positions spread a cascade over seven columns; on the card it
  // is laid out by hop, origin on the left, so it reads as spreading. What
  // was never set up is counted in the sentence and left out of the picture.
  const lit = new Set([rootId, ...cascade, ...(weakened ?? [])]);
  const depth = cascadeDepths(connections, rootId, lit);
  const byId = new Map(items.map(i => [i.id, i]));
  const shown = [...lit].filter(id => {
    const item = byId.get(id);
    return item && (id === rootId || mode !== 'outage' || item.status === 'built');
  });
  const hops = [...new Set(shown.map(id => depth.get(id) ?? 1))].sort((a, b) => a - b);
  const nodes: CardNode[] = [];
  const more: number[] = [];
  hops.forEach((hop, column) => {
    const here = shown
      .filter(id => (depth.get(id) ?? 1) === hop)
      .sort((a, b) => byId.get(a)!.name.localeCompare(byId.get(b)!.name));
    more.push(Math.max(0, here.length - ROWS));
    here.slice(0, ROWS).forEach((id, row) => {
      nodes.push({
        id,
        name: byId.get(id)!.name,
        column,
        row,
        tone:
          id === rootId
            ? 'root'
            : weakened?.has(id)
              ? 'weak'
              : isFailing(byId.get(id)!)
                ? 'failing'
                : 'hit',
      });
    });
  });
  const drawn = new Set(nodes.map(n => n.id));
  const edges = connections
    .filter(c => drawn.has(c.from) && drawn.has(c.to))
    .map(c => ({ from: c.from, to: c.to }));
  return { mode: mode as CardMode, kicker, count, sentence, nodes, edges, more };
}

/** The callout's type size: a label on a drawing, under the name it annotates. */
const CALLOUT_SIZE = 18;

/**
 * A spec-sheet callout: a leader from the circle's lower right, down to a
 * rule the note sits on. Narrow capitals, as the map sets its own.
 */
function callout(
  cx: number,
  cy: number,
  r: number,
  x: number,
  baseline: number,
  note: string,
  color: string
): string {
  const lx = cx + r * 0.7;
  const ly = cy + r * 0.7;
  const ruleY = baseline + 6;
  const end = x + note.length * CALLOUT_SIZE * 0.6;
  return (
    `<path d="M${lx} ${ly} L${x - 6} ${ruleY} H${end}" fill="none" stroke="${color}" stroke-opacity="0.7" stroke-width="2"/>` +
    `<text x="${x}" y="${baseline}" font-size="${CALLOUT_SIZE}" fill="${color}" font-family="${DISPLAY}" style="${NARROW}" font-weight="700" letter-spacing="1.5">${esc(note)}</text>`
  );
}

/** Four corners around a node, the lock-on the map draws. */
function brackets(cx: number, cy: number, r: number, color: string): string {
  const s = r + 12;
  const arm = 12;
  const d = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]
    .map(
      ([dx, dy]) => `M${cx + dx * s} ${cy + dy * (s - arm)} V${cy + dy * s} H${cx + dx * (s - arm)}`
    )
    .join(' ');
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Greedy wrap by character count; the card's fonts are close enough to even. */
function wrap(text: string, perLine: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/ +/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > perLine) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The card as a standalone SVG document, 1080 by 1350. `fonts` is `@font-face`
 * CSS with the files inlined: drawn as an image, the document cannot fetch
 * them, and without it every line falls back to a system face.
 */
export function cardSvg(card: Card, fonts = ''): string {
  const pad = 72;
  const hue = card.mode === 'outage' ? INK.error : card.mode === 'acquisition' ? INK.ok : INK.warn;
  const rootFill = card.mode === 'outage' ? INK.error : INK.accent;
  const hitFill =
    card.mode === 'outage' ? INK.errorDeep : card.mode === 'acquisition' ? INK.ok : INK.warn;
  const out: string[] = [];
  const text = (
    x: number,
    y: number,
    size: number,
    fill: string,
    body: string,
    extra = '',
    family = FONT
  ) =>
    out.push(
      `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-family="${family}" ${extra}>${esc(body)}</text>`
    );

  // Brand, top left: BrandMark, drawn at 56.
  out.push(
    `<g transform="translate(${pad},${pad}) scale(0.875)"><rect width="64" height="64" rx="14" fill="${INK.accent}"/>` +
      `<g stroke="${INK.canvas}" stroke-linecap="round"><path d="M13 51 L32 12" stroke-width="9.5"/><path d="M51 51 L32 12" stroke-width="9.5"/><path d="M20 40 H44" stroke-width="8.5"/></g>` +
      `<g fill="${INK.canvas}"><circle cx="32" cy="12" r="8.5"/><circle cx="13" cy="51" r="7.5"/><circle cx="51" cy="51" r="7.5"/></g></g>`
  );
  text(pad + 76, pad + 40, 36, INK.text, 'Ambit', `font-weight="750" style="${WIDE}"`, DISPLAY);

  // The claim: kicker, number, sentence.
  let y = 250;
  text(
    pad,
    y,
    30,
    hue,
    card.kicker.toUpperCase(),
    `font-weight="700" letter-spacing="2.4" style="${NARROW}"`,
    DISPLAY
  );
  y += 24;
  if (card.count !== undefined) {
    y += 176;
    text(
      pad - 6,
      y,
      200,
      hue,
      String(card.count),
      `font-weight="800" letter-spacing="-4" style="${WIDE}"`,
      DISPLAY
    );
    y += 24;
  }
  // A number stays on the line with its noun.
  const lines = wrap(card.sentence.replace(/(\d) /g, '$1\u00a0'), 34).slice(0, 4);
  for (const line of lines) {
    y += 60;
    text(pad, y, 48, INK.text, line, 'font-weight="600"');
  }

  // The part of the map the sentence is about, fitted to the space left.
  const top = y + 60;
  const bottom = CARD_H - 150;
  const box = { x: pad, y: top, w: CARD_W - pad * 2, h: Math.max(bottom - top, 200) };
  out.push(
    `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="24" fill="${INK.surface}" stroke="${INK.line}" stroke-width="2"/>`
  );
  if (card.nodes.length) {
    const columns = card.more.length;
    const colW = box.w / columns;
    const perColumn = card.more.map((_, c) => card.nodes.filter(n => n.column === c).length);
    const rowH = Math.min(
      120,
      (box.h - 60) / Math.max(...perColumn.map((n, c) => n + (card.more[c] ? 1 : 0)))
    );
    const r = Math.min(30, rowH * 0.28);
    const label = columns > 2 ? 24 : 28;
    // One column is the origin alone, centred; otherwise each sits left in its lane.
    const x = (c: number) => (columns === 1 ? box.x + box.w / 2 : box.x + 48 + c * colW);
    const y = (c: number, row: number) => {
      const rows = perColumn[c] + (card.more[c] ? 1 : 0);
      return box.y + (box.h - rows * rowH) / 2 + rowH * (row + 0.5);
    };
    const perLine = Math.floor((colW - r * 2 - 40) / (label * 0.55));
    const lines = new Map(card.nodes.map(n => [n.id, wrapLabel(n.name, Math.max(10, perLine))]));
    const at = new Map(card.nodes.map(n => [n.id, { x: x(n.column), y: y(n.column, n.row) }]));
    // An edge leaves from the end of its node's name, not its centre, or it
    // strikes the name through.
    const tail = (id: string) =>
      at.get(id)!.x + r + 28 + Math.max(...lines.get(id)!.map(l => l.length)) * label * 0.55;
    for (const e of card.edges) {
      const a = at.get(e.from)!;
      const b = at.get(e.to)!;
      out.push(
        `<path d="${edgePath(tail(e.from), a.y, b.x - r, b.y)}" fill="none" stroke="${hue}" stroke-opacity="0.5" stroke-width="3" stroke-linecap="round"/>`
      );
    }
    for (const n of card.nodes) {
      const p = at.get(n.id)!;
      const root = n.tone === 'root';
      const failing = n.tone === 'failing';
      // A failing node is striped, as on the map: it was not working to begin with.
      const fill = failing
        ? 'url(#hazard)'
        : root
          ? rootFill
          : n.tone === 'weak'
            ? INK.warn
            : hitFill;
      const stroke = failing ? INK.error : '#fff';
      out.push(
        `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-opacity="${root || failing ? 0.9 : 0.3}" stroke-width="${root || failing ? 4 : 2}"/>`
      );
      // The origin is the node the sentence is about: corners, as the map
      // draws around the node its headline names.
      if (root) out.push(brackets(p.x, p.y, r, hue));
      const said = lines.get(n.id)!;
      // A callout under a failing node's name says what the stripes mean,
      // so the image needs no legend; the name moves up to make room.
      const note = failing ? CALLOUT_SIZE + 12 : 0;
      const first = p.y + label * 0.35 - ((said.length - 1) * (label + 4) + note) / 2;
      if (failing) {
        const baseline = first + (said.length - 1) * (label + 4) + note;
        out.push(callout(p.x, p.y, r, p.x + r + 16, baseline, 'CHECK FAILING', INK.error));
      }
      said.forEach((line, i) => {
        text(
          p.x + r + 16,
          first + i * (label + 4),
          label,
          root ? INK.text : INK.secondary,
          line,
          `font-weight="${root ? 700 : 500}"`
        );
      });
    }
    card.more.forEach((extra, c) => {
      if (!extra) return;
      text(
        x(c) - r,
        y(c, perColumn[c]) + label * 0.35,
        label,
        INK.muted,
        `+${extra} more`,
        'font-weight="500"'
      );
    });
  }

  // Where it came from.
  text(
    pad,
    CARD_H - 72,
    30,
    INK.secondary,
    `Map your own agent setup at ${SITE_HOST}`,
    'font-weight="500"'
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">` +
    `<defs>` +
    (fonts ? `<style>${fonts}</style>` : '') +
    `<radialGradient id="glow" cx="0.15" cy="0.1" r="0.9"><stop offset="0%" stop-color="${hue}" stop-opacity="0.16"/><stop offset="100%" stop-color="${hue}" stop-opacity="0"/></radialGradient>` +
    `<pattern id="hazard" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="${INK.surface}"/><rect width="6" height="12" fill="${INK.error}" fill-opacity="0.6"/></pattern></defs>` +
    `<rect width="${CARD_W}" height="${CARD_H}" fill="${INK.canvas}"/>` +
    `<rect width="${CARD_W}" height="${CARD_H}" fill="url(#glow)"/>` +
    out.join('') +
    '</svg>'
  );
}

/** A file name that says what the image is. */
export function cardFileName(card: Card): string {
  const slug = card.kicker
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `ambit-${slug || 'map'}.png`;
}
