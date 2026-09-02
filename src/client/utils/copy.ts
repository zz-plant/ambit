/**
 * The few strings that have to read the same everywhere.
 *
 * The tagline appeared in six places in six wordings — README, landing page,
 * page title, package description, citation, agent guide. This is the one the
 * README leads with, and the others now quote it.
 */
export const TAGLINE =
  'What you, your agents, and your machines can jointly do — and where your own time is going.';

/**
 * Who an approval from the browser is recorded as. The terminal asks for a
 * name (`ambit approve <id> <who>`); the browser has none to give, so it signs
 * as the web surface and the panel shows that as "you".
 */
export const WEB_ACTOR = 'human:web';
