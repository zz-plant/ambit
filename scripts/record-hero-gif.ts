/**
 * record-hero-gif.ts — records docs/assets/capability-graph-demo.gif.
 *
 * The hero image had drifted two UI generations behind: it showed a light
 * theme and a tab layout that no longer exist, so the first thing a reader
 * saw was a screenshot of a different product. A hand-made recording rots
 * that way because nothing re-runs it. This does, and it fails rather than
 * rendering something stale.
 *
 * Every frame is the real client driven over the Chrome DevTools Protocol.
 * The graph behind it is seeded from a fixture config into a throwaway
 * database, with HOME pointed at a scratch directory, because the alternative
 * is publishing a picture of whoever ran it: the API reads ~/.config, and a
 * recording made against a live machine puts that person's MCP servers,
 * agents and hostnames in the README.
 *
 * Needs Chrome and ffmpeg.
 *   npm run assets:hero
 */
import { spawn, execFileSync, execSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_GIF = join(ROOT, 'docs', 'assets', 'capability-graph-demo.gif');
const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Wider than the GIF it produces. The capability list is a 340px overlay the
// canvas draws underneath, so at 1280 "fit to view" put the last two era
// columns behind it or off the edge — and collapsing the list does not help,
// because collapsing only lets the canvas extend under it. Recording at 1600
// and scaling down to GIF_WIDTH gives the tree room to be whole.
const WIDTH = 1600;
const HEIGHT = 900;
const GIF_WIDTH = 1040;
const FPS = 8;

// The fixture the graph is built from. Broad enough to light every era column
// and to give the frontier something to be one step away from; entirely
// invented, so nothing here describes the machine that runs it.
const FIXTURE = {
  provider: { anthropic: { name: 'Anthropic' }, ollama: { name: 'Ollama' } },
  agent: {
    reviewer: { description: 'Reviews diffs before merge' },
    researcher: { description: 'Reads docs and summarises' },
  },
  mcp: {
    git: { type: 'local', command: ['git-mcp'], enabled: true },
    github: { type: 'remote', command: ['github-mcp'], enabled: true },
    filesystem: { type: 'local', command: ['fs-mcp'], enabled: true },
    playwright: { type: 'local', command: ['playwright-mcp'], enabled: true },
    sqlite: { type: 'local', command: ['sqlite-mcp'], enabled: true },
    fetch: { type: 'remote', command: ['fetch-mcp'], enabled: true },
    memory: { type: 'local', command: ['memory-mcp'], enabled: true },
    docker: { type: 'local', command: ['docker-mcp'], enabled: true },
    postgres: { type: 'local', command: ['postgres-mcp'], enabled: true },
    slack: { type: 'remote', command: ['slack-mcp'], enabled: true },
    sentry: { type: 'remote', command: ['sentry-mcp'], enabled: true },
    kubernetes: { type: 'local', command: ['k8s-mcp'], enabled: true },
    grafana: { type: 'remote', command: ['grafana-mcp'], enabled: true },
    puppeteer: { type: 'local', command: ['puppeteer-mcp'], enabled: true },
  },
  command: {
    deploy: { description: 'Ship to staging' },
    migrate: { description: 'Run database migrations' },
    bench: { description: 'Run the benchmark suite' },
  },
};

let cdpRef: Cdp | null = null;
const procs: ChildProcess[] = [];
const work = mkdtempSync(join(tmpdir(), 'ambit-hero-'));
const servers: { close(): void }[] = [];

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  for (const p of procs) {
    // Each child is its own process group leader, so the negative pid takes
    // the API server's and Chrome's whole subtree with it. Killing the direct
    // child alone left the API listening: nine of them accumulated over a
    // session's worth of runs, because each spawns a server and only the
    // wrapper died.
    try {
      if (p.pid) process.kill(-p.pid, 'SIGKILL');
    } catch {}
    try {
      p.kill('SIGKILL');
    } catch {}
  }
  for (const s of servers) {
    try {
      s.close();
    } catch {}
  }
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {}
}
process.on('exit', cleanup);
// 'exit' alone is not enough on two counts: it never fires for a signal, and
// it cannot fire while the CDP socket and the static server hold the loop
// open — which is why a finished recording used to sit there having already
// written the GIF.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
  process.on(sig, () => {
    cleanup();
    process.exit(1);
  });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── the sandbox ───────────────────────────────────────────────────────────
