/**
 * What `npm run render:images` drives: the graph the page would show, loaded
 * the page's way, and the files its Image menu saves of the whole map, made
 * by the same function. Served by Vite in a checkout at
 * /ambit/dev/render.html (`?demo` for the demo) and never built into dist.
 *
 * It draws nothing to look at. `window.ambitRender()` makes the files and
 * answers with their names and lengths as base64; `window.ambitSlice(i, from,
 * to)` reads one out a piece at a time, since a reply of several megabytes
 * over the DevTools socket stalled where the same bytes in pieces did not.
 */
import '../App.css';
import { embeddedFontCss, installFonts } from '../fonts';
import { useAmbitStore } from '../store/ambitStore';
import { DRAWN_FACES, mapFile } from '../utils/mapFile';
import type { Showing } from '../utils/shareCard';

installFonts();

const RESTING: Showing = { mode: 'none', rootId: null, cascade: new Set() };

async function load(): Promise<void> {
  const store = useAmbitStore.getState();
  if (new URLSearchParams(location.search).has('demo')) store.seedDemo();
  else await store.loadGraph();
  const { items, error } = useAmbitStore.getState();
  if (!items.length) throw new Error(error ?? 'No graph to draw: the API did not answer.');
}

const ready = load();

const base64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

let made: { name: string; base64: string }[] = [];

/** The whole map as an SVG and a PNG, and the relief: what the Image menu saves of it. */
async function render(): Promise<{ name: string; length: number }[]> {
  await ready;
  await document.fonts.ready;
  const { items, connections } = useAmbitStore.getState();
  // A face that cannot be read leaves the image in its fallback, as on the page.
  const fonts = await embeddedFontCss(DRAWN_FACES).catch(() => '');
  const files = await Promise.all([
    mapFile(items, connections, 'svg', RESTING, fonts),
    mapFile(items, connections, 'png', RESTING, fonts),
    mapFile(items, connections, 'png', RESTING, fonts, 'relief'),
  ]);
  made = await Promise.all(files.map(async f => ({ name: f.name, base64: await base64(f) })));
  return made.map(f => ({ name: f.name, length: f.base64.length }));
}

Object.assign(window, {
  ambitRender: render,
  ambitSlice: (i: number, from: number, to: number) => made[i].base64.slice(from, to),
});
