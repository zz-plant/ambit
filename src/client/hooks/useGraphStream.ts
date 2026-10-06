import { useEffect, useState } from 'react';
import { backendAvailable } from '../store/ambitStore';
import { useLatest } from './useLatest';

interface StreamHandlers {
  /**
   * The graph underneath changed; refetch whichever view is showing. `changed`
   * names the counts that moved (`reached`, `failing`, `drafts` and the rest of
   * the stream's summary), so a new proposal can refresh the badge without
   * announcing a rebuild that did not happen.
   */
  graphChanged: (changed: string[]) => void;
  /** A proposal was approved in the browser broker. */
  proposalApproved: (proposalId: string) => void;
}

/**
 * The AG-UI state stream.
 *
 * The graph is rebuilt by an external process (a seed, an adapter), so the
 * view goes stale with no way to know. StateSnapshot and StateDelta events say
 * when to reload — a delta is RFC 6902 patches against the last snapshot, and
 * either one means the graph changed. The visualiser renders the graph, not
 * the counts, so the patch itself is not applied here. Only the state subset
 * of AG-UI is implemented; see the note on /api/events in src/server/api.ts.
 *
 * Returns whether the stream is connected, which the header shows: a map that
 * silently redraws itself when a seed runs elsewhere is a good surprise the
 * first time and an unexplained one every time after.
 */
export function useGraphStream(handlers: StreamHandlers): { connected: boolean } {
  const latest = useLatest(handlers);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    // A static site (the published demo) has no /api/events; opening the
    // stream there is a 404 that reconnects forever. Only subscribe when a
    // live backend answered the health probe.
    let es: EventSource | null = null;
    let cancelled = false;
    backendAvailable().then(ok => {
      if (!ok || cancelled) return;
      es = new EventSource('/api/events');
      let last: Record<string, unknown> | null = null;
      es.onopen = () => setConnected(true);
      es.onmessage = e => {
        try {
          const event = JSON.parse(e.data);
          if (event.type === 'ProposalApproved') {
            latest.current.proposalApproved(event.proposalId);
            return;
          }
          if (event.type === 'WorkEvent') return; // telemetry, not a view change
          if (event.type === 'StateSnapshot') {
            // The first snapshot is the baseline. A later one arrives when the
            // stream reconnects, and is compared key by key with what came before.
            const next = (event.snapshot ?? {}) as Record<string, unknown>;
            const changed = last
              ? Object.keys({ ...last, ...next }).filter(k => last?.[k] !== next[k])
              : [];
            last = next;
            if (changed.length) latest.current.graphChanged(changed);
            return;
          }
          if (event.type !== 'StateDelta') return;
          const delta = (event.delta ?? []) as { path: string; value: unknown }[];
          const changed = delta.map(op => op.path.replace(/^\//, ''));
          if (last) for (const op of delta) last[op.path.replace(/^\//, '')] = op.value;
          if (changed.length) latest.current.graphChanged(changed);
        } catch {
          /* a malformed frame should not take the view down */
        }
      };
      // The handler reports, and deliberately does not close: EventSource
      // reconnects on its own, and closing on the first transient error
      // disabled live updates permanently for the rest of the session.
      es.onerror = () => setConnected(false);
    });
    return () => {
      cancelled = true;
      setConnected(false);
      es?.close();
    };
  }, [latest]);
  return { connected };
}
