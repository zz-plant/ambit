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
/**
 * How much of a next step is already asked for: a wedge from twelve o'clock,
 * filling as work is recorded blocked on it, full at the count the engine
 * calls structural. Drawn inside the ring so the ring still says next step.
 */
export function EurekaMark({ r, fraction }: { r: number; fraction: number }) {
  const f = Math.max(0, Math.min(1, fraction));
  if (!f) return null;
  const inner = r - 3;
  if (f >= 1) return <circle r={inner} fill="var(--fig-data-soft, var(--accent-soft))" />;
  const a = f * Math.PI * 2;
  const x = inner * Math.sin(a);
  const y = -inner * Math.cos(a);
  const large = f > 0.5 ? 1 : 0;
  return (
    <path
      d={`M 0 0 L 0 ${-inner} A ${inner} ${inner} 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`}
      fill="var(--fig-data-soft, var(--accent-soft))"
    />
  );
}

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

/**
 * How far a recovering ring wavers, by how many of its last five runs failed:
 * one to four, since a recovering node passed the last. The pixels are what
 * `feDisplacementMap` moves the line by at the noise's usual spread.
 */
const WAVER_SCALE = [5, 8, 11, 14];
/** Noise patterns per filter, so a row of recovering nodes do not waver in step. */
const SEEDS = 3;

/** Which of the seeds a node's filters use: the same one every draw. */
export function seedOf(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) % SEEDS;
}

/**
 * A texture over one half of a node: the ring, or the fill. The other half
 * is drawn true, which is what lets a texture read as something that happened
 * to the node and not as a different kind of node.
 */
export interface Texture {
  url: string;
  on: 'ring' | 'fill';
}

export const waverOf = (prefix: string, failed: number, seed: number): Texture => ({
  url: `url(#${prefix}-waver-${Math.max(1, Math.min(WAVER_SCALE.length, failed))}-${seed})`,
  on: 'ring',
});
export const corrosionOf = (prefix: string, seed: number): Texture => ({
  url: `url(#${prefix}-corrode-${seed})`,
  on: 'fill',
});

/**
 * The map's two textures, each a filter that means one thing.
 *
 * A waver is a recovering capability: its last check passed and some of the
 * recent ones did not. The fill stays where it is and the ring slips off it,
 * like a print out of register, further the more of those runs failed. The
 * line moves and the colour does not, so it reads in greyscale and stays out
 * of the stripes' way: nothing about it refuses.
 *
 * Corrosion is what an outage stops. The ring holds, since the capability is
 * still configured, and the fill inside it is eaten through to the canvas.
 * Only during the outage simulation, so the one texture on the map that looks
 * like damage is the one that is damage.
 *
 * Defined once per svg, prefixed as the stripes are, since a page can hold
 * the map and a saved still at once.
 */
export function MapFilters({ prefix }: { prefix: string }) {
  const seeds = Array.from({ length: SEEDS }, (_, s) => s);
  return (
    <>
      {WAVER_SCALE.map((scale, i) =>
        seeds.map(s => (
          <filter
            key={`w${i}${s}`}
            id={`${prefix}-waver-${i + 1}-${s}`}
            x="-25%"
            y="-25%"
            width="150%"
            height="150%"
          >
            <feTurbulence type="fractalNoise" baseFrequency={0.05} numOctaves={1} seed={s + 1} />
            <feDisplacementMap
              in="SourceGraphic"
              scale={scale}
              xChannelSelector="R"
              yChannelSelector="G"
            />
            {/* Displacement moves whole pixels; this puts the edge back. */}
            <feGaussianBlur stdDeviation={0.35} />
          </filter>
        ))
      )}
      {seeds.map(s => (
        <filter
          key={`c${s}`}
          id={`${prefix}-corrode-${s}`}
          x="0"
          y="0"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence type="fractalNoise" baseFrequency={0.12} numOctaves={2} seed={s + 7} />
          {/* The noise's red channel as coverage, cut steeply so a hole has
              an edge and not a fade: below 0.4 is eaten through. */}
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  16 0 0 0 -6.4" />
          <feComposite in="SourceGraphic" operator="in" />
        </filter>
      ))}
    </>
  );
}

