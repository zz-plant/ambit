import { useState } from 'react';
import type { AuditEvent, AuditOutcome } from '../../shared/api';
import { useAmbitStore } from '../store/ambitStore';
import { matchesAudit, parseAuditQuery } from '../utils/auditQuery';
import { NUM } from './figures';

/**
 * The trail: who approved what, what ran, and what came of it, one line per
 * event, newest first.
 *
 * The engine had every piece of it and the page had none: `ambit audit` was
 * the only reader, and it answered as three lists capped on their own, with
 * the delegation record in none of them. The engine merges the four sources
 * now, and this draws the result with a query bar over it.
 */

/** The shape beside each outcome word, so a result is never told by colour alone. */
const SHAPE: Record<AuditOutcome['tone'], string> = { good: '✓', bad: '✕', neutral: '•' };

/** A line's time in the reader's own zone. A time that will not read is left out. */
function when(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function Outcome({ outcome }: { outcome: AuditOutcome }) {
  return (
    <span className={`audit-outcome audit-outcome--${outcome.tone}`}>
      <span className="audit-outcome-shape" aria-hidden="true">
        {SHAPE[outcome.tone]}
      </span>
      {outcome.word}
    </span>
  );
}

/**
 * The lines a query leaves. An event with no recorded outcome draws no
 * outcome at all, and no empty cell stands in for one: the line simply ends
 * sooner.
 */
export function AuditTrail({ events, query }: { events: AuditEvent[]; query: string }) {
  const parsed = parseAuditQuery(query);
  const shown = events.filter(e => matchesAudit(e, parsed));
  if (!shown.length) {
    return <p className="audit-empty">Nothing on the trail matches that.</p>;
  }
  return (
    <ol className="audit-list">
      {shown.map(e => {
        const time = when(e.at);
        return (
          <li key={e.id} className="audit-row">
            {time && (
              <time className="audit-time" dateTime={e.at} style={NUM}>
                {time}
              </time>
            )}
            <span className="audit-what">
              {e.actor && <code className="audit-actor">{e.actor}</code>}
              <span className="audit-action">{e.action}</span>
              {e.target && <code className="audit-target">{e.target}</code>}
            </span>
            {e.summary && <span className="audit-summary">{e.summary}</span>}
            {e.outcome && <Outcome outcome={e.outcome} />}
          </li>
        );
      })}
    </ol>
  );
}

export default function AuditView() {
  const audit = useAmbitStore(s => s.audit);
  const demo = useAmbitStore(s => s.demo);
  const backend = useAmbitStore(s => s.backend);
  const [query, setQuery] = useState('');

  const shownCount = audit
    ? audit.events.filter(e => matchesAudit(e, parseAuditQuery(query))).length
    : 0;

  return (
    <div className="audit-view">
      <div className="audit-inner">
        <h2 className="audit-title">Audit</h2>
        <p className="audit-sub">
          Who approved what, what ran, and what came of it, one line per event, newest first.
          {demo && ' This is sample data.'}
        </p>

        {!audit ? (
          <p className="audit-empty">
            {backend === 'static' && !demo
              ? 'The trail is read from the ledger on this machine, and no engine is answering here.'
              : 'Reading the trail…'}
          </p>
        ) : audit.events.length === 0 ? (
          <p className="audit-empty">
            Nothing recorded in the last {audit.days} days. Approving or turning down a proposal,
            running <code>ambit verify</code>, and the telemetry bridges all write here.
          </p>
        ) : (
          <>
            <div className="audit-query">
              <label className="visually-hidden" htmlFor="audit-query">
                Filter the trail
              </label>
              <input
                id="audit-query"
                type="search"
                className="tp-search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="actor:human:web action:approved target:prop-…"
                spellCheck={false}
                autoComplete="off"
              />
              <p className="audit-hint">
                <code>actor:</code>, <code>action:</code> and <code>target:</code> match an id
                exactly, colons and all. Any other word is looked for in every field.
              </p>
            </div>
            <p className="audit-count" style={NUM}>
              {query.trim()
                ? `${shownCount} of ${audit.events.length} events`
                : `${audit.events.length} ${audit.events.length === 1 ? 'event' : 'events'}`}{' '}
              in the last {audit.days} days
              {audit.truncated &&
                `. The window held more than ${audit.limit}; the oldest are not shown.`}
            </p>
            <AuditTrail events={audit.events} query={query} />
          </>
        )}
      </div>
    </div>
  );
}
