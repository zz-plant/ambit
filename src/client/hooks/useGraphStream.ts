import { useEffect } from 'react';
import { backendAvailable } from '../store/ambitStore';
import { useLatest } from './useLatest';

interface StreamHandlers {
  /** The graph underneath changed; refetch whichever view is showing. */
  graphChanged: () => void;
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
 */
export function useGraphStream(handlers: StreamHandlers) {
  const latest = useLatest(handlers);
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
      let last = '';
      es.onmessage = e => {
        try {
          const event = JSON.parse(e.data);
          if (event.type === 'ProposalApproved') {
            latest.current.proposalApproved(event.proposalId);
            return;
          }
          if (event.type === 'WorkEvent') return; // telemetry, not a view change
          if (event.type !== 'StateSnapshot' && event.type !== 'StateDelta') return;
          const fingerprint =
            event.type === 'StateDelta'
              ? 'delta:' + JSON.stringify(event.delta)
              : JSON.stringify(event.snapshot);
          if (last && fingerprint !== last) latest.current.graphChanged();
          last = fingerprint;
        } catch {
          /* a malformed frame should not take the view down */
        }
      };
      // Deliberately no onerror handler that closes: EventSource reconnects on
      // its own, and closing on the first transient error disabled live updates
      // permanently for the rest of the session.
    });
    return () => {
      cancelled = true;
      es?.close();
    };
  }, [latest]);
}
