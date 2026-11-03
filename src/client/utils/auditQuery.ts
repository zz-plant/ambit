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

/** Whether a value can be a qualifier's: the bar splits terms on spaces, so one with a space cannot. */
export const canQualify = (value: string) => value !== '' && !/\s/.test(value);

/** Whether the query already narrows `key` to exactly `value`. */
export function narrowsTo(input: string, key: Qualifier, value: string): boolean {
  const v = value.toLowerCase();
  return parseAuditQuery(input).qualified.some(q => q.key === key && q.value === v);
}

/**
 * The query after a press on a line's actor, action or target. A press adds
 * that qualifier in place of any other for the same field, since a line has
 * one actor and two would match nothing; a press on the one already there
 * takes it out. Every other term is kept as it was typed.
 */
export function toggleQualifier(input: string, key: Qualifier, value: string): string {
  const on = narrowsTo(input, key, value);
  const kept = input
    .split(/\s+/)
    .filter(Boolean)
    .filter(term => {
      const colon = term.indexOf(':');
      return !(colon > 0 && term.slice(0, colon).toLowerCase() === key);
    });
  return (on ? kept : [...kept, `${key}:${value}`]).join(' ');
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
