/**
 * Every view of the page as a screenshot, at the sizes people take them at.
 *
 * `npm run shots` builds the page into a scratch directory, serves it, and
 * drives a headless Chrome through each view of the demo at 1440×900,
 * 1280×720 and a 390×844 phone, then writes the PNGs and one contact sheet to
 * output/shots. A view should make a good picture as it stands: nothing cut
 * at the frame's edge, a sentence that says what it is, a sample's figure
 * labelled as one, nothing loading or broken. Three of those can be checked
 * by machine, and each shot is: the header's status pill on one line, no
 * column of the map cut at the left edge or under the detail panel, and no
 * view still loading. What a
 * check finds is printed and marked on the sheet. Run it before a pull request
 * that changes how a view looks.
 *
 * With `--live` it adds the machine's own first visit and My Setup, from this
 * checkout's graph through the API server, the way `npm run render:images`
 * draws it. Those show the machine's own configs; `--home <dir>` points the
 * server at a fixture's instead (with AMBIT_DB at its graph), for shots that
 * can be shared.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { hasApi } from './lib/api-health.ts';
import { CHROME, Cdp, freePort, launchChrome, sleep } from './lib/chrome.ts';
import { servedDir } from './render-images.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT_SHA = /^[0-9a-f]{40}$/;

export const SIZES = {
  desk: { width: 1440, height: 900, mobile: false },
  wide: { width: 1280, height: 720, mobile: false },
  phone: { width: 390, height: 844, mobile: true },
} as const;
export type SizeName = keyof typeof SIZES;

/** A config pasted into the demo's intake, for the readout of a visitor's own setup. */
const PASTE = JSON.stringify({
  mcpServers: {
    github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
    playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
    postgres: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'] },
  },
});

export interface Shot {
  name: string;
  /** Under the page's base, `/ambit/`. */
  path: string;
  sizes: SizeName[];
  /** An expression that holds once the view has drawn. */
  ready: string;
  /** Run once ready, before the shot. */
  act?: string;
  /** A first visit: the page's storage is cleared before it loads. */
  fresh?: boolean;
  /** Read from this checkout's graph through the API, under `--live`. */
  live?: boolean;
  /** Served with no API answering, as a page with no engine behind it is. */
  offline?: boolean;
}

