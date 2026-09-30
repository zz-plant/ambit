/**
 * Who an actor id names, as far as its id says: a person, an agent, a
 * machine, or Ambit itself. Pure, so the mark each surface draws is decided
 * once and tested without a DOM.
 *
 * An id this does not recognise has no kind, and a surface draws no mark for
 * it: a guessed avatar is an identity nobody declared.
 */
export type ActorKind = 'person' | 'agent' | 'machine' | 'system';

export function actorKind(id: string | undefined | null): ActorKind | null {
  if (!id) return null;
  if (id.startsWith('human:')) return 'person';
  if (id === 'agent' || id.startsWith('agent:')) return 'agent';
  if (id.startsWith('device:') || id.startsWith('service:')) return 'machine';
  if (id === 'ambit') return 'system';
  return null;
}

/** The person at this page, whichever id the recorder gave them. */
const YOU = new Set(['human:web', 'human:you']);

/** One or two letters for the mark: the initials of what follows the prefix. */
export function monogram(id: string): string {
  if (YOU.has(id)) return 'Y';
  if (id === 'ambit') return 'A';
  if (id === 'agent') return 'Ag';
  const name = id.slice(id.indexOf(':') + 1);
  const words = name.split(/[-_.\s]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2);
  return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
}

/** How a mark is read aloud: the id's name, and "you" for the person here. */
export function actorLabel(id: string): string {
  if (YOU.has(id)) return 'you';
  if (id === 'agent') return 'the agent';
  if (id === 'ambit') return 'Ambit';
  return id.slice(id.indexOf(':') + 1) || id;
}
