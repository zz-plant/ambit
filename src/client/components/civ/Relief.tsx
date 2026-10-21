/**
 * The map as a plate in relief: what this setup can reach raised as ground,
 * lit from the first era, with the frontier engraved where the ground drops
 * away. A picture to keep, saved from the Image button and drawn nowhere on
 * the page.
 *
 * It carries less than the still. No node is named: the height is what has
 * been reached, joined along the edges between reached nodes, and a next step
 * is a foothill. A node whose check failed is not ground, since it is not
 * working, and is marked where it stands. The era names and one line of counts
 * are the only words, all of them in the standard lens the still keeps to.
 */
import { columnCentre, columnLabel, edgePath, isFailing, isNext, START_Y } from './layout.ts';
import type { StillLayout } from './MapScene.tsx';
import type { Connection } from '../../utils/configImporter';
import { CAPS } from './marks.tsx';

/** How high a reached node stands, and how wide the ridge along an edge between two. */
const PLATEAU_R = 58;
const RIDGE_W = 44;
const FOOTHILL_R = 20;
/**
 * Room the plate adds to the map's extent: above, so the first row's ground
 * stays clear of the era names, and below, for the caption.
 */
const HEAD = 36;
const FOOT = 64;
export const RELIEF_EXTRA = HEAD + FOOT;
/** One light for both passes: from the upper left, so from the first era, and low. */
const LIGHT = { azimuth: 215, elevation: 30 };

export function MapRelief({
  connections,
  layout,
  scale = 1,
  now = new Date(),
}: {
  connections: Connection[];
  layout: StillLayout;
  scale?: number;
  now?: Date;
}) {
  const { width, positions, cols, colOrder } = layout;
  const height = layout.height + RELIEF_EXTRA;
  const placed = [...positions.values()];
  const ground = new Set(
    placed.filter(p => p.item.status === 'built' && !isFailing(p.item)).map(p => p.item.id)
  );
  const failing = placed.filter(p => isFailing(p.item));
  const foothills = placed.filter(p => isNext(p.item));
  const ridges = connections.filter(c => ground.has(c.from) && ground.has(c.to));
  const day = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const counts = [
    `${ground.size} of ${placed.length} reached`,
    failing.length
      ? `${failing.length} failing ${failing.length === 1 ? 'its check' : 'their checks'}`
      : '',
    foothills.length
      ? `${foothills.length} ${foothills.length === 1 ? 'next step' : 'next steps'}`
      : '',
    day,
  ].filter(Boolean);

  return (
    <svg
      width={Math.round(width * scale)}
      height={Math.round(height * scale)}
      viewBox={`0 0 ${width} ${height}`}
      fontFamily="var(--font-sans)"
    >
      <title>
        The ambit in relief: what this setup can reach, raised and lit from the first era
      </title>
      <defs>
        <filter
          id="relief"
          filterUnits="userSpaceOnUse"
          x={0}
          y={0}
          width={width}
          height={height}
          colorInterpolationFilters="sRGB"
        >
          {/* The drawing's coverage, softened into terrain, then its top
              cut flat: a tableland with an escarpment, not a bump per node. */}
          <feGaussianBlur in="SourceAlpha" stdDeviation={14} result="slope" />
          <feComponentTransfer in="slope">
            <feFuncA type="linear" slope={2.4} intercept={-0.3} />
          </feComponentTransfer>
          <feGaussianBlur stdDeviation={3} result="height" />
          <feDiffuseLighting
            in="height"
            surfaceScale={14}
            diffuseConstant={0.6}
            lightingColor="var(--node-reached)"
            result="lit"
          >
            <feDistantLight {...LIGHT} />
          </feDiffuseLighting>
          <feSpecularLighting
            in="height"
            surfaceScale={14}
            specularConstant={0.6}
            specularExponent={30}
            lightingColor="var(--node-reached-ring)"
            result="shine"
          >
            <feDistantLight {...LIGHT} />
          </feSpecularLighting>
          <feComposite in="lit" in2="shine" operator="arithmetic" k2={1} k3={1} result="plate" />
          {/* The frontier: where the ground first rises off the plate, cut
              as one line around all of it. */}
          <feComponentTransfer in="slope" result="land">
            <feFuncA type="linear" slope={14} intercept={-2.8} />
          </feComponentTransfer>
          <feMorphology in="land" operator="erode" radius={1.2} result="inland" />
          <feComposite in="land" in2="inland" operator="out" result="coast" />
          <feFlood floodColor="var(--accent)" floodOpacity={0.85} />
          <feComposite in2="coast" operator="in" result="frontier" />
          <feMerge>
            <feMergeNode in="plate" />
            <feMergeNode in="frontier" />
          </feMerge>
        </filter>
      </defs>
      <rect width={width} height={height} fill="var(--bg-canvas)" />

      {/* What the light falls on. Drawn in any colour: only its coverage is read. */}
      <g filter="url(#relief)">
        <g transform={`translate(0, ${HEAD})`}>
          {ridges.map(c => {
            const a = positions.get(c.from)!;
            const b = positions.get(c.to)!;
            return (
              <path
                key={`${c.from}>${c.to}`}
                d={edgePath(a.x, a.y, b.x, b.y)}
                fill="none"
                stroke="#000"
                strokeWidth={RIDGE_W}
                strokeLinecap="round"
              />
            );
          })}
          {placed
            .filter(p => ground.has(p.item.id))
            .map(p => (
              <circle key={p.item.id} cx={p.x} cy={p.y} r={PLATEAU_R} />
            ))}
          {foothills.map(p => (
            <circle key={p.item.id} cx={p.x} cy={p.y} r={FOOTHILL_R} opacity={0.35} />
          ))}
        </g>
      </g>

      {/* Where each node stands, pricked into the plate: a point for ground,
          a ring for a next step, and red for a failing check. */}
      <g transform={`translate(0, ${HEAD})`}>
        {placed.map(p =>
          isFailing(p.item) ? (
            <circle
              key={p.item.id}
              cx={p.x}
              cy={p.y}
              r={4}
              fill="none"
              stroke="var(--error)"
              strokeWidth={1.5}
            />
          ) : ground.has(p.item.id) ? (
            <circle
              key={p.item.id}
              cx={p.x}
              cy={p.y}
              r={1.6}
              fill="var(--text-primary)"
              opacity={0.55}
            />
          ) : isNext(p.item) ? (
            <circle
              key={p.item.id}
              cx={p.x}
              cy={p.y}
              r={3}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1}
              opacity={0.8}
            />
          ) : (
            <circle
              key={p.item.id}
              cx={p.x}
              cy={p.y}
              r={1}
              fill="var(--text-muted)"
              opacity={0.4}
            />
          )
        )}
      </g>

      {colOrder.map((column, i) => (
        <text
          key={column}
          x={columnCentre(i)}
          y={START_Y - 27}
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize={11}
          {...CAPS}
        >
          {columnLabel(column, cols[column] || []).toUpperCase()}
        </text>
      ))}

      <g transform={`translate(${columnCentre(0) - 40}, ${height - FOOT / 2 + 4})`}>
        <text
          fill="var(--text-primary)"
          fontSize={15}
          fontFamily="var(--font-display)"
          fontWeight={700}
          letterSpacing="0.18em"
          style={{ fontStretch: '125%' }}
        >
          AMBIT
        </text>
        <text
          x={78}
          fill="var(--text-muted)"
          fontSize={12}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {counts.join('  ·  ')}
        </text>
      </g>
    </svg>
  );
}
