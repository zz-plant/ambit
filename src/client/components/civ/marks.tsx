/**
 * The small drawings the map and its key share: the joint mark, the lock-on
 * corners, the stripes for what refuses, and the swatch each key is drawn as.
 * One definition each, so the key cannot draw a state the map draws otherwise.
 */
import type { JointMark } from './layout';

/**
 * The mark for a joint capability: a person, or a device, in a small disc at
 * the node's lower left. Drawn, not typed, since the glyphs a font offers for
 * either vary by platform.
 */
export function JointIcon({ mark }: { mark: JointMark }) {
  return (
    <>
      <circle r={6.5} fill="var(--bg-surface)" stroke="var(--accent)" strokeWidth={1.2} />
      {mark === 'person' ? (
        <>
          <circle cy={-1.8} r={1.7} fill="var(--accent)" />
          <path d="M-3 3.2 C-3 0.6 3 0.6 3 3.2 Z" fill="var(--accent)" />
        </>
      ) : (
        <>
          <rect x={-3.2} y={-2.6} width={6.4} height={4.2} rx={0.8} fill="var(--accent)" />
          <line x1={-1.6} y1={3} x2={1.6} y2={3} stroke="var(--accent)" strokeWidth={1.1} />
        </>
      )}
    </>
  );
}

/**
 * A lock-on: four corners around a node, and no ring. A ring is one more
 * circle on a map of circles; corners are a shape nothing else on the map
 * draws, so the one node being pointed at reads as pointed at even when a
 * dozen around it are lit.
 */
export function Brackets({ r, color }: { r: number; color: string }) {
  // A pixel outside the keystone's square (r + 6), whose corners are rounded
  // at 9: six-pixel arms sit clear of its curve, so a selected keystone shows
  // both. Any further out and a first-row node's top corners sat on its era's
  // progress bar, 8 to 11 pixels above the node.
  const s = r + 7;
  const arm = 6;
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  return (
    <g stroke={color} strokeWidth={2} strokeLinecap="round" fill="none">
      {corners.map(([dx, dy]) => (
        <path key={`${dx}${dy}`} d={`M${dx * s} ${dy * (s - arm)} V${dy * s} H${dx * (s - arm)}`} />
      ))}
    </g>
  );
}

/**
 * Diagonal stripes for the two states that refuse: a check that is failing,
 * and a grant that is forbidden. A texture survives a greyscale screenshot and
 * a reader who cannot tell the reds apart, where a fill colour does not, and
 * it stays rare enough to mean something: nothing else on the page is striped.
 */
export function HazardPattern({ id }: { id: string }) {
  return (
    <pattern
      id={id}
      width={6}
      height={6}
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      <rect width={6} height={6} fill="var(--bg-canvas)" />
      <rect width={3} height={6} fill="var(--error)" opacity={0.6} />
    </pattern>
  );
}

/** One entry of the map's key: a swatch, a stroke, or a heading for the ramp. */
export type LegendKey =
  | { kind: 'label'; label: string }
  | { kind: 'node'; label: string; color: string; sym?: string; hatch?: boolean }
  | { kind: 'ring' | 'faded' | 'square'; label: string }
  | { kind: 'line'; label: string; color?: string; dashed?: boolean }
  | { kind: 'joint'; label: string; mark: JointMark };

/** A key's picture, centred on the origin, as the map draws that state. */
export function KeySwatch({ entry, hazard }: { entry: LegendKey; hazard: string }) {
  switch (entry.kind) {
    case 'node': {
      const { color, hatch, sym } = entry;
      return (
        <>
          <circle
            r={7}
            fill={hatch ? hazard : color}
            opacity={0.9}
            stroke={
              hatch
                ? color
                : color === 'var(--bg-canvas)'
                  ? 'var(--text-muted)'
                  : color === 'var(--node-reached)'
                    ? 'var(--node-reached-ring)'
                    : 'none'
            }
            strokeWidth={
              hatch
                ? 1.5
                : color === 'var(--bg-canvas)' || color === 'var(--node-reached)'
                  ? 1.25
                  : 0
            }
          />
          {sym && (
            <text
              y={3}
              textAnchor="middle"
              fill={hatch ? 'var(--text-primary)' : 'var(--on-accent)'}
              fontSize={9}
              fontWeight={700}
            >
              {sym}
            </text>
          )}
        </>
      );
    }
    case 'joint':
      return <JointIcon mark={entry.mark} />;
    case 'ring':
      return <circle r={7} fill="var(--bg-canvas)" stroke="var(--accent)" strokeWidth={2} />;
    case 'faded':
      return (
        <circle
          r={7}
          fill="var(--bg-canvas)"
          stroke="var(--text-muted)"
          strokeWidth={1.25}
          strokeDasharray="3,2"
        />
      );
    case 'square':
      return (
        <rect
          x={-8}
          y={-8}
          width={16}
          height={16}
          rx={3}
          fill="none"
          stroke="var(--warn)"
          strokeOpacity={0.75}
          strokeWidth={1.25}
          strokeDasharray="3,2"
        />
      );
    case 'line':
      return (
        <line
          x1={-9}
          y1={0}
          x2={9}
          y2={0}
          stroke={entry.color ?? 'var(--text-muted)'}
          strokeWidth={1.5}
          strokeDasharray={entry.dashed ? '4,3' : 'none'}
        />
      );
    default:
      return null;
  }
}
