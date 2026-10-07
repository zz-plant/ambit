/**
 * A drawing made into a file a person keeps: the share card, and the whole map.
 *
 * The page draws with its stylesheet, its custom properties and its fonts,
 * and a file opened anywhere else reaches none of them. So an SVG is finished
 * here before it is saved: its namespace declared, every `var(--…)` written
 * out as the value the page holds for it, and the faces embedded. A PNG is
 * that SVG drawn onto a canvas.
 */
import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

/** An SVG document drawn onto a canvas, at the given size, as a PNG. */
export function svgToPng(svg: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('no image'))), 'image/png');
    };
    img.onerror = () => reject(new Error('the image did not draw'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/**
 * A React drawing as SVG markup, in the browser: rendered into a root that is
 * never attached, synchronously, and serialised as XML. The React the page
 * already loaded does it, so saving a file fetches no renderer of its own.
 */
export function renderStill(element: ReactElement): string {
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    flushSync(() => root.render(element));
    const svg = host.querySelector('svg');
    return svg ? new XMLSerializer().serializeToString(svg) : '';
  } finally {
    root.unmount();
  }
}

/** What `:root` holds for a custom property on this page; undefined when it holds nothing. */
export function pageToken(name: string): string | undefined {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
}

/**
 * `text` with every `var(--name)` and `var(--name, fallback)` replaced by what
 * `lookup` says the name holds, else the fallback, else nothing. A value that
 * is itself a `var()` is resolved in turn, to a depth no cycle outlasts.
 */
export function resolveVars(
  text: string,
  lookup: (name: string) => string | undefined,
  depth = 0
): string {
  if (depth > 8) return '';
  let out = '';
  let from = 0;
  for (;;) {
    const at = text.indexOf('var(', from);
    if (at < 0) return out + text.slice(from);
    // The parenthesis that closes this var(), past any its fallback opens,
    // and the comma, if one at this level divides the name from a fallback.
    let i = at + 4;
    let open = 1;
    let comma = -1;
    while (i < text.length) {
      const c = text[i];
      if (c === '(') open++;
      else if (c === ')' && --open === 0) break;
      else if (c === ',' && open === 1 && comma < 0) comma = i;
      i++;
    }
    const name = text.slice(at + 4, comma < 0 ? i : comma).trim();
    const fallback = comma < 0 ? undefined : text.slice(comma + 1, i).trim();
    out += text.slice(from, at) + resolveVars(lookup(name) ?? fallback ?? '', lookup, depth + 1);
    from = i + 1;
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Rendered SVG markup made to stand alone: the page's custom properties
 * written out, the namespace declared once, and `fonts`, `@font-face` rules
 * with the files inlined, placed in its `<defs>`. A value comes from a
 * stylesheet and goes into an attribute, so it is escaped on the way.
 */
export function standalone(
  markup: string,
  lookup: (name: string) => string | undefined,
  fonts = ''
): string {
  const attribute = (name: string) =>
    lookup(name)?.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  let svg = resolveVars(markup, attribute);
  if (!/^<svg\b[^>]*\sxmlns="/.test(svg)) svg = svg.replace(/^<svg\b/, `<svg xmlns="${SVG_NS}"`);
  return fonts ? svg.replace('<defs>', `<defs><style>${fonts}</style>`) : svg;
}

/**
 * Safari refuses a canvas over 16,777,216 pixels, and every engine one over
 * 16,384 a side. A canvas past either draws nothing and the save fails.
 */
const CANVAS_AREA = 16_777_216;
const CANVAS_SIDE = 16_384;

/**
 * The scale a PNG of a `width` by `height` drawing is made at: twice its size,
 * or less for a drawing so large that twice would not fit a canvas.
 */
export function pngScale(width: number, height: number): number {
  const fits = Math.min(
    2,
    Math.sqrt(CANVAS_AREA / (width * height)),
    CANVAS_SIDE / Math.max(width, height)
  );
  return Math.floor(fits * 100) / 100;
}

/** `ambit-map-2026-10-06.svg`: what the file is, and the day, local, it was saved. */
export function mapFileName(format: 'svg' | 'png', now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `ambit-map-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.${format}`;
}