const D = '/ambit/?demo=1';
const LOADED = "!document.querySelector('.app-loading')";
export const SHOTS: Shot[] = [
  {
    name: 'map-tour',
    path: D,
    sizes: ['desk', 'wide', 'phone'],
    fresh: true,
    ready:
      "document.querySelector('.app-tour') && document.querySelector('.civ-scroll svg g[role=button]')",
  },
  {
    name: 'map-rest',
    path: `${D}&view=map&guide=off`,
    sizes: ['desk', 'wide', 'phone'],
    ready: "document.querySelector('.civ-scroll svg g[role=button]')",
  },
  {
    name: 'map-selected',
    path: `${D}&view=map&guide=off&focus=combo:browser-automation`,
    sizes: ['desk', 'phone'],
    ready: "document.querySelector('.app-detail-panel')",
  },
  {
    name: 'map-outage',
    path: `${D}&tour=outage`,
    sizes: ['desk', 'phone'],
    fresh: true,
    ready:
      "document.querySelector('.app-tour') && document.querySelector('.civ-scroll svg g[role=button]')",
  },
  {
    // An unlock the page does not narrate, after a zoom by hand: the map frames
    // it itself, and its banner sits a row under the controls. Only the hero
    // recording ever showed that banner lying over the era names.
    name: 'map-unlock',
    path: `${D}&view=map&guide=off`,
    sizes: ['desk', 'wide', 'phone'],
    ready: "document.querySelector('.civ-finding-btn')",
    act: `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const zoomIn = document.querySelector('[aria-label="Zoom in"]');
      for (let i = 0; i < 3; i++) {
        zoomIn.click();
        await wait(200);
      }
      [...document.querySelectorAll('.civ-finding-btn')].find(b => b.textContent.trim() === 'Preview').click();
      return true;
    })()`,
  },
  {
    // An outage rooted in the first column, whose callout reaches past the map's edge.
    name: 'map-outage-edge',
    path: `${D}&view=map&guide=off&focus=combo:shell-execution`,
    sizes: ['desk', 'phone'],
    ready: "document.querySelector('.app-detail-panel')",
    act: `(() => {
      [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Simulate an outage').click();
      return true;
    })()`,
  },
  {
    name: 'readout',
    path: D,
    sizes: ['desk', 'phone'],
    fresh: true,
    ready: "document.querySelector('.intake-agent')",
    act: `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      [...document.querySelectorAll('.intake-agent')].find(b => b.textContent === 'Claude Code').click();
      await wait(200);
      const box = document.querySelector('.intake-paste');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(PASTE)});
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(100);
      [...document.querySelectorAll('.intake-btn')].find(b => b.textContent === 'Map it').click();
      return true;
    })()`,
  },
  {
    name: 'setup',
    path: `${D}&view=setup&guide=off`,
    sizes: ['desk', 'phone'],
    ready: "document.querySelector('.setup-group')",
  },
  {
    name: 'cost',
    path: `${D}&view=cost&guide=off`,
    sizes: ['desk', 'wide', 'phone'],
    ready: `document.querySelector('.loop-dashboard') && ${LOADED}`,
  },
  {
    name: 'audit',
    path: `${D}&view=audit&guide=off`,
    sizes: ['desk', 'phone'],
    ready: `document.querySelector('.audit-view') && ${LOADED}`,
  },
  {
    name: 'proposals',
    path: `${D}&view=proposals&guide=off`,
    sizes: ['desk', 'phone'],
    ready: `document.querySelector('.proposals-view') && ${LOADED}`,
  },
  {
    name: 'welcome',
    path: '/ambit/',
    sizes: ['desk', 'phone'],
    fresh: true,
    offline: true,
    ready: "document.querySelector('.app-welcome')",
  },
  {
    name: 'live-first',
    path: '/ambit/',
    sizes: ['desk', 'phone'],
    fresh: true,
    live: true,
    ready:
      "document.querySelector('.app-ambit') && document.querySelector('.civ-scroll svg g[role=button]')",
  },
  {
    name: 'live-setup',
    path: '/ambit/?view=setup&guide=off',
    sizes: ['desk'],
    live: true,
    ready: "document.querySelector('.setup-group')",
  },
];

/**
 * The checks a machine can make of a frame, run in the page. Each returns a
 * sentence for what it found, or nothing.
 */
const CHECKS = `(() => {
  const found = [];
  const pill = document.querySelector('.app-status-pill');
  if (pill) {
    const kids = [...pill.children].filter(k => k.offsetHeight > 0);
    if (kids.length > 1 && kids[kids.length - 1].offsetTop > kids[0].offsetTop + 2)
      found.push('the status pill wraps onto a second line');
  }
  const scroll = document.querySelector('.civ-scroll');
  if (scroll) {
    const edge = scroll.getBoundingClientRect().left;
    const cut = [...scroll.querySelectorAll('rect')].find(r => {
      if (r.getAttribute('fill') !== 'var(--band)') return false;
      const b = r.getBoundingClientRect();
      return b.width > 0 && b.left < edge - 1 && b.right > edge + 1;
    });
    if (cut) found.push('a column is cut at the left edge of the map');
    // A panel beside the map, not a sheet under it: no column runs under its edge.
    const panel = document.querySelector('.app-detail-panel')?.getBoundingClientRect();
    if (panel && panel.height > innerHeight * 0.6 && panel.left > innerWidth * 0.5) {
      const under = [...scroll.querySelectorAll('rect')].find(r => {
        if (r.getAttribute('fill') !== 'var(--band)') return false;
        const b = r.getBoundingClientRect();
        return b.width > 0 && b.left < panel.left - 1 && b.right > panel.left + 1;
      });
      if (under) found.push('a column runs under the detail panel');
    }
  }
  const banner = document.querySelector('.civ-sim-banner')?.getBoundingClientRect();
  if (banner) {
    const over = [...document.querySelectorAll('.civ-era-head')].some(head => {
      const h = head.getBoundingClientRect();
      return (
        h.width > 0 && h.left < banner.right && h.right > banner.left &&
        h.top < banner.bottom && h.bottom > banner.top
      );
    });
    if (over) found.push("a simulation's banner lies over an era name");
  }
  const callout = document.querySelector('.civ-callout')?.getBoundingClientRect();
  const map = scroll?.getBoundingClientRect();
  if (callout && map && (callout.left < map.left - 1 || callout.top < map.top - 1))
    found.push("the outage's callout runs off the map");
  if (document.querySelector('.app-loading')) found.push('a view is still loading');
  return found;
})()`;

