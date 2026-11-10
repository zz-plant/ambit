/**
 * Where an outage's playhead stands: which hop of the cascade the map has
 * drawn up to, and whether it is advancing by itself.
 *
 * An outage started while the map is on screen starts at the capability that
 * went down and plays outward, a hop at a time, then rests on the whole cascade. Dragging the track or
 * stepping it stops the play where it is. Under reduced motion there is no
 * play: the playhead starts at the end, which is the still the map drew
 * before it could be scrubbed, and the track steps it by hand.
 */
import { useCallback, useEffect, useState } from 'react';

/** The longest a whole cascade plays for, so a deep one does not outstay a shallow one by seconds. */
const PLAY_MS = 1400;
/** One hop at most: long enough for the front to cross an edge and the node to land. */
const HOP_MS = 440;

const calm = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface OutagePlayhead {
  hop: number;
  playing: boolean;
  /** Move the playhead by hand, which ends the play. */
  scrub: (hop: number) => void;
  /** Play from here, or from the start when it is at the end; false pauses. */
  play: (on: boolean) => void;
}

/**
 * `outage` names the running outage (null when none runs) and `last` is its
 * final hop. The state is keyed on the name and reset while rendering, so the
 * first frame of a new outage never shows the last one's playhead.
 */
export function useOutagePlayhead(outage: string | null, last: number): OutagePlayhead {
  const fresh = useCallback(
    () => ({ outage, hop: calm() ? last : 0, playing: outage !== null && last > 0 && !calm() }),
    [outage, last]
  );
  // An outage already running when the map is first drawn is drawn whole:
  // coming back to the map from another view does not replay it, and a
  // server render, which runs no timer, draws all of it.
  const [state, setState] = useState(() => ({ outage, hop: last, playing: false }));
  if (state.outage !== outage) setState(fresh());
  const current = state.outage === outage ? state : fresh();
  const hop = Math.min(current.hop, last);
  const playing = current.playing && hop < last;

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(
      () => setState(s => (s.outage === outage ? { ...s, hop: Math.min(last, hop + 1) } : s)),
      Math.min(HOP_MS, PLAY_MS / last)
    );
    return () => clearTimeout(timer);
  }, [playing, hop, outage, last]);

  const scrub = useCallback(
    (to: number) => setState({ outage, hop: Math.max(0, Math.min(last, to)), playing: false }),
    [outage, last]
  );
  const play = useCallback(
    (on: boolean) =>
      setState(s => ({
        outage,
        hop: on && Math.min(s.hop, last) >= last ? 0 : Math.min(s.hop, last),
        playing: on,
      })),
    [outage, last]
  );
  return { hop, playing, scrub, play };
}
