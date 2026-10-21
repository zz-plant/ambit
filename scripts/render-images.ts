/**
 * render-images.ts — the saved images of the map, written to a directory.
 *
 * The page's Image menu saves the whole map as an SVG and a PNG, and the map
 * in relief. Judging a change to any of them meant clicking through the menu
 * and opening a download, and an agent working on the map could not do that
 * at all. This writes the same files from the same code: a headless Chrome
 * loads a page Vite serves in this checkout (src/client/dev/render.html), the
 * page loads the graph the way the map does, and `mapFile` draws each file as
 * the menu would. It also writes the specimen page (src/client/dev) whole, as
 * a PNG, since a screenshot of a pane is a small JPEG and a filter needs to be
 * judged at full size.
 *
 *   npm run render:images                   this checkout's graph, to output/images
 *   npm run render:images -- --demo         the hosted demo's graph
 *   npm run render:images -- --out <dir>    somewhere else
 *
 * The graph is the one `ambit where` names (AMBIT_DB overrides it), read
 * through the API server, which is started on a free loopback port for the
 * run and stopped after it. Everything listens on 127.0.0.1, and Chrome's own
 * background traffic is switched off, so nothing leaves the machine. The
 * files go to the directory given and never under dist/ or src/, which the
 * API server and Vite serve.
 *
 * Needs Chrome (CHROME_PATH, else the macOS default).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME, Cdp, freePort, launchChrome, sleep } from './lib/chrome.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
/** Wide enough that the specimen page sets its cards three to a row. */
const WIDTH = 1600;
const HEIGHT = 1000;
/** How much of a file one reply over the DevTools socket carries: see render.tsx. */
const SLICE = 1 << 20;

function parseArgs(argv: string[]): { out: string; demo: boolean } {
  let out = join(ROOT, 'output', 'images');
  let demo = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') demo = true;
    else if (a === '--out' || a.startsWith('--out=')) {
      const dir = a === '--out' ? argv[++i] : a.slice(6);
      if (!dir) throw new Error('--out takes a directory');
      out = resolve(dir);
    } else throw new Error(`unknown argument ${a}: takes --out <dir> and --demo`);
  }
  return { out, demo };
}

/** Under a directory the API server or Vite serves, a file would be served as part of the page. */
export function servedDir(out: string, root = ROOT): string | null {
  for (const dir of ['dist', 'src']) {
    const rel = relative(join(root, dir), out);
    if (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) return dir;
  }
  return null;
}

const procs: ChildProcess[] = [];
const closers: (() => unknown)[] = [];
/** Chrome's profile, for the run only. */
let work: string | undefined;

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  for (const close of closers) {
    try {
      close();
    } catch {}
  }
  for (const p of procs) {
    // Each child leads its own process group: the negative pid takes its
    // subtree with it, as record-hero-gif.ts does for the same reason.
    try {
      if (p.pid) process.kill(-p.pid, 'SIGKILL');
    } catch {}
  }
  try {
    if (work) rmSync(work, { recursive: true, force: true });
  } catch {}
}

async function main() {
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.on(sig, () => {
      cleanup();
      process.exit(1);
    });
  const { out, demo } = parseArgs(process.argv.slice(2));
  const served = servedDir(out);
  if (served) throw new Error(`${out} is under ${served}/, which is served; choose another --out`);
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}; set CHROME_PATH`);

  const apiPort = await freePort();
  const webPort = await freePort();

  if (!demo) {
    // The API accepts a page's Origin only on the port it was told the page
    // is on, as `npm run dev` tells it.
    const api = spawn(
      NODE,
      ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'src/server/api.ts'],
      {
        cwd: ROOT,
        env: { ...process.env, AMBIT_API_PORT: String(apiPort), AMBIT_WEB_PORT: String(webPort) },
        stdio: 'ignore',
        detached: true,
      }
    );
    procs.push(api);
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      try {
        up = (await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok;
      } catch {}
      if (!up) await sleep(250);
    }
    if (!up) throw new Error('the API server did not start');
  }

  // vite.config.ts reads the API's port from here for its /api proxy.
  process.env.AMBIT_API_PORT = String(apiPort);
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: join(ROOT, 'vite.config.ts'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: webPort, strictPort: true, hmr: false },
  });
  await vite.listen();
  closers.push(() => vite.close());

  work = mkdtempSync(join(tmpdir(), 'ambit-render-'));
  const cdpPort = await freePort();
  procs.push(launchChrome(cdpPort, join(work, 'profile'), { width: WIDTH, height: HEIGHT }));
  const cdp = await Cdp.attach(cdpPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  // The map's simulation ripples are motion, and a still taken mid-ripple
  // draws a ring that is not there at rest. Reduced motion hides them.
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });

  const page = (path: string) => `http://127.0.0.1:${webPort}/ambit/dev/${path}`;
  /** Navigate, and wait until `ready` (an expression) holds. */
  const open = async (url: string, ready: string) => {
    await cdp.send('Page.navigate', { url });
    for (let i = 0; i < 100; i++) {
      if (await cdp.eval(`Boolean(${ready})`).catch(() => false)) return;
      await sleep(200);
    }
    throw new Error(`${url} never became ready`);
  };

  mkdirSync(out, { recursive: true });
  const written: string[] = [];

  await open(page(`render.html${demo ? '?demo' : ''}`), 'window.ambitRender');
  const result = await cdp.send(
    'Runtime.evaluate',
    { expression: 'window.ambitRender()', awaitPromise: true, returnByValue: true },
    120_000
  );
  if (result.exceptionDetails) {
    const d = result.exceptionDetails;
    throw new Error(d.exception?.description || d.exception?.value || d.text);
  }
  const files = result.result.value as { name: string; length: number }[];
  for (const [i, file] of files.entries()) {
    let base64 = '';
    for (let from = 0; from < file.length; from += SLICE) {
      base64 += await cdp.eval(`window.ambitSlice(${i}, ${from}, ${from + SLICE})`);
    }
    const path = join(out, file.name);
    writeFileSync(path, Buffer.from(base64, 'base64'));
    written.push(path);
  }

  await open(page('specimen.html'), "document.querySelector('.specimen-card')");
  await cdp.eval('document.fonts.ready.then(() => true)');
  const { cssContentSize } = await cdp.send('Page.getLayoutMetrics');
  const shot = await cdp.send(
    'Page.captureScreenshot',
    {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: Math.ceil(cssContentSize.width),
        height: Math.ceil(cssContentSize.height),
        scale: 1,
      },
    },
    60_000
  );
  const specimens = join(out, 'ambit-specimens.png');
  writeFileSync(specimens, Buffer.from(shot.data, 'base64'));
  written.push(specimens);

  const shown = (path: string) => {
    const rel = relative(process.cwd(), path);
    return rel.startsWith('..') ? path : rel;
  };
  console.log(
    `Drew ${demo ? 'the demo' : "this checkout's graph"}:\n${written.map(w => `  ${shown(w)}`).join('\n')}`
  );
}

if (process.argv[1]?.endsWith('render-images.ts')) {
  main()
    .then(() => {
      // The socket, the servers and Chrome hold the loop open.
      cleanup();
      process.exit(0);
    })
    .catch(e => {
      console.error(`render:images failed: ${e.message}`);
      cleanup();
      process.exit(1);
    });
}