const procs: ChildProcess[] = [];
const closers: (() => unknown)[] = [];
let work: string | undefined;
function cleanup() {
  for (const close of closers) {
    try {
      close();
    } catch {}
  }
  for (const p of procs) {
    try {
      if (p.pid) process.kill(-p.pid, 'SIGKILL');
    } catch {}
  }
  if (work) rmSync(work, { recursive: true, force: true });
}

const HELP = `Usage: npm run shots -- [options]

  --url <url>    Use a running dev or hosted site at /ambit/ (default: build locally)
  --only <names> Comma-separated shot names
  --size <name>  Capture one viewport: ${Object.keys(SIZES).join(', ')}
  --strict       Exit nonzero when a frame is flagged
  --expect-revision <sha>  Require this full commit SHA on every page; implies --strict
  --live         Include views that require a live Ambit API
  --home <dir>   Use this HOME for the API started by the runner; implies --live
  --out <dir>    Write PNGs, index.html and report.json here (default: output/shots)

Shots:
${SHOTS.map(s => `  ${s.name.padEnd(17)} ${s.sizes.join(', ')}${s.live ? ' (requires --live)' : s.offline ? ' (local build only)' : ''}`).join('\n')}`;

export function parseShotArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      url: { type: 'string' },
      only: { type: 'string' },
      size: { type: 'string' },
      out: { type: 'string' },
      home: { type: 'string' },
      live: { type: 'boolean' },
      strict: { type: 'boolean' },
      'expect-revision': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const { url, only, size, out, home, live, strict, help } = values;
  const revision = values['expect-revision']?.toLowerCase();
  if (revision !== undefined && !COMMIT_SHA.test(revision))
    throw new Error('--expect-revision requires a full commit SHA');
  let origin: string | undefined;
  if (url !== undefined) {
    const target = URL.parse(url);
    if (
      !target ||
      !['http:', 'https:'].includes(target.protocol) ||
      target.username ||
      target.password ||
      !['/', '/ambit', '/ambit/'].includes(target.pathname) ||
      target.search ||
      target.hash
    ) {
      throw new Error(
        '--url takes an HTTP(S) origin or /ambit/ URL without credentials, query or fragment'
      );
    }
    if (home !== undefined) throw new Error('--home applies only to the API started by the runner');
    origin = target.origin;
  }
  if (size !== undefined && !Object.hasOwn(SIZES, size)) throw new Error(`Unknown size: ${size}`);
  if (out === '' || home === '') throw new Error('--out and --home require a directory');
  return {
    origin,
    size: size as SizeName | undefined,
    out: out ? resolve(out) : join(ROOT, 'output', 'shots'),
    home: home ? resolve(home) : undefined,
    only: only?.split(',').map(name => name.trim()),
    live: Boolean(live || home),
    strict: Boolean(strict || revision),
    revision,
    help,
  };
}

export function selectShots({
  origin,
  live,
  only,
  size,
}: ReturnType<typeof parseShotArgs>): Shot[] {
  const available = SHOTS.filter(s => (live || !s.live) && (!origin || !s.offline));
  for (const name of only ?? []) {
    const shot = available.find(s => s.name === name);
    if (!shot) throw new Error(`Shot unavailable for this target: ${name}. See --help.`);
    if (size && !shot.sizes.includes(size)) {
      throw new Error(`Shot ${name} has no ${size} viewport. See --help.`);
    }
  }
  return available.filter(
    s => (!only || only.includes(s.name)) && (!size || s.sizes.includes(size))
  );
}

interface ShotResult {
  name: string;
  size: SizeName;
  file: string | null;
  found: string[];
  revision: string | null;
}

