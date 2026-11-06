import type { ComponentProps } from 'react';

/**
 * A line icon: drawn in the text's colour on a square grid, and hidden from a
 * screen reader, since the control around it carries the name.
 */
export function Icon({
  size = 13,
  grid = 16,
  ...svg
}: ComponentProps<'svg'> & { size?: number; grid?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${grid} ${grid}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
      {...svg}
    />
  );
}
