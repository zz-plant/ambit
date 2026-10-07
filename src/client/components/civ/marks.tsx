/**
 * The small drawings the map and its key share: the joint mark, the lock-on
 * corners, the keystone, the stripes for what refuses, and the swatch each key
 * is drawn as.
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
  // Seven pixels outside the ring: any further out and a first-row node's top
  // corners sat on its era's progress bar, 8 to 11 pixels above the node.
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
 * A keystone: the wedge at the top of an arch, at the node's upper left, the
 * corner the check badge leaves free. It was a dashed square around the node,
 * one step from the corners that mean "pointed at", so a keystone read as a
 * second selection. Outlined at rest, filled when the key or the selection
 * asks for it.
 */
export function KeystoneMark({ lit = true }: { lit?: boolean }) {
  return (
    <path
      d="M-5 -4 H5 L3 4 H-3 Z"
      fill={lit ? 'var(--warn)' : 'var(--bg-canvas)'}
      stroke="var(--warn)"
      strokeWidth={1.25}
      strokeLinejoin="round"
      strokeOpacity={lit ? 1 : 0.7}
    />
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
  | { kind: 'ring' | 'faded' | 'keystone'; label: string }
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
    case 'keystone':
      return <KeystoneMark />;
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

/**
 * The `.civ-era-name` and `.civ-callout` rule in App.css, as attributes, for a
 * map saved as a file, which carries no stylesheet. The capitals the rule
 * sets with `text-transform` are the text's own there.
 */
export const CAPS = {
  fontFamily: 'var(--font-display)',
  fontWeight: 700,
  letterSpacing: '0.08em',
  style: { fontStretch: 'var(--stretch-narrow)' },
} as const;

/**
 * A spec-sheet callout, as the saved image draws one: a leader from the
 * node's upper left to a short rule, and a label in capitals on the rule.
 * Up and to the left, since the upper right carries a node's check badge and
 * its setup cost, and the name sits below.
 */
export function Callout({
  r,
  text,
  color,
  still,
}: {
  r: number;
  text: string;
  color: string;
  /** Drawn into a file: its type set by attributes, not by the page's class. */
  still?: boolean;
}) {
  const from = -r * 0.72;
  const elbowX = -r - 12;
  const elbowY = -r - 12;
  // The rule runs the width of the label: about 6.3px a character in the
  // readout face's narrow capitals at 11px, as measured.
  const width = text.length * 6.3 + 4;
  return (
    <g pointerEvents="none">
      <path
        d={`M${from} ${from} L${elbowX} ${elbowY} H${elbowX - width}`}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeOpacity={0.8}
      />
      <text
        className={still ? undefined : 'civ-callout'}
        x={elbowX - 2}
        y={elbowY - 5}
        textAnchor="end"
        fill={color}
        fontSize={11}
        fontWeight={700}
        {...(still ? CAPS : {})}
      >
        {text}
      </text>
    </g>
  );
}