// HOME is redirected wholesale rather than variable by variable. The engine
// derives ~/.config/opencode, the Claude and Codex config paths and the skill
// directories from it, and overriding them one at a time is how a recording
// ends up with somebody's real toolchain in three of five panels.
const home = join(work, 'home');
const cfgDir = join(home, '.config', 'opencode');
mkdirSync(cfgDir, { recursive: true });
const configPath = join(cfgDir, 'opencode.json');
writeFileSync(configPath, JSON.stringify(FIXTURE, null, 2));
writeFileSync(join(cfgDir, 'infrastructure.json'), '{}');
const dbPath = join(work, 'graph.db');

const SANDBOX = {
  ...process.env,
  HOME: home,
  AMBIT_DB: dbPath,
  OPENCODE_CONFIG: configPath,
  INFRA_MANIFEST: join(cfgDir, 'infrastructure.json'),
  AMBIT_APPROVAL_KEY: 'hero-recording-key',
};

// `node` on PATH may be a version-manager shim that needs an environment this
// script has already replaced, so the real binary is invoked directly.
const NODE = process.execPath;
const engine = (args: string[]) =>
  execFileSync(NODE, ['--experimental-sqlite', join(ROOT, 'src', 'engine', 'engine.ts'), ...args], {
    env: SANDBOX,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

async function freePort(): Promise<number> {
  return new Promise(resolve => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as any).port;
      s.close(() => resolve(p));
    });
  });
}

// ── a minimal CDP client ──────────────────────────────────────────────────
class Cdp {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

  static async attach(port: number): Promise<Cdp> {
    let target: any = null;
    for (let i = 0; i < 50 && !target; i++) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[];
        target = list.find(t => t.type === 'page');
      } catch {}
      if (!target) await sleep(200);
    }
    if (!target) throw new Error('Chrome never exposed a page target');
    const c = new Cdp();
    c.ws = new WebSocket(target.webSocketDebuggerUrl);
    c.ws.addEventListener('message', (ev: any) => {
      const msg = JSON.parse(ev.data);
      const p = c.pending.get(msg.id);
      if (!p) return;
      c.pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    });
    await new Promise<void>((res, rej) => {
      c.ws.addEventListener('open', () => res());
      c.ws.addEventListener('error', () => rej(new Error('CDP socket failed')));
    });
    return c;
  }

  /**
   * Every request is bounded. Without this a call that never comes back — a
   * detached target, a page that stops producing frames — hangs the recording
   * forever with no indication of where, which is exactly what it did.
   */
  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const done = (fn: (v: any) => void) => (v: any) => {
        clearTimeout(timer);
        fn(v);
      };
      this.pending.set(id, { resolve: done(resolve), reject: done(reject) });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression: string): Promise<any> {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      // exceptionDetails.text is only ever "Uncaught"; the thrown message —
      // which is where a step reports what it could not find — is on the
      // exception object itself.
      const d = r.exceptionDetails;
      const msg = d.exception?.description || d.exception?.value || d.text;
      throw new Error(msg);
    }
    return r.result?.value;
  }

  /**
   * A real mouse click at the element's centre. Dispatching a synthetic
   * MouseEvent left the SVG nodes unselected; driving the input pipeline is
   * both closer to what is being demonstrated and less fragile.
   */
  async clickAt(x: number, y: number): Promise<void> {
    for (const type of ['mousePressed', 'mouseReleased'])
      await this.send('Input.dispatchMouseEvent', {
        type,
        x: Math.round(x),
        y: Math.round(y),
        button: 'left',
        clickCount: 1,
      });
  }

  /**
   * Resolve an element to a viewport point and click it. Finding and clicking
   * are one call on purpose: marking a node and clicking it in a second call
   * loses the mark, because React re-renders in between and the attribute goes
   * with the discarded element.
   */
  async clickWhere(finder: string): Promise<string> {
    const box = await this.eval(`(() => {
      const el = (${finder});
      if (!el) throw new Error('nothing matched: ' + ${JSON.stringify(finder.slice(0, 120))});
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) throw new Error('matched an element with no box');
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 60) };
    })()`);
    await this.clickAt(box.x, box.y);
    return box.label;
  }

  async shot(): Promise<Buffer> {
    const r = await this.send('Page.captureScreenshot', { format: 'png' }, 30_000);
    return Buffer.from(r.data, 'base64');
  }
}

