import { type Ref, useEffect, useMemo, useRef, useState } from 'react';
import { useAmbitStore } from '../store/ambitStore';
import { statusLabel, typeLabel } from '../utils/labels';
import {
  activate,
  buildActions,
  keyStep,
  type PaletteHandlers,
  paletteRows,
  type Row,
} from '../utils/palette';
import { typeColor, typeSymbol } from '../utils/typeColors';
import { isEntry } from './civ/layout';

/**
 * Find a capability by name and go to it, or do something to it.
 *
 * The docked list this replaces was a third of the window, open by default,
 * listing what the map already drew. The one thing it added was search, and a
 * search wants a box that appears when asked and goes away when done, not a
 * panel. Results are split by where a match lives: a node of the tree opens
 * on the map, an entry of the machine opens in My Setup. Beneath them come the
 * actions the query finds, each a verb the page already had a button for.
 */
interface FinderProps {
  open: boolean;
  onClose: () => void;
  onShow: (id: string) => void;
  /** What an action does to the page. Without it the finder only navigates. */
  handlers?: PaletteHandlers;
}

const groupOf = (row: Row) =>
  row.kind === 'action' ? 'Actions' : isEntry(row.item) ? 'In your setup' : 'On the map';

export default function Finder({ open, onClose, onShow, handlers }: FinderProps) {
  const items = useAmbitStore(s => s.items);
  const proposals = useAmbitStore(s => s.proposals);
  const activeLens = useAmbitStore(s => s.activeLens);
  const attention = useAmbitStore(s => s.attentionInterventions);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    // After the overlay has mounted, so the first keystroke lands in the box.
    const t = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // The row the arrow keys are on stays in view. Once the list holds actions
  // as well as nodes it runs past the box, and a highlight nobody can see is
  // a row nobody can choose.
  useEffect(() => {
    list.current?.querySelectorAll('.finder-item')[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  // Only while it is open: the shell re-renders on every hover, and a list
  // nobody is looking at is not worth building each time.
  const actions = useMemo(
    () =>
      open && handlers ? buildActions({ items, proposals, activeLens, attention, handlers }) : [],
    [open, items, proposals, activeLens, attention, handlers]
  );
  const rows = useMemo(
    () => (open ? paletteRows(items, actions, query) : []),
    [open, items, actions, query]
  );

  if (!open) return null;

  return (
    <FinderView
      rows={rows}
      active={active}
      query={query}
      withActions={Boolean(handlers)}
      onQuery={q => {
        setQuery(q);
        setActive(0);
      }}
      onActive={setActive}
      onChoose={row => {
        activate(row, onShow);
        onClose();
      }}
      onClose={onClose}
      inputRef={input}
      listRef={list}
    />
  );
}

interface FinderViewProps {
  rows: Row[];
  /** The row Enter chooses. */
  active: number;
  query: string;
  /** Whether actions are listed beside the nodes, which the box's placeholder says. */
  withActions: boolean;
  onQuery: (query: string) => void;
  onActive: (index: number) => void;
  onChoose: (row: Row) => void;
  onClose: () => void;
  inputRef?: Ref<HTMLInputElement>;
  listRef?: Ref<HTMLUListElement>;
}

/**
 * The finder as drawn. No hooks, so what a key pressed in it does can be
 * pressed in a test, on the dialog's own handler.
 */
export function FinderView(p: FinderViewProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a click on the backdrop closes the finder; Escape does the same from the keyboard
    <div className="finder-overlay" onClick={p.onClose} role="presentation">
      <div
        className="finder"
        role="dialog"
        aria-modal="true"
        aria-label="Find a capability or run an action"
        onClick={e => e.stopPropagation()}
        // Every key pressed in the finder is the finder's. Only Escape used to
        // stop here, so with a result focused ArrowDown also stepped the
        // selection on the map behind it, and `g` opened Proposals over it.
        onKeyDown={e => {
          e.stopPropagation();
          const step = keyStep(e.key, p.active, p.rows.length);
          if (!step) return;
          if (step.kind === 'close') {
            p.onClose();
            return;
          }
          e.preventDefault();
          if (step.kind === 'move') p.onActive(step.active);
          else if (p.rows[p.active]) p.onChoose(p.rows[p.active]);
        }}
      >
        <input
          ref={p.inputRef}
          className="finder-input"
          placeholder={
            p.withActions
              ? 'Find a capability, or type an action…'
              : 'Find a capability, a server, an agent…'
          }
          aria-label="Find a capability or run an action"
          value={p.query}
          onChange={e => p.onQuery(e.target.value)}
        />
        <ul ref={p.listRef} className="finder-list">
          {p.rows.map((row, i) => {
            const firstOfGroup = i === 0 || groupOf(p.rows[i - 1]) !== groupOf(row);
            const isActive = i === p.active;
            return (
              <li key={row.kind === 'action' ? `action:${row.action.id}` : row.item.id}>
                {firstOfGroup && <div className="finder-group">{groupOf(row)}</div>}
                <button
                  type="button"
                  aria-current={isActive ? 'true' : undefined}
                  className={`finder-item ${isActive ? 'is-active' : ''}`}
                  onMouseEnter={() => p.onActive(i)}
                  // A row reached with Tab is the one Enter chooses.
                  onFocus={() => p.onActive(i)}
                  onClick={() => p.onChoose(row)}
                >
                  {row.kind === 'action' ? (
                    <>
                      <span
                        className="finder-item-glyph"
                        style={{ color: 'var(--accent)' }}
                        aria-hidden="true"
                      >
                        ›
                      </span>
                      <span className="finder-item-name">{row.action.label}</span>
                      <span className="finder-item-meta">
                        {row.action.hint ?? row.action.group}
                      </span>
                    </>
                  ) : (
                    <>
                      <span
                        className="finder-item-glyph"
                        style={{ color: typeColor(row.item.type) }}
                        aria-hidden="true"
                      >
                        {typeSymbol(row.item.type)}
                      </span>
                      <span className="finder-item-name">{row.item.name}</span>
                      <span className="finder-item-meta">
                        {typeLabel(row.item.type)} · {statusLabel(row.item.status, row.item)}
                      </span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
          {p.rows.length === 0 && <li className="finder-empty">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  );
}
