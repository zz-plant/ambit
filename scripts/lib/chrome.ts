/**
 * Headless Chrome, driven over the DevTools Protocol, for the scripts that
 * draw the real client: the hero recording and the saved images. One client
 * and one launch, so a fix to either reaches both.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:http';

export const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A port nothing on loopback holds, for a server or a debugger to take. */
export async function freePort(): Promise<number> {
  return new Promise(resolve => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as any).port;
      s.close(() => resolve(p));
    });
  });
}

/**
 * Chrome with no window, a profile of its own, and the debugger on `port`.
 * Its own background traffic is switched off (update checks, field trials,
 * sync, safe-browsing lists), so the only requests it makes are the pages it
 * is sent to. Detached, so the caller can kill its whole process group.
 */
export function launchChrome(
  port: number,
  profile: string,
  size: { width: number; height: number }
): ChildProcess {
  return spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${size.width},${size.height}`,
      '--hide-scrollbars',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-field-trial-config',
      '--safebrowsing-disable-auto-update',
      'about:blank',
    ],
    { stdio: 'ignore', detached: true }
  );
}

/** A minimal Chrome DevTools Protocol client: one page target, bounded requests. */
export class Cdp {
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
