/**
 * The few strings that have to read the same everywhere.
 *
 * The tagline used to live here too, for the landing page. The landing now
 * leads with its question and a sentence naming the runtimes it reads, and a
 * second subtitle under the headline said the same thing less concretely, so
 * the tagline stays where it is quoted from: the README.
 */

/** The one-line install the README leads with, quoted by the landing and the tour. */
export const INSTALL = 'npx ambit-cli';

/**
 * Who an approval from the browser is recorded as. The terminal asks for a
 * name (`ambit approve <id> --by=<who>`); the browser has none to give, so it signs
 * as the web surface and the panel shows that as "you".
 */
export const WEB_ACTOR = 'human:web';

/**
 * Where the product lives, as a screenshot of it should say. A cropped image
 * loses the address bar, so the map and the saved image carry this instead.
 */
export const SITE_HOST = 'zz-plant.github.io/ambit';

/**
 * Copy text to the clipboard with robust fallback.
 * Uses navigator.clipboard.writeText when available in secure contexts,
 * and falls back to a temporary off-screen textarea with document.execCommand('copy')
 * so copy operations never fail in non-secure (HTTP, LAN) or iframe environments.
 */
export async function copyText(text: string): Promise<boolean> {
  const g = globalThis as unknown as {
    navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } };
    document?: {
      createElement: (tag: string) => {
        value: string;
        setAttribute: (k: string, v: string) => void;
        style: Record<string, string>;
        select: () => void;
      };
      body: {
        appendChild: (el: unknown) => void;
        removeChild: (el: unknown) => void;
      };
      execCommand: (cmd: string) => boolean;
    };
  };

  if (g.navigator?.clipboard?.writeText) {
    try {
      await g.navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback on rejection (e.g. permission or non-secure context)
    }
  }

  if (g.document?.createElement && g.document?.body) {
    try {
      const el = g.document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      el.style.top = '-9999px';
      el.style.opacity = '0';
      g.document.body.appendChild(el);
      el.select();
      const ok = g.document.execCommand('copy');
      g.document.body.removeChild(el);
      return Boolean(ok);
    } catch {
      return false;
    }
  }
  return false;
}
