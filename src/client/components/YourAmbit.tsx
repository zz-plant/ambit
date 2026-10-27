import { type CSSProperties, useEffect, useMemo } from 'react';
import { shellQuote } from '../../shared/shell';
import { useCopied } from '../hooks/useCopied';
import { useAmbitStore } from '../store/ambitStore';
import { INSTALL } from '../utils/copy';
import { isEntry, isFailing, isProven, nextSteps, visibleItems } from './civ/layout';

interface YourAmbitProps {
  /** Undefined on narrow screens, where the card is not inset by the panels. */
  style?: CSSProperties;
  onClose: () => void;
  /** Read another config, from the same dialog the sample offered. A tab reading only. */
  onMapAnother?: () => void;
  /** Back to the sample. A tab reading only. */
  onSample?: () => void;
}

/** How many next steps the card offers: one is a recommendation, three are a choice. */
const SHOWN = 3;

/** A step as the card lists it, from the engine's ranking or the same rule run in the tab. */
interface Step {
  id: string;
  name: string;
  cost: string;
  why: string;
}

/** "Claude Code (3 servers) and Ollama (4 models)", as `ambit` says what it read. */
function readFrom(read: { label: string; servers: string[]; models?: string[] }[]): string {
  const parts = read.map(r => {
    const n = (r.models ?? r.servers).length;
    return `${r.label} (${n} ${r.models ? 'model' : 'server'}${n === 1 ? '' : 's'})`;
  });
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : (parts[0] ?? '');
}

/**
 * The readout: a setup and the one step that would open the most, the same
 * five things `ambit` prints on a first run. What was read, how much of the
 * tree it reaches, the next steps, what is not proven yet, and one thing to
 * do. It shows twice: for a config read in this tab, the moment it is read,
 * and for the machine's own graph, on the first visit to `ambit web`.
 *
 * The steps are ranked by the engine's rule either way, which on the
 * machine's graph is the engine's own answer, so the card, the map and the
 * terminal name the same step. The map lights the step that is chosen before
 * a word is read, and the card names what lit. What the tab cannot know,
 * whether each piece works and what the other runtimes on the machine hold,
 * is said once, with the command that knows it.
 */
