/**
 * The loadout, leg by leg: where this setup stands on the way from a pile of
 * configs to doing a class of work without you. The list below it is the
 * loadout's pieces; this is what they add up to, and the one move on each leg.
 *
 * The page says it in plain words. "Your loadout, leg by leg" and "From A to
 * B" were the docs' framing used as labels, and a reader who had not read the
 * docs met three words nothing on the page explained. The framing stays in
 * the document the link opens.
 *
 * Every sentence is read from the graph and the ledger, and a leg nothing has
 * recorded says so. A command is copied, never run.
 */
import { useEffect } from 'react';
import { useCopied } from '../hooks/useCopied';
import { useAmbitStore } from '../store/ambitStore';
import { type LegState, journeyLegs } from '../utils/journey';
import { isEntry, isProven } from './civ/layout';

const MARK: Record<LegState, string> = { done: '✓', open: '›', unrecorded: '·' };
const WORD: Record<LegState, string> = {
  done: 'under way',
  open: 'next',
  unrecorded: 'not recorded',
};

const DOCS = `${import.meta.env.BASE_URL}docs/loadout/`;

export function Journey() {
  const items = useAmbitStore(s => s.items);
  const loop = useAmbitStore(s => s.loop);
  const loadLoop = useAmbitStore(s => s.loadLoop);
  const proposals = useAmbitStore(s => s.proposals);
  const loadProposals = useAmbitStore(s => s.loadProposals);
  const [copied, copy] = useCopied();

  useEffect(() => {
    if (!loop) loadLoop();
    if (!proposals.length) loadProposals();
  }, [loop, loadLoop, proposals.length, loadProposals]);

  const tree = items.filter(i => !isEntry(i));
  const reached = tree.filter(i => i.status === 'built');
  const fallback = {
    reached: reached.length,
    total: tree.length,
    verified: reached.filter(isProven).length,
  };
  const legs = journeyLegs(loop, proposals, fallback);

  return (
    <section className="journey" aria-labelledby="journey-title">
      <div className="journey-head">
        <h3 id="journey-title">Seven steps to work done without you</h3>
        <a href={DOCS}>What each step means</a>
      </div>
      <p className="journey-sub">
        Where the entries below stand on the way from a pile of configs to a setup that does a class
        of work on its own, with a person only where judgment is needed.
      </p>
      <ol className="journey-legs">
        {legs.map((leg, i) => (
          <li key={leg.key} className={`journey-leg is-${leg.state}`}>
            <span className="journey-n" aria-hidden="true">
              {i + 1}
            </span>
            <span className="journey-body">
              <span className="journey-title">
                {leg.title}
                <span className="journey-state">
                  <span aria-hidden="true">{MARK[leg.state]}</span> {WORD[leg.state]}
                </span>
              </span>
              <span className="journey-said">{leg.said}</span>
            </span>
            {leg.command && (
              <button
                type="button"
                className="journey-cmd"
                onClick={() => copy(leg.key, leg.command as string)}
                title="Copy the command; the page never runs it"
              >
                <code>{leg.command}</code>
                <span>{copied === leg.key ? 'Copied ✓' : 'Copy'}</span>
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
