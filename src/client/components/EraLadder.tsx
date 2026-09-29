import { useAmbitStore } from '../store/ambitStore';
import { statusLabel } from '../utils/labels';
import { type EraLadder, eraLadder, readableSeconds, type Rung } from './civ/layout';
import { Term } from './Term';

/**
 * The words a rung's state is called. Reached, next step and blocked are the
 * glossary's, as the header and the legend say them; failing is the legend's
 * word for a reached node whose check failed.
 */
const stateWord = (row: Rung): string =>
  row.state === 'failing' ? 'Failing' : statusLabel(row.item.status, row.item);

/**
 * An era as a ladder: how far up it you are, then one rung per node saying
 * either that it is reached, or what it takes. No hooks, so the wiring can be
 * tested by calling it.
 *
 * Everything here comes from `eraLadder`, the same arithmetic the era header
 * on the map draws, so the count up top and the rungs below cannot disagree.
 * A rung with no setup estimate shows none: the tree records zero for a node
 * nobody has priced, and zero minutes would be a claim.
 */
export function EraLadderView({
  ladder,
  onShow,
  onClose,
}: {
  ladder: EraLadder;
  /** Open a rung where it lives: the node's own panel, on the map. */
  onShow: (id: string) => void;
  onClose: () => void;
}) {
  const { era, progress: p, rows } = ladder;
  const left = readableSeconds(p.seconds);
  const pct = (n: number) => `${p.total ? (n / p.total) * 100 : 0}%`;
  const facts = [
    `${p.reached} of ${p.total} reached`,
    p.failing ? `${p.failing} failing` : '',
    p.next ? `${p.next} next ${p.next === 1 ? 'step' : 'steps'}` : '',
    left ? `about ${left} of setup left` : '',
  ].filter(Boolean);
  // The fallback name is "Era N", which the line under it would only repeat.
  const named = ladder.name !== `Era ${era}`;

  return (
    <div className="star-panel">
      <div className="sp-grab-bar" aria-hidden="true" />
      <div className="sp-hdr">
        <div className="sp-title-group">
          <div className="sp-designation">{ladder.name}</div>
          {named && (
            <div className="sp-class">
              <Term name="era">Era {era}</Term>
            </div>
          )}
        </div>
        <button type="button" className="sp-close" onClick={onClose} aria-label="Close the ladder">
          ✕
        </button>
      </div>

      <div className="sp-ladder-bar" role="img" aria-label={facts.join(', ')}>
        {p.reached > 0 && (
          <span
            className="sp-ladder-seg sp-ladder-seg--reached"
            style={{ width: pct(p.reached) }}
          />
        )}
        {p.failing > 0 && (
          <span
            className="sp-ladder-seg sp-ladder-seg--failing"
            style={{ width: pct(p.failing) }}
          />
        )}
        {p.next > 0 && (
          <span className="sp-ladder-seg sp-ladder-seg--next" style={{ width: pct(p.next) }} />
        )}
      </div>
      <p className="sp-ladder-facts">{facts.join(' · ')}</p>

      <ol className="sp-ladder" aria-label={`${ladder.name}, one rung per node`}>
        {rows.map(row => (
          <li key={row.item.id}>
            <button
              type="button"
              className={`sp-rung sp-rung--${row.state}`}
              onClick={() => onShow(row.item.id)}
            >
              <span className="sp-rung-mark" aria-hidden="true">
                {row.state === 'failing' ? '!' : ''}
              </span>
              <span className="sp-rung-name">{row.item.name}</span>
              <span className="sp-rung-state">
                {stateWord(row)}
                {row.estimate ? ` · ${row.estimate}` : ''}
              </span>
              {row.detail && <span className="sp-rung-detail">{row.detail}</span>}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The ladder for one era, read from the graph in the store. */
export function EraLadderPanel({ era, onShow }: { era: number; onShow: (id: string) => void }) {
  const items = useAmbitStore(s => s.items);
  const connections = useAmbitStore(s => s.connections);
  const selectEra = useAmbitStore(s => s.selectEra);
  const ladder = eraLadder(items, connections, era);
  if (!ladder) return null;
  return <EraLadderView ladder={ladder} onShow={onShow} onClose={() => selectEra(null)} />;
}

export default EraLadderPanel;