// Finding by visible text: class names are styling and move around, but the
// words on the controls are the product's own vocabulary.
const byText = (sel: string, text: string) => `(() => {
  const want = ${JSON.stringify(text.toLowerCase())};
  const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
  const label = e => e.textContent.trim().toLowerCase();
  // Prefix first, then containment: several controls carry a decorative glyph
  // ahead of the word (the sidebar toggle renders as "\u25e7Sidebar"), and a
  // strict prefix match rejects them for a character that is not part of the
  // product's vocabulary. Ambiguity is still reported rather than guessed at.
  const hits = els.filter(e => label(e).startsWith(want));
  const found = hits.length ? hits : els.filter(e => label(e).includes(want));
  if (found.length > 1)
    throw new Error('${sel} "' + ${JSON.stringify(text)} + '" is ambiguous: ' +
      found.map(e => e.textContent.trim()).join(' | '));
  if (!found.length) throw new Error('no ${sel} matching ' + ${JSON.stringify(text)} +
    '. present: ' + els.map(e => e.textContent.trim()).join(' | '));
  return found[0];
})()`;
const deckTab = (t: string) => byText('.app-deck-tab', t);
const deckBtn = (t: string) => byText('.app-deck-btn', t);

async function main() {
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}; set CHROME_PATH`);
  execSync('ffmpeg -version', { stdio: 'ignore' });

  console.log('Seeding a throwaway graph from the fixture…');
  engine(['seed']);
  const status = JSON.parse(engine(['status', '--json']));
  if (!status.reached || status.reached < 20)
    throw new Error(`fixture graph looks wrong: reached=${status.reached}`);
  console.log(`  ${status.reached}/${status.total} reached`);

  // A drafted proposal so the approvals panel has something real in it.
  engine(['propose', 'local-embeddings']);

  // The attention lens colours a node by how often a person had to step in,
  // read from session_learning. A graph seeded an instant ago has no such
  // history, so the lens rendered identically to Standard and the beat showed
  // a tab changing and nothing else. These rows are scenario input, the same
  // kind of declared fiction as the fixture config above — the heat map over
  // them is still the engine's own computation.
  const HISTORY: [string, string, number][] = [
    ['combo:local-runtime', 'failed', 9],
    ['combo:secret-management', 'confirm', 24],
    ['combo:continuous-delivery', 'confirm', 14],
    ['combo:browser-automation', 'failed', 6],
    ['combo:data-access', 'intervene', 17],
    ['combo:persistent-memory', 'intervene', 4],
  ];
  execFileSync(
    NODE,
    [
      '--experimental-sqlite',
      '-e',
      `const { DatabaseSync } = require('node:sqlite');
       const db = new DatabaseSync(${JSON.stringify(dbPath)});
       const rows = ${JSON.stringify(HISTORY)};
       const known = new Set(db.prepare('SELECT id FROM capabilities').all().map(r => r.id));
       let wrote = 0;
       const ins = db.prepare("INSERT INTO session_learning (session_id, capability_id, action, outcome_score) VALUES ('scenario', ?, ?, ?)");
       for (const [cap, action, n] of rows) {
         if (!known.has(cap)) continue;
         for (let i = 0; i < n; i++) ins.run(cap, action, action === 'failed' ? 0 : 1);
         wrote++;
       }
       db.close();
       if (!wrote) { console.error('no scenario capability matched the graph'); process.exit(1); }
       console.log(wrote);`,
    ],
    { env: SANDBOX, encoding: 'utf8' }
  );

  console.log('Building the client…');
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' });

  const apiPort = await freePort();
  console.log(`Starting the API on ${apiPort}…`);
  const api = spawn(NODE, ['--experimental-sqlite', join(ROOT, 'server.ts')], {
    env: { ...SANDBOX, AMBIT_API_PORT: String(apiPort) },
    cwd: ROOT,
    stdio: 'ignore',
  });
  procs.push(api);

  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) {
    try {
      ok = (await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok;
    } catch {}
    if (!ok) await sleep(250);
  }
  if (!ok) throw new Error('API never came up');

  // The recording must not be able to reach the real machine's API, so the
  // page is served here with its own proxy rather than through vite preview,
  // whose /api target is the developer's own running server.
  const webPort = await freePort();
  const dist = join(ROOT, 'dist');
  const MIME: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json',
    '.ico': 'image/x-icon',
  };
  const web = createServer(async (req, res) => {
    const u = new URL(req.url!, 'http://x');
    if (u.pathname.startsWith('/api/')) {
      try {
        const r = await fetch(`http://127.0.0.1:${apiPort}${u.pathname}${u.search}`, {
          headers: { origin: `http://127.0.0.1:${webPort}` },
        });
        const b = Buffer.from(await r.arrayBuffer());
        res.writeHead(r.status, {
          'content-type': r.headers.get('content-type') || 'application/json',
        });
        res.end(b);
      } catch (e) {
        res.writeHead(502).end(String(e));
      }
      return;
    }
    let p = u.pathname.replace(/^\/ambit/, '') || '/';
    if (p === '/' || !extname(p)) p = '/index.html';
    try {
      const buf = await readFile(join(dist, normalize(p)));
      res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise<void>(r => web.listen(webPort, '127.0.0.1', () => r()));
  servers.push(web);

  // Proof, not assumption: if a name from the running machine reached the
  // page, the recording is spoiled and must not be written.
  const leakCheck = await (await fetch(`http://127.0.0.1:${webPort}/api/config`)).text();
  const fixtureNames = Object.keys(FIXTURE.mcp);
  if (!fixtureNames.some(n => leakCheck.includes(n)))
    throw new Error('the API is not serving the fixture config — refusing to record');

  console.log('Launching headless Chrome…');
  const profile = mkdtempSync(join(tmpdir(), 'ambit-chrome-'));
  const cdpPort = await freePort();
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      '--hide-scrollbars',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore', detached: true }
  );
  procs.push(chrome);

  const cdp = await Cdp.attach(cdpPort);
  cdpRef = cdp;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const framesDir = join(work, 'frames');
  mkdirSync(framesDir);
  let n = 0;
  const hold = async (seconds: number, label = '') => {
    if (label) console.log(`  · ${label}`);
    const png = await cdp.shot();
    for (let i = 0; i < Math.round(seconds * FPS); i++)
      writeFileSync(join(framesDir, `frame-${String(n++).padStart(4, '0')}.png`), png);
  };

  console.log('Recording…');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${webPort}/ambit/` });
  await sleep(3500);
  // The first-run guide is a teaching aid for a person sitting in front of it,
  // not part of the map, and it covers a third of the canvas.
  await cdp.eval(`try { localStorage.setItem('cg.seenGuide','1') } catch {}; true`);

  // 1 — the whole tech tree, seven eras.
  //
  // Reached by the URL the app already supports for exactly this, rather than
  // by clicking the tab: a click has to land after hydration and before any
  // re-render, and when it silently does not, the recording continues against
  // the config view and produces a picture of the wrong screen. Which is what
  // it did.
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${webPort}/ambit/?view=tree` });
  await sleep(4000);

  // The tab must also read as active, and the tree must actually have loaded.
  // Both are asserted, because either failing means the frames below are of
  // something other than what this GIF claims to show.
  await cdp.eval(`(() => {
    const active = document.querySelector('.app-deck-tab--active');
    if (!active || !active.textContent.trim().toLowerCase().startsWith('tech tree'))
      throw new Error('Tech Tree is not the active tab; active: ' + (active && active.textContent.trim()));
    const combos = [...document.querySelectorAll('g[role="button"][aria-label]')]
      .filter(n => /possibility|combo/i.test(n.getAttribute('aria-label')));
    if (!combos.length)
      throw new Error('the tree rendered no compound capabilities — this is the config view');
    return combos.length;
  })()`);
  await sleep(600);
  // The capability list costs ~280px of canvas, which is the difference
  // between framing seven era columns and cutting off the last two. The tree
  // is what this frame is of, so the list folds away for it and comes back
  // for the steps that read from it.
  // The canvas opens at 100% scrolled to the origin, which puts most of the
  // tree below the fold. Fit is what a person presses first.
  await cdp.clickWhere(`document.querySelector('[aria-label="Fit graph to view"]')`);
  await sleep(1200);

  // Framing is the whole point of this frame, so it is checked — and checked
  // for what actually matters. Counting era labels in the DOM is not the same
  // question: SVG text scrolled past the right edge is still in the document,
  // so a presence check passes on a picture with two columns off-screen. This
  // asks whether each one is inside the viewport, and zooms out until it is.
  const erasInView = () =>
    cdp.eval(`(() => {
      const labels = [...document.querySelectorAll('text')]
        .filter(e => /^Era \\d$/.test(e.textContent.trim()));
      const inside = labels.filter(e => {
        const r = e.getBoundingClientRect();
        return r.left >= 0 && r.right <= window.innerWidth && r.width > 0;
      });
      return { total: labels.length, visible: inside.length };
    })()`);

  for (let i = 0; i < 6; i++) {
    const { total, visible } = await erasInView();
    if (total > 0 && visible === total) break;
    await cdp.clickWhere(`document.querySelector('[aria-label="Zoom out"]')`);
    await sleep(500);
  }
  const eras = await erasInView();
  if (!eras.total || eras.visible !== eras.total)
    throw new Error(`${eras.visible}/${eras.total} era columns are inside the viewport`);
  console.log(`  · ${eras.total} era columns framed`);
  await sleep(400);
  await hold(2.2, 'the whole tree');

  // 2 — one capability, and what hangs off it. Nodes carry role=button and an
  // aria-label of "<name>, <type>", which is a contract the keyboard path
  // depends on too, so it is a safer handle than the rendered glyph.
  // Prefer a reached node: an outage simulation on something that was never
  // reached has no cascade to draw.
  const picked = await cdp.clickWhere(`(() => {
    const nodes = [...document.querySelectorAll('g[role="button"][aria-label]')];
    const want = ['Local Runtime', 'Shell Execution', 'Version Control', 'File Editing'];
    for (const w of want) {
      const n = nodes.find(x => x.getAttribute('aria-label').startsWith(w));
      if (n) return n;
    }
    throw new Error('no candidate node. present: ' +
      nodes.slice(0, 40).map(n => n.getAttribute('aria-label')).join(' | '));
  })()`);
  console.log(`  selected ${picked}`);
  await sleep(1100);
  await hold(1.6, 'one capability selected');

  // 3 — blast radius
  const simmed = await cdp.clickWhere(`(() => {
    const b = [...document.querySelectorAll('.sp-action-btn')]
      .find(e => /simulate (outage|unlocking)/i.test(e.textContent));
    if (!b) throw new Error('no simulate button. panel buttons: ' +
      [...document.querySelectorAll('.sp-action-btn')].map(e => e.textContent.trim()).join(' | ') || '(panel absent)');
    return b;
  })()`);
  console.log(`  ${simmed}`);
  await sleep(1200);
  await hold(2.4, 'blast radius');

  // 4 — back to a clean map
  await cdp.eval(`(() => {
    const b = [...document.querySelectorAll('.sp-action-btn')].find(e => /clear|exit|stop/i.test(e.textContent));
    if (b) b.click();
    const c = document.querySelector('.sp-close'); if (c) c.click();
    return true;
  })()`);
  await sleep(900);

  // 5 — where the human time goes.
  //
  // Only this lens. The SPOF lens decides what to highlight with a substring
  // test on the node id (github / docker / 1password / credential), which the
  // curated tech-tree nodes never match, so on this view it renders exactly
  // like Standard. Recording a beat that shows a tab changing and nothing else
  // is worse than not recording it, and dressing the fixture up to satisfy a
  // string match would be advertising a check the code does not do.
  console.log('  · attention lens');
  await cdp.clickWhere(deckTab('Attention'));
  await sleep(1300);
  await hold(2.4, 'attention lens');
  await cdp.clickWhere(deckTab('Standard'));
  await sleep(900);

  // 6 — the proposal waiting for a person
  console.log('  · proposals');
  await cdp.clickWhere(deckBtn('Proposals'));
  await sleep(1400);
  await hold(2.4);

  console.log(`Assembling ${n} frames…`);
  execSync(
    `ffmpeg -y -loglevel error -framerate ${FPS} -i "${join(framesDir, 'frame-%04d.png')}" ` +
      `-vf "scale=${GIF_WIDTH}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" ` +
      `-loop 0 "${OUT_GIF}"`,
    { stdio: 'inherit' }
  );
  console.log(`Wrote ${OUT_GIF}`);
}

main()
  .then(() => {
    // Explicit: the CDP socket and the static server are still open handles,
    // and waiting for the loop to drain is waiting forever.
    cleanup();
    process.exit(0);
  })
  .catch(async e => {
  console.error('Recording failed:', e.message);
  // A selector that stopped matching is the expected failure as the UI moves,
  // so the state it died in is worth more than the stack: write the frame out
  // where a person can look at it.
  if (cdpRef) {
    try {
      const shot = join(tmpdir(), `ambit-hero-failure-${process.pid}.png`);
      writeFileSync(shot, await cdpRef.shot());
      console.error(`Last frame written to ${shot}`);
    } catch {}
  }
    cleanup();
    process.exit(1);
  });
