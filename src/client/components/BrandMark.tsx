import { useId } from 'react';

/**
 * The Ambit mark: an A of three nodes and two edges on a gradient plate.
 *
 * It was drawn twice, once at 18px in the deck and once at 48px on the
 * welcome screen, with the stroke weights drifting apart between the two
 * copies. Decorative wherever it appears: the word "Ambit" is always beside it.
 */
export function BrandMark({ size, className }: { size: number; className?: string }) {
  // The gradient is referenced by id, and two marks on one page would
  // otherwise share one.
  const gradient = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${gradient})`} />
      <g stroke="#ffffff" strokeLinecap="round">
        <path d="M14 50 L32 14 L50 50" strokeWidth="8.5" />
        <path d="M21 40 H43" strokeWidth="7.5" />
      </g>
      <circle cx="32" cy="14" r="7.5" fill="#ffffff" />
      <circle cx="14" cy="50" r="6.5" fill="#ffffff" />
      <circle cx="50" cy="50" r="6.5" fill="#ffffff" />
    </svg>
  );
}
