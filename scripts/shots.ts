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
import { CHROME, Cdp, freePort, launchChrome, sleep } from './lib/chrome.ts';
import { servedDir } from './render-images.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

function parseArgs(argv: string[]): {
  out: string;
  live: boolean;
  home?: string;
  only?: string[];
} {
  let out = join(ROOT, 'output', 'shots');
  let live = false;
  let home: string | undefined;
  let only: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--live') live = true;
    else if (a === '--out' || a.startsWith('--out='))
      out = resolve(a === '--out' ? argv[++i] : a.slice(6));
    else if (a === '--home' || a.startsWith('--home=')) {
      home = resolve(a === '--home' ? argv[++i] : a.slice(7));
      live = true;
    } else if (a === '--only' || a.startsWith('--only='))
      only = (a === '--only' ? argv[++i] : a.slice(7)).split(',');
    else
      throw new Error(
        `unknown argument ${a}: takes --out <dir>, --only <names>, --live and --home <dir>`
      );
  }
  return { out, live, home, only };
}

/** The contact sheet: every shot by view and size, with what the checks found under each. */
export function contactSheet(
  rows: { name: string; size: SizeName; file: string; found: string[] }[]
): string {
  const html = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const views = [...new Set(rows.map(r => r.name))];
  const cells = views
    .map(view => {
      const shots = rows
        .filter(r => r.name === view)
        .map(
          r =>
            `<figure class="${r.size}${r.found.length ? ' flagged' : ''}"><img src="${r.file}" alt="${html(`${view} at ${r.size}`)}"><figcaption>${r.size}${r.found.map(f => `<br><b>${html(f)}</b>`).join('')}</figcaption></figure>`
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

async function main() {
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.on(sig, () => {
      cleanup();
      process.exit(1);
    });
  const { out, live, home, only } = parseArgs(process.argv.slice(2));
  const served = servedDir(out);
  if (served) throw new Error(`${out} is under ${served}/, which is served; choose another --out`);
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}; set CHROME_PATH`);
  const shots = SHOTS.filter(s => (live || !s.live) && (!only || only.includes(s.name)));

  work = mkdtempSync(join(tmpdir(), 'ambit-shots-'));
  const vite = await import('vite');
  const config = join(ROOT, 'vite.config.ts');
  const outDir = join(work, 'dist');
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
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok) break;
      } catch {}
      await sleep(250);
    }
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
    return port;
  };
  const noApi = await serve();
  const withApi = live ? await serve(apiPort) : noApi;

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
        await cdp.send('Page.navigate', { url }, 10_000);
      } catch {
        await cdp.send('Page.stopLoading').catch(() => {});
      }
      for (let i = 0; i < 50; i++) {
        const fresh = await cdp
          .eval("!window.__shotsLeft && document.readyState !== 'loading'")
          .catch(() => false);
        if (fresh) return true;
        await sleep(200);
      }
    }
    return false;
  };

  mkdirSync(out, { recursive: true });
  const rows: { name: string; size: SizeName; file: string; found: string[] }[] = [];
  for (const shot of shots) {
    const origin = `http://127.0.0.1:${shot.offline ? noApi : withApi}`;
    for (const sizeName of shot.sizes) {
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
      const arrived = await go(origin + shot.path);
      let ready = false;
      for (let i = 0; i < 100 && !ready; i++) {
        ready = await cdp.eval(`Boolean(${shot.ready})`).catch(() => false);
        if (!ready) await sleep(200);
      }
      await cdp.eval('document.fonts.ready.then(() => true)').catch(() => {});
      if (shot.act)
        await cdp.eval(shot.act).catch(e => console.error(`${shot.name}: ${e.message}`));
      // Framing scrolls smoothly, and a simulation settles over a second.
      await sleep(2200);
      const found: string[] = !arrived
        ? ['the page never arrived']
        : ready
          ? await cdp.eval(CHECKS)
          : ['the view never drew'];
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, 30_000);
      const file = `${shot.name}--${sizeName}.png`;
      writeFileSync(join(out, file), Buffer.from(data, 'base64'));
      rows.push({ name: shot.name, size: sizeName, file, found });
      console.log(`${found.length ? '!' : '✓'} ${file}${found.map(f => `\n    ${f}`).join('')}`);
    }
  }
  const sheet = join(out, 'index.html');
  writeFileSync(sheet, contactSheet(rows));
  const flagged = rows.filter(r => r.found.length).length;
  const rel = relative(process.cwd(), sheet);
  console.log(
    `\n${rows.length} shots, ${flagged ? `${flagged} flagged` : 'none flagged'}. The sheet: ${rel.startsWith('..') ? sheet : rel}`
  );
}

if (process.argv[1]?.endsWith('shots.ts')) {
  main()
    .then(() => {
      cleanup();
      process.exit(0);
    })
    .catch(e => {
      console.error(`shots failed: ${e.message}`);
      cleanup();
      process.exit(1);
    });
}
