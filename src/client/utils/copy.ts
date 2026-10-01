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
 * name (`ambit approve <id> <who>`); the browser has none to give, so it signs
 * as the web surface and the panel shows that as "you".
 */
export const WEB_ACTOR = 'human:web';

/**
 * Where the product lives, as a screenshot of it should say. A cropped image
 * loses the address bar, so the map and the saved image carry this instead.
 */
export const SITE_HOST = 'zz-plant.github.io/ambit';
