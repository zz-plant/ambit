/**
 * The three faces the page sets, served from this origin, latin only.
 *
 * Hubot Sans is the readout: titles, figures and the short labels a map
 * carries, wide where a number has to be read at a glance and narrow where a
 * label has to fit a column. Its barred zero is the instrument convention, and
 * the reason it is not the text face. Mona Sans, drawn beside it, is the text
 * face; Monaspace Neon, from the same family, sets what a person types.
 *
 * The fontsource stylesheets declare every subset, and Vite bundled all of
 * them, so the faces are declared here from the latin files alone. The share
 * card reads the same list to embed them, since an SVG drawn as an image
 * cannot reach the page's fonts and was always set in a system face.
 */
import hubot from '@fontsource-variable/hubot-sans/files/hubot-sans-latin-wdth-normal.woff2?url';
import mona from '@fontsource-variable/mona-sans/files/mona-sans-latin-wght-normal.woff2?url';
import neon400 from '@fontsource/monaspace-neon/files/monaspace-neon-latin-400-normal.woff2?url';
import neon500 from '@fontsource/monaspace-neon/files/monaspace-neon-latin-500-normal.woff2?url';

export interface Face {
  family: string;
  url: string;
  weight: string;
  stretch?: string;
}

export const FACES: Face[] = [
  { family: 'Hubot Sans', url: hubot, weight: '200 900', stretch: '75% 125%' },
  { family: 'Mona Sans', url: mona, weight: '200 900' },
  { family: 'Monaspace Neon', url: neon400, weight: '400' },
  { family: 'Monaspace Neon', url: neon500, weight: '500' },
];

/** Adds the faces to the document and starts loading them, before the first render. */
export function installFonts(): void {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  for (const f of FACES) {
    const face = new FontFace(f.family, `url(${f.url}) format('woff2')`, {
      weight: f.weight,
      stretch: f.stretch ?? 'normal',
      display: 'swap',
    });
    document.fonts.add(face);
    face.load().catch(() => {
      /* a face that fails to load falls back to the stack's next family */
    });
  }
}

/**
 * The same faces as `@font-face` rules with the files inlined, for a document
 * that cannot fetch them: the share card, drawn as an image.
 */
export async function embeddedFontCss(faces: Face[] = FACES): Promise<string> {
  const rules = await Promise.all(
    faces.map(async f => {
      const bytes = new Uint8Array(await (await fetch(f.url)).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const stretch = f.stretch ? `font-stretch:${f.stretch};` : '';
      return `@font-face{font-family:'${f.family}';font-weight:${f.weight};${stretch}src:url(data:font/woff2;base64,${btoa(binary)}) format('woff2')}`;
    })
  );
  return rules.join('');
}
