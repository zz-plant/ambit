/**
 * Who acted, drawn: a shape for the kind and a monogram for the name.
 *
 * Shape carries the kind, so it reads without colour: a circle for a person,
 * a rounded square for an agent, a hexagon for a machine, a diamond for
 * Ambit. The map's joint marks draw a person and a device the same way, a
 * disc and a box, so this extends a drawing the page already has. No faces
 * and no generated patterns: either would suggest an identity nobody
 * declared.
 */
import { type ActorKind, actorKind, actorLabel, monogram } from '../utils/actors';

const SHAPE: Record<ActorKind, (s: number) => React.ReactNode> = {
  person: s => <circle cx={s / 2} cy={s / 2} r={s / 2 - 1} />,
  agent: s => <rect x={1} y={1} width={s - 2} height={s - 2} rx={s / 4} />,
  machine: s => {
    const r = s / 2 - 1;
    const c = s / 2;
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      return `${c + r * Math.cos(a)},${c + r * Math.sin(a)}`;
    }).join(' ');
    return <polygon points={pts} />;
  },
  system: s => (
    <rect
      x={s * 0.15}
      y={s * 0.15}
      width={s * 0.7}
      height={s * 0.7}
      rx={2}
      transform={`rotate(45 ${s / 2} ${s / 2})`}
    />
  ),
};

interface ActorMarkProps {
  id: string | undefined | null;
  size?: number;
  /** Drawn beside a name that already says who, so the mark is not read twice. */
  decorative?: boolean;
}

export function ActorMark({ id, size = 22, decorative = false }: ActorMarkProps) {
  const kind = actorKind(id);
  if (!id || !kind) return null;
  const text = monogram(id);
  return (
    <svg
      className={`actor-mark actor-mark--${kind}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `${kind}: ${actorLabel(id)}`}
    >
      <g className="actor-mark-shape">{SHAPE[kind](size)}</g>
      <text
        x={size / 2}
        y={size / 2}
        dy="0.35em"
        textAnchor="middle"
        fontSize={text.length > 1 ? size * 0.4 : size * 0.48}
        fontWeight={600}
      >
        {text}
      </text>
    </svg>
  );
}