/** The contact sheet: every shot by view and size, with what the checks found under each. */
export function contactSheet(rows: ShotResult[]): string {
  const html = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const views = [...new Set(rows.map(r => r.name))];
  const cells = views
    .map(view => {
      const shots = rows
        .filter(r => r.name === view)
        .map(
          r =>
            `<figure class="${r.size}${r.found.length ? ' flagged' : ''}">${r.file ? `<img src="${r.file}" alt="${html(`${view} at ${r.size}`)}">` : ''}<figcaption>${r.size}${r.found.map(f => `<br><b>${html(f)}</b>`).join('')}</figcaption></figure>`
        )
        .join('');
      return `<section><h2>${html(view)}</h2><div class="row">${shots}</div></section>`;
    })
    .join('');
  return `<!doctype html><meta charset="utf-8"><title>Ambit shots</title><style>
body{margin:0;padding:24px;background:#0f1013;color:#e8e8ea;font:14px system-ui,sans-serif}
h2{font-size:15px;margin:28px 0 10px}.row{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}
figure{margin:0}figure img{display:block;width:480px;border:1px solid #333;border-radius:6px}
figure.phone img{width:180px}figure.flagged img{border-color:#ef6461}
figcaption{margin-top:6px;color:#8a8e96}figcaption b{color:#ef6461;font-weight:600}
</style><h1>Every view, as a screenshot</h1>${cells}`;
}

async function startPreview(directory: string, live: boolean, home?: string) {
  const vite = await import('vite');
  const config = join(ROOT, 'vite.config.ts');
  const outDir = join(directory, 'dist');
  await vite.build({ configFile: config, logLevel: 'error', build: { outDir, emptyOutDir: true } });

  // The page with an engine behind it, for --live, and with none, for the demo
  // and the welcome a page with no engine shows.
  const apiPort = await freePort();
  if (live) {
    const api = spawn(
      process.execPath,
      ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'src/server/api.ts'],
      {
        cwd: ROOT,
        // Under --home the server reads that directory's agent configs, so a
        // shot of My Setup shows a fixture and never the machine's own.
        env: { ...process.env, AMBIT_API_PORT: String(apiPort), ...(home ? { HOME: home } : {}) },
        stdio: 'ignore',
        detached: true,
      }
    );
    procs.push(api);
    let up = false;
    for (let i = 0; i < 60 && api.exitCode === null && !up; i++) {
      up = await hasApi(`http://127.0.0.1:${apiPort}`);
      if (!up) await sleep(250);
    }
    if (!up) throw new Error(`Ambit API did not start on port ${apiPort}`);
  }
  // With no engine the page is static files, as the hosted site is: /api/health
  // answers with index.html, which the page reads as no engine. A proxy to a
  // closed port said the same and logged an error for every page load.
  const serve = async (target?: number) => {
    const port = await freePort();
    const server = await vite.preview({
      configFile: config,
      logLevel: 'error',
      build: { outDir },
      preview: {
        host: '127.0.0.1',
        port,
        strictPort: true,
        // Empty, not absent: an absent one takes the dev server's, to :3001.
        proxy: target ? { '/api': `http://127.0.0.1:${target}` } : {},
      },
    });
    closers.push(() => server.httpServer.close());
    return `http://127.0.0.1:${port}`;
  };
  const offline = await serve();
  return { offline, main: live ? await serve(apiPort) : offline };
}