/**
 * One entry of the map's key: a swatch, a stroke, or a heading for the ramp.
 * `hint` is what hovering the entry says, when the glossary entry its label
 * maps to would describe something else.
 */
export type LegendKey = (
  | { kind: 'label'; label: string }
  | { kind: 'node'; label: string; color: string; sym?: string; hatch?: boolean }
  | { kind: 'ring' | 'faded' | 'keystone' | 'eureka' | 'cutoff'; label: string }
  | { kind: 'waver' | 'corroded'; label: string; filter: string }
  | { kind: 'line'; label: string; color?: string; dashed?: boolean }
  | { kind: 'joint'; label: string; mark: JointMark }
) & { hint?: string };

/**
 * The tree's keys, each defined once: the key, the strip under the map and the
 * specimen page (src/client/dev) read them from here. `prefix` is the one the
 * enclosing svg's `MapFilters` were defined under, which the two textures name.
 */
export function mapKeys(prefix: string) {
  return {
    reached: { kind: 'node', color: 'var(--node-reached)', label: 'Reached' },
    next: { kind: 'ring', label: 'Next step' },
    askedFor: { kind: 'eureka', label: 'Asked for' },
    blocked: { kind: 'faded', label: 'Blocked' },
    keystone: { kind: 'keystone', label: 'Keystone' },
    passing: { kind: 'node', color: 'var(--ok)', sym: '✓', label: 'Passing' },
    // At the widest step, since the swatch is a third of a node's size.
    recovering: {
      kind: 'waver',
      label: 'Recovering',
      filter: waverOf(prefix, 4, 0).url,
      hint: 'Recovering: its last check passed after recent ones failed. The further the ring slips, the more of the last five failed.',
    },
    failing: {
      kind: 'node',
      color: 'var(--error)',
      sym: '!',
      label: 'Failing',
      hatch: true,
      hint: 'Failing: its last check failed. Configured, and not working.',
    },
    required: { kind: 'line', label: 'Required' },
    optional: { kind: 'line', dashed: true, label: 'Optional' },
    person: { kind: 'joint', mark: 'person', label: 'Needs a person' },
    device: { kind: 'joint', mark: 'device', label: 'Runs on a device' },
    down: {
      kind: 'node',
      color: 'var(--error)',
      label: 'Down',
      hint: 'What this simulation takes away.',
    },
    stops: {
      kind: 'corroded',
      label: 'Stops working',
      filter: corrosionOf(prefix, 0).url,
      hint: 'Rests on what went down and nothing else, so it stops with it. Still configured, so its ring holds.',
    },
    losesProvider: {
      kind: 'node',
      color: 'var(--warn)',
      label: 'Loses a provider',
      hint: 'Loses one way to work and keeps another.',
    },
    cutOff: {
      kind: 'cutoff',
      label: 'Cut off',
      hint: 'Not set up yet, and could not be while this is down.',
    },
  } satisfies Record<string, LegendKey>;
}

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
    case 'eureka':
      return (
        <>
          <circle r={7} fill="var(--bg-canvas)" stroke="var(--accent)" strokeWidth={1.25} />
          <EurekaMark r={7} fraction={2 / 3} />
        </>
      );
    case 'ring':
      return <circle r={7} fill="var(--bg-canvas)" stroke="var(--accent)" strokeWidth={2} />;
    case 'cutoff':
      return <circle r={7} fill="var(--bg-canvas)" stroke="var(--error)" strokeWidth={1.5} />;
    case 'corroded':
      return (
        <>
          <circle r={7} fill="var(--error-deep)" filter={entry.filter} />
          <circle r={7} fill="none" stroke="var(--error)" strokeWidth={1.5} />
        </>
      );
    case 'waver':
      return (
        <>
          <circle r={7} fill="var(--node-reached)" />
          <circle
            r={7}
            fill="none"
            stroke="var(--node-reached-ring)"
            strokeWidth={1.25}
            filter={entry.filter}
          />
        </>
      );
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
 * The rule under a callout's label: about 6.3px a character in the readout
 * face's narrow capitals at 11px, as measured.
 */
const calloutWidth = (text: string) => text.length * 6.3 + 4;

/** How far a callout reaches left of its node's centre, which a frame has to keep. */
export const calloutReach = (r: number, text: string) => r + 12 + calloutWidth(text);

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
  const width = calloutWidth(text);
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
