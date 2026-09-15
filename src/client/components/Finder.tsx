import { useEffect, useMemo, useRef, useState } from 'react';
import { useAmbitStore } from '../store/ambitStore';
import type { Item } from '../utils/configImporter';
import { statusLabel, typeLabel } from '../utils/labels';
import { typeColor, typeSymbol } from '../utils/typeColors';
import { isEntry } from './civ/layout';

/**
 * Find a capability by name and go to it.
 *
 * The docked list this replaces was a third of the window, open by default,
 * listing what the map already drew. The one thing it added was search, and a
 * search wants a box that appears when asked and goes away when done, not a
 * panel. Results are split by where a match lives: a node of the tree opens
 * on the map, an entry of the machine opens in My Setup.
 */
interface FinderProps {
  open: boolean;
  onClose: () => void;
  onShow: (id: string) => void;
}

const LIMIT = 12;

export default function Finder({ open, onClose, onShow }: FinderProps) {
  const items = useAmbitStore(s => s.items);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    // After the overlay has mounted, so the first keystroke lands in the box.
    const t = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const scored = items
      .map(item => {
        const name = item.name.toLowerCase();
        const score = !q
          ? 1
          : name.startsWith(q)
            ? 3
            : name.includes(q)
              ? 2
              : item.id.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q)
                ? 1
                : 0;
        return { item, score };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
    const nodes = scored.filter(r => !isEntry(r.item)).map(r => r.item);
    const entries = scored.filter(r => isEntry(r.item)).map(r => r.item);
    return [...nodes.slice(0, LIMIT), ...entries.slice(0, LIMIT)];
  }, [items, query]);

  if (!open) return null;

  const choose = (item: Item) => {
    onShow(item.id);
    onClose();
  };

  const groupOf = (item: Item) => (isEntry(item) ? 'In your setup' : 'On the map');

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a click on the backdrop closes the finder; Escape does the same from the keyboard
    <div className="finder-overlay" onClick={onClose} role="presentation">
      <div
        className="finder"
        role="dialog"
        aria-modal="true"
        aria-label="Find a capability"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(a => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(a => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (results[active]) choose(results[active]);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <input
          ref={input}
          className="finder-input"
          placeholder="Find a capability, a server, an agent…"
          aria-label="Find a capability"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
        <ul className="finder-list">
          {results.map((item, i) => {
            const firstOfGroup = i === 0 || groupOf(results[i - 1]) !== groupOf(item);
            return (
              <li key={item.id}>
                {firstOfGroup && <div className="finder-group">{groupOf(item)}</div>}
                <button
                  type="button"
                  aria-current={i === active ? 'true' : undefined}
                  className={`finder-item ${i === active ? 'is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(item)}
                >
                  <span
                    className="finder-item-glyph"
                    style={{ color: typeColor(item.type) }}
                    aria-hidden="true"
                  >
                    {typeSymbol(item.type)}
                  </span>
                  <span className="finder-item-name">{item.name}</span>
                  <span className="finder-item-meta">
                    {typeLabel(item.type)} · {statusLabel(item.status, item)}
                  </span>
                </button>
              </li>
            );
          })}
          {results.length === 0 && <li className="finder-empty">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  );
}
