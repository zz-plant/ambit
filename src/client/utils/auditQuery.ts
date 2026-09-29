/**
 * The trail's query bar: `actor:`, `action:` and `target:` qualifiers, and
 * any other text.
 *
 * A term splits on its first colon and no other, because the values have
 * colons of their own: `actor:human:web` names the actor `human:web`, and
 * `target:combo:shell-execution` names a node. A qualifier matches its field
 * exactly, ignoring case. A term that is not one of the three, with a colon
 * or without, is text, and text is looked for in every field a line shows.
 * Every term has to hold.
 */
import type { AuditEvent } from '../../shared/api';

export const QUALIFIERS = ['actor', 'action', 'target'] as const;
export type Qualifier = (typeof QUALIFIERS)[number];

export interface AuditQuery {
  qualified: { key: Qualifier; value: string }[];
  text: string[];
}

const isQualifier = (key: string): key is Qualifier =>
  (QUALIFIERS as readonly string[]).includes(key);

export function parseAuditQuery(input: string): AuditQuery {
  const query: AuditQuery = { qualified: [], text: [] };
  for (const term of input.split(/\s+/).filter(Boolean)) {
    const colon = term.indexOf(':');
    const key = colon > 0 ? term.slice(0, colon).toLowerCase() : '';
    if (!isQualifier(key)) {
      query.text.push(term.toLowerCase());
      continue;
    }
    // `actor:` with nothing after it is a qualifier still being typed, and
    // it narrows nothing until it names something.
    const value = term.slice(colon + 1).toLowerCase();
    if (value) query.qualified.push({ key, value });
  }
  return query;
}

export function matchesAudit(event: AuditEvent, query: AuditQuery): boolean {
  if (!query.qualified.every(q => (event[q.key] ?? '').toLowerCase() === q.value)) return false;
  if (!query.text.length) return true;
  const shown = [event.actor, event.action, event.target, event.summary, event.outcome?.word]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return query.text.every(t => shown.includes(t));
}
