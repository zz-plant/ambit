/**
 * What the map's Image button offers, opened where the key opens.
 *
 * The card is the finding, cut to a post's shape. The whole map is every era,
 * node and edge as a file, whatever is on screen: a vector to print or edit,
 * or a PNG at twice the map's size. The relief is the same map with no names,
 * what is reached raised as ground and lit: a picture to keep, not to read.
 */
import { type KeyboardEvent, useEffect, useRef } from 'react';
import { usePressAway } from '../../hooks/usePressAway';

export type ImageKind = 'card' | 'svg' | 'png' | 'relief';

/** Each choice: what it saves, the file it saves it as, and what hovering it says. */
export const IMAGE_CHOICES: readonly (readonly [ImageKind, string, string, string])[] = [
  ['card', 'The finding, as a card', 'PNG', "The map's one sentence, sized for a post"],
  ['svg', 'The whole map', 'SVG', 'Every era, node and edge, to print or edit'],
  ['png', 'The whole map', 'PNG, 2×', 'Every era, node and edge, at twice the size'],
  [
    'relief',
    'Your reach, in relief',
    'PNG, 2×',
    'What you have reached raised as ground and lit, with no names on it',
  ],
];

export function ImageMenu({
  onSave,
  onClose,
}: {
  onSave: (kind: ImageKind) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLElement>(null);
  usePressAway(box, onClose, '[data-image-toggle]');
  useEffect(() => {
    box.current?.querySelector('button')?.focus();
  }, []);
  // Escape closes the choices and nothing else: the shell's Escape would also
  // clear a selection or a simulation, which the file was about to draw.
  const closeOnEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onClose();
    document.querySelector<HTMLElement>('[data-image-toggle]')?.focus();
  };
  return (
    <section className="civ-key" aria-label="Save an image" ref={box}>
      <ul className="civ-key-list">
        {IMAGE_CHOICES.map(([kind, what, format, hint]) => (
          <li key={kind}>
            <button
              type="button"
              className="civ-key-row civ-key-row--button"
              title={hint}
              onKeyDown={closeOnEscape}
              onClick={() => {
                onClose();
                onSave(kind);
              }}
            >
              {/* The space is for a screen reader: the row lays the two apart. */}
              {what} <span className="civ-key-note">{format}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