async function main(): Promise<number> {
  const options = parseShotArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  const { out, live, home, origin, size, strict, revision } = options;
  const shots = selectShots(options);
  const served = servedDir(out);
  if (served) throw new Error(`${out} is under ${served}/, which is served; choose another --out`);
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}; set CHROME_PATH`);

  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.on(sig, () => process.exit(1));
  work = mkdtempSync(join(tmpdir(), 'ambit-shots-'));
  const sites = origin ? { main: origin, offline: origin } : await startPreview(work, live, home);
  const target = origin ? `${origin}/ambit/` : 'local build';
  console.log(`Capturing ${target}`);
  const apiMissing = origin && shots.some(shot => shot.live) && !(await hasApi(origin));

  const cdpPort = await freePort();
  procs.push(launchChrome(cdpPort, join(work, 'profile'), { width: 1440, height: 900 }));
  const cdp = await Cdp.attach(cdpPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // A simulation's ripples are motion, and a still taken mid-ripple draws a
  // ring that is not there at rest.
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  // A navigation that stalls, which a page busy drawing can make it do, is
  // stopped and tried once more; a shot of the page it left would be a shot
  // of the wrong view, labelled as the right one. Arrival is a new document,
  // since the page rewrites its own address as it reads it.
  const go = async (url: string) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await cdp.eval('window.__shotsLeft = true').catch(() => {});
      try {
        const { errorText } = await cdp.send('Page.navigate', { url }, 10_000);
        if (errorText) return errorText as string;
      } catch {
        await cdp.send('Page.stopLoading').catch(() => {});
      }
      for (let i = 0; i < 50; i++) {
        const fresh = await cdp
          .eval("!window.__shotsLeft && document.readyState !== 'loading'")
          .catch(() => false);
        if (fresh) return null;
        await sleep(200);
      }
    }
    return 'the page never arrived';
  };

  mkdirSync(out, { recursive: true });
  const rows: ShotResult[] = [];
  for (const shot of shots) {
    const origin = shot.offline ? sites.offline : sites.main;
    for (const sizeName of size ? [size] : shot.sizes) {
      const size = SIZES[sizeName];
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: size.width,
        height: size.height,
        deviceScaleFactor: 1,
        mobile: size.mobile,
      });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: size.mobile });
      // A first visit: what this origin stored is cleared before the page
      // loads, where clearing it from the page raced the page's own writes.
      if (shot.fresh) {
        await cdp.send('Storage.clearDataForOrigin', {
          origin,
          storageTypes: 'local_storage,session_storage',
        });
      }
      const navigationError =
        shot.live && apiMissing ? 'No live Ambit API at /api/health' : await go(origin + shot.path);
      // Read from the same document as the frame. A deploy may land between
      // navigations, and a separate request could hit a different cache.
      const revisionTag: unknown = navigationError
        ? null
        : await cdp
            .eval("document.querySelector('meta[name=ambit-revision]')?.content || null")
            .catch(() => null);
      const pageRevision =
        typeof revisionTag === 'string' && COMMIT_SHA.test(revisionTag) ? revisionTag : null;
      let ready = false;
      for (let i = 0; !navigationError && i < 100 && !ready; i++) {
        ready = await cdp.eval(`Boolean(${shot.ready})`).catch(() => false);
        if (!ready) await sleep(200);
      }
      if (ready) await cdp.eval('document.fonts.ready.then(() => true)').catch(() => {});
      // A shot whose action failed is of some other state, and says so.
      const acted =
        ready && shot.act
          ? await cdp.eval(shot.act).then(
              () => true,
              e => {
                console.error(`${shot.name}: ${e.message}`);
                return false;
              }
            )
          : true;
      // Framing scrolls smoothly, and a simulation settles over a second.
      if (ready) await sleep(2200);
      const found: string[] = navigationError
        ? [navigationError]
        : !ready
          ? ['the view never drew']
          : [...(acted ? [] : ['the action before the shot failed']), ...(await cdp.eval(CHECKS))];
      if (!navigationError && revision && pageRevision !== revision) {
        found.push(`Expected revision ${revision}; page reported ${pageRevision ?? 'none'}`);
      }
      const filename = `${shot.name}--${sizeName}.png`;
      let file: string | null = null;
      if (!navigationError) {
        const png = await cdp.shot().catch(error => {
          found.push(`Chrome could not capture the frame: ${error.message}`);
          return null;
        });
        if (png) {
          writeFileSync(join(out, filename), png);
          file = filename;
        }
      }
      rows.push({ name: shot.name, size: sizeName, file, found, revision: pageRevision });
      console.log(
        `${found.length ? '!' : '✓'} ${filename}${found.map(f => `\n    ${f}`).join('')}`
      );
    }
  }
  const sheet = join(out, 'index.html');
  writeFileSync(sheet, contactSheet(rows));
  const flagged = rows.filter(r => r.found.length).length;
  writeFileSync(
    join(out, 'report.json'),
    JSON.stringify({ target, flagged, expectedRevision: revision ?? null, shots: rows }, null, 2) +
      '\n'
  );
  const rel = relative(process.cwd(), sheet);
  console.log(
    `\n${rows.length} ${rows.length === 1 ? 'shot' : 'shots'}, ${flagged ? `${flagged} flagged` : 'none flagged'}. The sheet: ${rel.startsWith('..') ? sheet : rel}`
  );
  return strict && flagged ? 1 : 0;
}

if (process.argv[1]?.endsWith('shots.ts')) {
  main()
    .then(code => process.exit(code))
    .catch(e => {
      console.error(`shots failed: ${e.message}`);
      process.exit(1);
    });
}
