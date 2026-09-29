/**
 * The Ambit mark: an A of three nodes and two edges, cut in the ground colour
 * from a plate of the accent.
 *
 * It is the React copy of `mark()` and `plated()` in scripts/generate-scenes.ts,
 * which draw the favicon, the touch icon and the link cards, and the geometry
 * below is that file's, number for number. This copy had drifted once already:
 * thinner strokes, smaller nodes and its own indigo, so the header and the tab
 * beside it showed two marks. The colours are the tokens, so the mark follows
 * App.css where the generated files have to be regenerated.
 *
 * Decorative wherever it appears: the word "Ambit" is always beside it.
 */
export function BrandMark({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <g stroke="var(--bg-canvas)" strokeLinecap="round">
        <path d="M13 51 L32 12" strokeWidth="9.5" />
        <path d="M51 51 L32 12" strokeWidth="9.5" />
        <path d="M20 40 H44" strokeWidth="8.5" />
      </g>
      <circle cx="32" cy="12" r="8.5" fill="var(--bg-canvas)" />
      <circle cx="13" cy="51" r="7.5" fill="var(--bg-canvas)" />
      <circle cx="51" cy="51" r="7.5" fill="var(--bg-canvas)" />
    </svg>
  );
}
