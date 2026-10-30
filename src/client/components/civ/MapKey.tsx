/**
 * The map's key, opened from the controls over the canvas.
 *
 * It was a row of SVG under the last era, which put it below the fold at
 * 1440×900: the one place that says what a stripe or a dashed ring means was
 * the one place a first look never reached. Opened on demand it is always a
 * click away and never in the way. A key that lights nodes is a button; the
 * rest are rows.
 */
import { type PointerEvent, type Ref, useRef, useState } from 'react';
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

export function MapKey({ onClose, ...props }: MapKeyProps) {
  const box = useRef<HTMLElement>(null);
  const [explained, setExplained] = useState<string | null>(null);
  usePressAway(box, onClose, '[data-key-toggle]');
  return <MapKeyView {...props} explained={explained} onExplain={setExplained} boxRef={box} />;
}

const AT_REST = 'Press a key to light its nodes. Esc shows everything.';

interface MapKeyViewProps extends Omit<MapKeyProps, 'onClose'> {
  /** The entry whose meaning the last line says, if one is focused or pressed. */
  explained: string | null;
  onExplain: (label: string | null) => void;
  boxRef?: Ref<HTMLElement>;
}

/**
 * The key as drawn. An entry's meaning was a `title` only, which a touch
 * screen never shows: focused, pressed or pointed at, the entry says it in
 * the key's last line instead, in the place the line at rest takes, so the
 * key is no taller until someone asks.
 */
export function MapKeyView({
  keys,
  spotlight,
  lights,
  onSpotlight,
  concepts,
  hazard,
  explained,
  onExplain,
  boxRef,
}: MapKeyViewProps) {
  const meaning = (entry: LegendKey) => entry.hint ?? termTitle(concepts[entry.label] ?? '');
  const shown = keys.find(k => k.kind !== 'label' && k.label === explained);
  const said = shown && meaning(shown);
  const explain = (label: string) => ({
    onFocus: () => onExplain(label),
    onPointerDown: () => onExplain(label),
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') onExplain(label);
    },
    // A finger lifts before it leaves, so only a mouse takes the line back.
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') onExplain(null);
    },
    onBlur: () => onExplain(null),
  });
  return (
    <section className="civ-key" aria-label="Key" ref={boxRef}>
      {/* What this view is, for the half of the distinction the deck's tab
          titles carry only on hover: the map is the curated tree, and My
          Setup is what this machine declares. */}
      <p className="civ-key-lead">
        The tree of what agent setups grow into, with your position on it. My Setup lists what your
        configs declare.
      </p>
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
          return (
            <li key={entry.label}>
              {lights(entry.label) ? (
                <button
                  type="button"
                  className={`civ-key-row civ-key-row--button${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  aria-describedby={explained === entry.label ? 'civ-key-said' : undefined}
                  onClick={() => onSpotlight(on ? null : entry.label)}
                  {...explain(entry.label)}
                >
                  {picture}
                  {entry.label}
                </button>
              ) : (
                <span className="civ-key-row" {...explain(entry.label)}>
                  {picture}
                  {entry.label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {/* The line at rest stays, unseen, under what an entry says: it keeps
          the key's width, and what is said wraps inside it. */}
      <p className={`civ-key-hint${said ? ' is-saying' : ''}`} aria-live="polite">
        <span className="civ-key-at-rest">{AT_REST}</span>
        {said && (
          <span id="civ-key-said" className="civ-key-said">
            {said}
          </span>
        )}
      </p>
    </section>
  );
}