export default function YourAmbit({ style, onClose, onMapAnother, onSample }: YourAmbitProps) {
  const items = useAmbitStore(s => s.items);
  const connections = useAmbitStore(s => s.connections);
  const reading = useAmbitStore(s => s.reading);
  const loop = useAmbitStore(s => s.loop);
  const lit = useAmbitStore(s => (s.simulationMode === 'acquisition' ? s.simulatedNodeId : null));
  const startAcquisition = useAmbitStore(s => s.startAcquisitionSimulation);
  const clearSimulation = useAmbitStore(s => s.clearSimulation);
  const [copied, copy] = useCopied();

  const tree = useMemo(() => visibleItems(items).filter(i => !isEntry(i)), [items]);
  const onMap = useMemo(() => new Set(tree.map(i => i.id)), [tree]);
  const steps = useMemo<Step[]>(() => {
    // The machine's graph: the engine ranked it, and said why in its words.
    const ranked = reading ? [] : (loop?.next ?? []).filter(n => onMap.has(n.id));
    if (ranked.length) {
      return ranked
        .slice(0, SHOWN)
        .map(n => ({ id: n.id, name: n.capability, cost: n.cost, why: n.why }));
    }
    return nextSteps(items, connections)
      .slice(0, SHOWN)
      .map(s => ({
        id: s.item.id,
        name: s.item.name,
        cost: s.cost,
        why: s.why,
      }));
  }, [reading, loop, onMap, items, connections]);
  const first = steps[0]?.id;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the opening step is lit once per reading; re-running on a store change would relight it under a visitor who had chosen another.
  useEffect(() => {
    if (first) startAcquisition(first);
  }, [first]);

  const reached = tree.filter(i => i.status === 'built');
  const shown = steps.find(s => s.id === lit) ?? steps[0];
  const close = () => {
    clearSimulation();
    onClose();
  };

  // Where the setup came from: a file or a pick in this tab, or what the seed
  // read on this machine.
  let eyebrow = 'Your ambit';
  let source = '';
  let given = '';
  if (reading) {
    eyebrow = `Your ambit · ${reading.runtime}`;
    const entries = `${reading.entries} ${reading.entries === 1 ? 'entry' : 'entries'}`;
    source = reading.picked
      ? `Placed from the ${reading.entries} you picked`
      : `${entries} from ${reading.named ? `${reading.runtime}'s config` : 'your config'}, read in this tab and sent nowhere`;
    // What the placement counted that the file never lists: the runtime's own
    // tools, and its model when the file names none.
    given =
      reading.model === null
        ? 'a shell and file editing'
        : `a shell, file editing and ${
            reading.named
              ? `the ${reading.model} models ${reading.runtime} runs on`
              : 'the model your agent runs on'
          }`;
  } else {
    eyebrow = 'Your ambit · this machine';
    source = loop?.read?.length ? `Read from ${readFrom(loop.read)}` : '';
  }

  // On the machine, what is reached and not yet proven, and what fails its check.
  const failing = reading ? [] : reached.filter(isFailing);
  const unproven = reading ? 0 : reached.filter(i => !isProven(i) && !isFailing(i)).length;
  const typed = (command: string) =>
    loop?.command ? command.replace(/^ambit(?=\s|$)/, loop.command) : command;
  const plan = shown ? typed(`ambit goal ${shellQuote(shown.id.replace(/^combo:/, ''))}`) : '';

  return (
    <section
      className="app-guide app-tour app-ambit"
      style={style}
      aria-label="What your setup reaches"
      data-occludes-map
    >
      <div className="app-guide-head">
        <span className="app-tour-count">{eyebrow}</span>
        <button type="button" className="app-guide-close" onClick={close} aria-label="Close">
          ✕
        </button>
      </div>
      <h2 className="app-tour-title">
        You reach {reached.length} of {tree.length}
      </h2>
      {(source || given) && (
        <p className="app-tour-body">
          {source}
          {source && '.'}
          {given && ` Counted though not listed: ${given}.`}
        </p>
      )}

      {shown && (
        <div className="ambit-steps">
          <h3 className="ambit-steps-head">What one more step opens</h3>
          <ul>
            {steps.map(step => {
              const on = step.id === shown.id;
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    className={`ambit-step${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => startAcquisition(step.id)}
                  >
                    <span className="ambit-step-name">{step.name}</span>
                    {step.cost !== 'unknown' && (
                      <span className="ambit-step-meta">about {step.cost}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="ambit-step-says">{shown.why}</p>
        </div>
      )}

      {reading ? (
        <>
          <p className="app-tour-note ambit-limits">
            This tab cannot run checks or read your other agents. The CLI does both, on your
            machine:
          </p>
          <div className="app-tour-install">
            <code>{INSTALL}</code>
            <button type="button" onClick={() => copy('install', INSTALL)}>
              {copied === 'install' ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <div className="app-tour-nav">
            {onSample && (
              <button type="button" className="app-tour-back" onClick={onSample}>
                Back to the sample
              </button>
            )}
            {onMapAnother && (
              <button type="button" className="app-tour-back" onClick={onMapAnother}>
                Map another
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {(failing.length > 0 || unproven > 0) && (
            <p className="app-tour-note ambit-limits">
              {failing.length > 0 && (
                <>
                  <strong>{failing[0].name}</strong> is configured and failing its check
                  {failing.length > 1 ? `, with ${failing.length - 1} more` : ''}.{' '}
                </>
              )}
              {unproven > 0 &&
                `${unproven} configured and not yet proven: a check says whether each one works.`}
            </p>
          )}
          {shown && (
            <div className="app-tour-install">
              <code>{plan}</code>
              <button
                type="button"
                onClick={() => copy('plan', plan)}
                title="Copy the command; the page never runs it"
              >
                {copied === 'plan' ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
          )}
          <p className="app-tour-note">
            {shown ? `Plans ${shown.name} in your terminal. ` : ''}
            {typed('ambit verify')} runs the checks.
          </p>
        </>
      )}
    </section>
  );
}
