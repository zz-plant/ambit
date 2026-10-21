/**
 * The whole map as a file: every era, node and edge, drawn from the graph and
 * not from the screen, at rest in the standard lens (see MapStill), or the
 * same map in relief. The page's Image menu saves one, and `npm run
 * render:images` writes them from a headless page, by this one function.
 */
import type { Connection, Item } from './configImporter';
import { FACES } from '../fonts';
import { mapFileName, pageToken, pngScale, renderStill, standalone, svgToPng } from './saveImage';
import type { Showing } from './shareCard';

/** The text and readout faces a saved image is set in, inlined: neither sets code. */
export const DRAWN_FACES = FACES.filter(f => f.family !== 'Monaspace Neon');

/**
 * The page's colours are written into it and its faces embedded, and a PNG is
 * drawn at twice the map's size, or as large as a canvas allows.
 */
export async function mapFile(
  items: Item[],
  connections: Connection[],
  format: 'svg' | 'png',
  showing: Showing,
  fonts: string,
  what: 'map' | 'relief' = 'map'
): Promise<File> {
  // Fetched with the map's own chunk, which the page has loaded by now.
  const [{ MapStill, stillLayout }, { MapRelief, RELIEF_EXTRA }] = await Promise.all([
    import('../components/civ/MapScene'),
    import('../components/civ/Relief'),
  ]);
  const layout = stillLayout(items, connections);
  const height = layout.height + (what === 'relief' ? RELIEF_EXTRA : 0);
  const scale = format === 'png' ? pngScale(layout.width, height) : 1;
  const still =
    what === 'relief' ? (
      <MapRelief connections={connections} layout={layout} scale={scale} />
    ) : (
      <MapStill
        items={items}
        connections={connections}
        layout={layout}
        simulation={showing}
        scale={scale}
      />
    );
  const svg = standalone(renderStill(still), pageToken, fonts);
  const blob =
    format === 'png'
      ? await svgToPng(svg, Math.round(layout.width * scale), Math.round(height * scale))
      : new Blob([svg], { type: 'image/svg+xml' });
  return new File([blob], mapFileName(format, new Date(), what), { type: blob.type });
}
