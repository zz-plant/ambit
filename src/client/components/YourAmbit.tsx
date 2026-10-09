import { type CSSProperties, useEffect, useMemo } from 'react';
import { useCopied } from '../hooks/useCopied';
import { useAmbitStore } from '../store/ambitStore';
import { INSTALL } from '../utils/copy';
import type { Item } from '../utils/configImporter';
import { costOf, isEntry, nextSteps, visibleItems } from './civ/layout';

interface YourAmbitProps {
  /** Undefined on narrow screens, where the card is not inset by the panels. */
  style?: CSSProperties;
  onClose: () => void;
  /** Read another config, from the same dialog the sample offered. */
  onMapAnother: () => void;
  onSample: () => void;
}

/** How many next steps the card offers: one is a recommendation, three are a choice. */
const SHOWN = 3;

/** "A, B and C", the way the card reads a list of capabilities out. */
const named = (list: Item[]) =>
  list.length <= 1
    ? (list[0]?.name ?? '')
    : `${list
        .slice(0, -1)
        .map(i => i.name)
        .join(', ')} and ${list[list.length - 1].name}`;

/**
 * What the visitor's own config adds up to, the moment it is read. The tour
 * ends on "Now map yours", and the page used to answer with a list of the
 * entries and an instruction to install the engine for the map, so the one
 * question the demo had raised, what would one more step open for me, went
 * unanswered at the point it was asked.
 *
 * It opens the way the tour does: the map lights the step that opens the
 * most before a word is read, and the card names what lit. The next few
 * steps are a choice, each one lit on the map when pressed. What the tab
 * cannot know, whether each piece works and what the other runtimes on the
 * machine hold, is said once, with the command that knows it.
 */
export default function YourAmbit({ style, onClose, onMapAnother, onSample }: YourAmbitProps) {
  const items = useAmbitStore(s => s.items);
  const connections = useAmbitStore(s => s.connections);
  const reading = useAmbitStore(s => s.reading);
  const lit = useAmbitStore(s => (s.simulationMode === 'acquisition' ? s.simulatedNodeId : null));
  const startAcquisition = useAmbitStore(s => s.startAcquisitionSimulation);
  const clearSimulation = useAmbitStore(s => s.clearSimulation);
  const [copied, copy] = useCopied();

  const tree = useMemo(() => visibleItems(items).filter(i => !isEntry(i)), [items]);
  const steps = useMemo(() => {
    const all = nextSteps(items, connections);
    // A step that opens nothing further is still a step, but listing three of
    // them under "what one more step opens" says nothing; they go last.
    const opening = all.filter(s => s.opens.size > 0);
    return (opening.length ? opening : all).slice(0, SHOWN);
  }, [items, connections]);
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const first = steps[0]?.item.id;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the opening step is lit once per reading; re-running on a store change would relight it under a visitor who had chosen another.
  useEffect(() => {
    if (first) startAcquisition(first);
  }, [first]);

  if (!reading) return null;
  const reached = tree.filter(i => i.status === 'built').length;
  const shown = steps.find(s => s.item.id === lit) ?? steps[0];
  const opens = shown
    ? [...shown.opens].flatMap(id => byId.get(id) ?? []).filter(i => !isEntry(i))
    : [];
  const entries = `${reading.entries} ${reading.entries === 1 ? 'entry' : 'entries'}`;
  const source = reading.picked
    ? `Placed from the ${reading.entries} you picked`
    : `${entries} from ${reading.named ? `${reading.runtime}'s config` : 'your config'}, read in this tab and sent nowhere`;
  // What the placement counted that the file never lists: the runtime's own
  // tools, and its model when the file names none.
  const given =
    reading.model === null
      ? 'a shell and file editing'
      : `a shell, file editing and ${
          reading.named
            ? `the ${reading.model} models ${reading.runtime} runs on`
            : 'the model your agent runs on'
        }`;

  return (
    <section
      className="app-guide app-tour app-ambit"
      style={style}
      aria-label="What your config adds up to"
      data-occludes-map
    >
      <div className="app-guide-head">
        <span className="app-tour-count">Your ambit</span>
        <button
          type="button"
          className="app-guide-close"
          onClick={() => {
            clearSimulation();
            onClose();
          }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <h2 className="app-tour-title">
        Your setup reaches {reached} of {tree.length}
      </h2>
      <p className="app-tour-body">
        {source}. Counted though not listed: {given}.
      </p>

      {shown && (
        <div className="ambit-steps">
          <h3 className="ambit-steps-head">What one more step opens</h3>
          <ul>
            {steps.map(({ item, opens: set }) => {
              const on = item.id === shown.item.id;
              const cost = costOf(item);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`ambit-step${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => startAcquisition(item.id)}
                  >
                    <span className="ambit-step-name">{item.name}</span>
                    <span className="ambit-step-meta">
                      {cost && `about ${cost} · `}
                      {set.size ? `opens ${set.size}` : 'a step on its own'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="ambit-step-says">
            {opens.length > 0 && (
              <>
                Adding <strong>{shown.item.name}</strong> would open {named(opens)}.{' '}
              </>
            )}
            {/* The tree's hint ends without a stop. */}
            <span className="ambit-step-how">
              {shown.item.description.replace(/([^.])$/, '$1.')}
            </span>
          </p>
        </div>
      )}

      <p className="app-tour-note ambit-limits">
        This tab cannot run checks or read your other runtimes. The CLI does both, on your machine:
      </p>
      <div className="app-tour-install">
        <code>{INSTALL}</code>
        <button type="button" onClick={() => copy('install', INSTALL)}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <div className="app-tour-nav">
        <button type="button" className="app-tour-back" onClick={onSample}>
          Back to the sample
        </button>
        <button type="button" className="app-tour-back" onClick={onMapAnother}>
          Map another
        </button>
      </div>
    </section>
  );
}
