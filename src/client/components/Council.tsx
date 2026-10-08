import type { LoopAdvisor, LoopCouncil } from '../../shared/api';
import { useAmbitStore } from '../store/ambitStore';
import { useCopied } from '../hooks/useCopied';
import { Term } from './Term';

/**
 * The council: the step `ambit next` puts first, read five ways.
 *
 * The page below draws each of the engine's questions as its own figure, and a
 * person deciding whether to spend the afternoon on a step had to carry the
 * answer from one figure to the next: the frontier recommends it, fragility
 * knows what it would rest on, the ledger knows whether it has been priced,
 * authority knows what it would be allowed to do, the checks know whether its
 * foundation works. The council puts the five sentences on one step side by
 * side, each with the command behind it, and says when they disagree.
 *
 * A seat speaks and names a command; nothing here runs one. A seat with
 * nothing recorded to read is marked silent and says so, so an empty ledger
 * is never drawn as an opinion.
 */

const SEAT: Record<LoopAdvisor['seat'], string> = {
  science: 'Science',
  defence: 'Defence',
  treasury: 'Treasury',
  justice: 'Justice',
  interior: 'Interior',
};

const STANCE: Record<LoopAdvisor['stance'], string> = {
  for: 'For',
  against: 'Against',
  neutral: 'Neither',
  silent: 'Silent',
};

function names(advisors: LoopAdvisor[], stance: LoopAdvisor['stance']): string {
  const list = advisors.filter(a => a.stance === stance).map(a => SEAT[a.seat]);
  return list.length > 1
    ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
    : list[0] || '';
}

export function CouncilFigure({
  council,
  onShow,
  onShowOnMap,
}: {
  council: LoopCouncil;
  /** Show a node where it lives, with nothing running. */
  onShow?: (id: string) => void;
  /** Show the step on the map, with the unlock simulation running. */
  onShowOnMap?: (id: string) => void;
}) {
  const items = useAmbitStore(s => s.items);
  const [copied, copy] = useCopied();
  const { motion, advisors, split } = council;
  if (!advisors.length) return null;
  const onMap = (id: string) => items.some(i => i.id === id);
  const against = advisors.filter(a => a.stance === 'against').length;

  return (
    <figure className="fig fig--council">
      <figcaption className="fig-caption">
        <span className="fig-caption-title">
          <Term name="council">The council</Term>
        </span>
        <span className="fig-caption-note">
          {motion
            ? `on ${motion.name}, the first step to reach${motion.cost ? ` · ${motion.cost}` : ''}`
            : 'there is no next step, so each seat reads its own ground'}
        </span>
      </figcaption>
      {motion && (
        <p className={`council-verdict${split ? ' is-split' : ''}`}>
          {split ? (
            <>
              <strong>Split.</strong> {names(advisors, 'for')} for, {names(advisors, 'against')}{' '}
              against.
            </>
          ) : against ? (
            <>
              <strong>Against.</strong> {names(advisors, 'against')} would not build on it yet.
            </>
          ) : (
            <>No seat is against it.</>
          )}
        </p>
      )}
      <ul className="council" aria-label="The council's seats">
        {advisors.map(a => {
          const subject = a.subject;
          const isMotion = subject && motion && subject.id === motion.id;
          const show = isMotion ? onShowOnMap : onShow;
          return (
            <li key={a.seat} className={`council-seat is-${a.stance}`}>
              <span className="council-seat-name">
                {SEAT[a.seat]}
                <span className="council-seat-reads">reads {a.reads}</span>
              </span>
              <span className="council-body">
                <span className="council-says">{a.says}</span>
                {a.command && (
                  <button
                    type="button"
                    className="fig-cta fig-cta--quiet"
                    title={a.command}
                    onClick={() => copy(a.seat, a.command as string)}
                  >
                    {copied === a.seat ? 'Copied ✓' : 'Copy the command'}
                  </button>
                )}
              </span>
              <span className="council-side">
                <span className="council-stance">{STANCE[a.stance]}</span>
                {subject && show && onMap(subject.id) && (
                  <button
                    type="button"
                    className="fig-row-btn"
                    onClick={() => show(subject.id)}
                    title={
                      isMotion
                        ? `Show ${subject.name} on the map and simulate unlocking it`
                        : `Show ${subject.name}`
                    }
                  >
                    Map
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
