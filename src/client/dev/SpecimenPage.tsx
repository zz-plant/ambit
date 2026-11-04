/**
 * The specimen page's drawing: every state the map draws a node in, at a
 * multiple of its size on the canvas colour, with the key entry that draws the
 * same state beside it. It draws through MapScene and the key's own swatch, so
 * a filter judged here is the filter the map and a saved file carry.
 */
import React from 'react';
import { buildAdjacency, layoutNodes, NODE_R } from '../components/civ/layout';
import { MapScene, type SceneView } from '../components/civ/MapScene';
import { HazardPattern, KeySwatch, MapFilters, mapKeys } from '../components/civ/marks';
import { SPECIMENS, type Specimen, simulationOf } from './specimens';

const HAZARD = 'specimen-hazard';
const FILTERS = 'specimen';
const KEY = mapKeys(FILTERS);
const NOTHING = new Set<string>();

/**
 * How much of the scene around a node a card shows: its corner marks and
 * setup time, two lines of name below, and, for the node an outage starts at,
 * its callout to the upper left.
 */
const CROP = { side: 70, above: 40, below: 60, callout: { left: 140, above: 62 } };

function view(s: Specimen): SceneView {
  const id = s.selected ? s.item.id : null;
  return {
    lens: 'default',
    attention: {},
    selectedId: id,
    focusId: id,
    needs: NOTHING,
    enables: NOTHING,
    collapse: null,
    spotlight: s.spotlight ?? null,
    spotlit: () => true,
    findingTarget: null,
    openEra: null,
    onOpenEra: () => {},
    onSelect: () => {},
    onHover: () => {},
    tabStop: null,
    onMove: () => {},
  };
}

/**
 * The scene a specimen sits in: its node on the second row of an era, under a
 * spacer with no name, so the era's head is a row above the crop and out of it.
 */
function sceneOf(s: Specimen) {
  const spacer: Specimen['item'] = { ...s.item, id: 'spacer', name: '', meta: { era: 1 } };
  const columns = { cols: { 'era:1': [spacer, s.item] }, colOrder: ['era:1'] };
  return {
    ...columns,
    positions: layoutNodes(columns),
    downstream: buildAdjacency(s.connections ?? [], null).downstream,
  };
}

export function SpecimenNode({ s, still, scale }: { s: Specimen; still: boolean; scale: number }) {
  const connections = s.connections ?? [];
  const layout = sceneOf(s);
  const at = layout.positions.get(s.item.id)!;
  const callout = s.role === 'down';
  const left = callout ? CROP.callout.left : CROP.side;
  const above = callout ? CROP.callout.above : CROP.above;
  const w = left + CROP.side;
  const h = above + CROP.below;
  return (
    <svg
      width={w * scale}
      height={h * scale}
      viewBox={`${at.x - left} ${at.y - above} ${w} ${h}`}
      fontFamily="var(--font-sans)"
      role="img"
      aria-label={s.title}
    >
      <rect x={at.x - left} y={at.y - above} width={w} height={h} fill="var(--bg-canvas)" />
      <MapScene
        items={[s.item, ...(s.unseen ?? [])]}
        connections={connections}
        cols={layout.cols}
        colOrder={layout.colOrder}
        positions={layout.positions}
        height={at.y + CROP.below + 100}
        downstream={layout.downstream}
        simulation={simulationOf(s)}
        hazard={`url(#${HAZARD})`}
        filters={FILTERS}
        view={still ? undefined : view(s)}
      />
    </svg>
  );
}

/** A key entry's swatch, at the same multiple of its own size as the node beside it. */
function Swatch({ name, scale }: { name: keyof typeof KEY; scale: number }) {
  const entry = KEY[name];
  return (
    <figure className="specimen-key">
      <svg width={20 * scale} height={20 * scale} viewBox="-10 -10 20 20" aria-hidden="true">
        <rect x={-10} y={-10} width={20} height={20} fill="var(--bg-surface)" />
        <KeySwatch entry={entry} hazard={`url(#${HAZARD})`} />
      </svg>
      <figcaption>
        <strong>{entry.label}</strong>
        {'hint' in entry && <span>{entry.hint}</span>}
      </figcaption>
    </figure>
  );
}

/**
 * Every specimen beside its key entry, then the whole key. `still` draws each
 * node as a saved file does; `scale` is the multiple of a node's size.
 */
export function SpecimenPage({ still = false, scale = 3 }: { still?: boolean; scale?: number }) {
  const link = (next: { still?: boolean; scale?: number }) => {
    const p = new URLSearchParams();
    if (next.still ?? still) p.set('still', '');
    const s = next.scale ?? scale;
    if (s !== 3) p.set('scale', String(s));
    const q = p.toString().replace('still=', 'still');
    return q ? `?${q}` : './specimen.html';
  };
  return (
    <main className="specimen">
      {/* One definition of the stripes and the filters for every drawing on the page. */}
      <svg width={0} height={0} aria-hidden="true" style={{ position: 'absolute' }}>
        <defs>
          <HazardPattern id={HAZARD} />
          <MapFilters prefix={FILTERS} />
        </defs>
      </svg>
      <header>
        <h1>Map specimens</h1>
        <p>
          Each state at {scale}× a node of radius {NODE_R}, drawn{' '}
          {still ? 'as a saved file draws it' : 'as the page draws it'}.{' '}
          <a href={link({ still: !still })}>{still ? 'As the page' : 'As a saved file'}</a>
          {' · '}
          {[2, 3, 4].map(n => (
            <React.Fragment key={n}>
              {n === scale ? <b>{n}×</b> : <a href={link({ scale: n })}>{n}×</a>}{' '}
            </React.Fragment>
          ))}
        </p>
      </header>
      <section className="specimen-grid">
        {SPECIMENS.map(s => (
          <article key={s.item.id} className="specimen-card">
            <h2>{s.title}</h2>
            <div className="specimen-pair">
              <SpecimenNode s={s} still={still} scale={scale} />
              {s.key && <Swatch name={s.key} scale={scale} />}
            </div>
          </article>
        ))}
      </section>
      <h2>The whole key</h2>
      <section className="specimen-keys">
        {(Object.keys(KEY) as (keyof typeof KEY)[]).map(name => (
          <Swatch key={name} name={name} scale={scale} />
        ))}
      </section>
    </main>
  );
}
