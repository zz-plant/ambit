/**
 * The map's key, opened from the controls over the canvas.
 *
 * It was a row of SVG under the last era, which put it below the fold at
 * 1440×900: the one place that says what a stripe or a dashed ring means was
 * the one place a first look never reached. Opened on demand it is always a
 * click away and never in the way. A key that lights nodes is a button; the
 * rest are rows.
 */
import { useRef } from 'react';
import { usePressAway } from '../../hooks/usePressAway';
import { termTitle } from '../Term';
import { KeySwatch, type LegendKey } from './marks';

interface MapKeyProps {
  keys: LegendKey[];
  /** The key whose nodes are lit, if one is. */
  spotlight: string | null;
  /** Whether a key lights nodes when pressed. */
  lights: (label: string) => boolean;
  onSpotlight: (label: string | null) => void;
  /** The glossary entry each key is a picture of. */
  concepts: Record<string, string>;
  hazard: string;
  /** A press anywhere else closes it, except on the button that toggles it. */
  onClose?: () => void;
}

export function MapKey({
  keys,
  spotlight,
  lights,
  onSpotlight,
  concepts,
  hazard,
  onClose,
}: MapKeyProps) {
  const box = useRef<HTMLElement>(null);
  usePressAway(box, onClose, '[data-key-toggle]');
  return (
    <section className="civ-key" aria-label="Key" ref={box}>
      <ul className="civ-key-list">
        {keys.map(entry => {
          if (entry.kind === 'label') {
            return (
              <li key={entry.label} className="civ-key-head">
                {entry.label}
              </li>
            );
          }
          const on = spotlight === entry.label;
          const picture = (
            <svg width={20} height={20} viewBox="-10 -10 20 20" aria-hidden="true">
              <KeySwatch entry={entry} hazard={hazard} />
            </svg>
          );
          const title = termTitle(concepts[entry.label] ?? '');
          return (
            <li key={entry.label}>
              {lights(entry.label) ? (
                <button
                  type="button"
                  className={`civ-key-row civ-key-row--button${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  title={title}
                  onClick={() => onSpotlight(on ? null : entry.label)}
                >
                  {picture}
                  {entry.label}
                </button>
              ) : (
                <span className="civ-key-row" title={title}>
                  {picture}
                  {entry.label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="civ-key-hint">Press a key to light its nodes. Esc shows everything.</p>
    </section>
  );
}
